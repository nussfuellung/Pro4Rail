import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { frame, parseXml, Deframer } from '../src/protocol.mjs';
import { Model } from '../src/model.mjs';
import { buildCommand } from '../src/commands.mjs';
import { Bridge } from '../src/bridge.mjs';
import { RocrailClient } from '../src/rocrail-client.mjs';

const PLAN = `<?xml version="1.0"?><plan title="Test &amp; Co" rocrailversion="2.1">
 <swlist><sw id="W1" type="right" state="straight"/><sw id="W&amp;2" type="left" state="turnout"/></swlist>
 <stlist><st id="R1" desc="x"/><st id="R2" show="false"/></stlist>
 <lclist><lc id="BR 103" addr="103" V_mode="percent" V_max="100" fncnt="8" desc="Lok"/><lc id="Köf" addr="5" V_mode="kmh" V_max="60" fncnt="2"/></lclist>
 <colist><co id="Licht" state="on"/></colist></plan>`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const model = () => { const m = new Model(); m.applyPlan(parseXml(PLAN)[0]); return m; };
const xml = c => c.msgs.map(m => m.replace(/^<xmlh>.*?<\/xmlh>/, ''));

test('Rahmen zählt Bytes, nicht Zeichen', () => {
  assert.equal(frame('lc', '<lc id="Köf"/>'), '<xmlh><xml size="15" name="lc"/></xmlh><lc id="Köf"/>');
});

test('XML-Leser: Entitäten, Kommentare, kaputte Eingaben', () => {
  const r = parseXml('<?xml version="1.0"?><!-- x --><a id="1 &amp; 2" n=\'3\'><b/><c></c></a><<<broken');
  assert.equal(r[0].attrs.id, '1 & 2'); assert.equal(r[0].attrs.n, '3'); assert.equal(r[0].children.length, 2);
});

test('Deframer setzt Nachrichten über Paketgrenzen und mehrere pro Paket zusammen', () => {
  const d = new Deframer();
  const a = Buffer.from('<?xml version="1.0"?><xmlh><xml size="1" name="lc"/></xmlh><lc id="A" V="5"/>\0<lc id="B"/>\0');
  const out = [...d.push(a.subarray(0, 30)), ...d.push(a.subarray(30))];
  assert.equal(out.length, 2); assert.equal(out[0][0].attrs.id, 'A'); assert.equal(out[1][0].attrs.id, 'B');
});

test('Plan wird übernommen', () => {
  const m = model();
  assert.equal(m.plan.title, 'Test & Co');
  assert.equal(m.plan.lcs.length, 2); assert.equal(m.plan.sws[1].id, 'W&2'); assert.equal(m.plan.sts[1].hidden, true);
  assert.equal(m.state.co.Licht, true);
});

test('Ereignisse ändern den Zustand, Tempo wird in Prozent umgerechnet', () => {
  const m = model();
  m.applyEvent(parseXml('<lc id="Köf" V="30" dir="false"/>')[0]);
  assert.equal(m.state.lc['Köf'].v, 50); assert.equal(m.state.lc['Köf'].fwd, false);
  m.applyEvent(parseXml('<sw id="W1" state="turnout"/>')[0]); assert.equal(m.state.sw.W1, 'turnout');
  m.applyEvent(parseXml('<sys cmd="go"/>')[0]); assert.equal(m.state.power, 'on');
  m.applyEvent(parseXml('<sys cmd="ebreak"/>')[0]); assert.equal(m.state.power, 'off');
  assert.equal(m.applyEvent(parseXml('<lc id="gibtsnicht" V="3"/>')[0]), false);
});

test('Befehle: gültige werden übersetzt', () => {
  const m = model();
  assert.deepEqual(xml(buildCommand('lc_speed', { id: 'BR 103', v: 55 }, m)), ['<lc id="BR 103" V="55"/>']);
  assert.deepEqual(xml(buildCommand('lc_speed', { id: 'Köf', v: 50 }, m)), ['<lc id="Köf" V="30"/>']);
  assert.deepEqual(xml(buildCommand('sw_set', { id: 'W&2', state: 'flip' }, m)), ['<sw id="W&amp;2" cmd="flip"/>']);
  assert.deepEqual(xml(buildCommand('st_set', { id: 'R1' }, m)), ['<st id="R1" cmd="set"/>']);
  assert.deepEqual(xml(buildCommand('plan_reload', {}, m)), ['<model cmd="plan"/>']);
  assert.deepEqual(xml(buildCommand('nothalt', {}, m)), ['<sys cmd="stop"/>', '<sys cmd="ebreak"/>']);
  const fn = xml(buildCommand('lc_fn', { id: 'BR 103', fn: 2, on: true }, m))[0];
  assert.match(fn, /fnchanged="2" fnchangedstate="true" f0="false" f1="false" f2="true"/);
});

test('Befehle: Ungültiges und Einschleusversuche werden abgelehnt oder entschärft', () => {
  const m = model();
  assert.equal(buildCommand('lc_speed', { id: 'Unbekannt', v: 5 }, m).ok, false);
  assert.equal(buildCommand('lc_speed', { id: 'BR 103', v: 'schnell' }, m).ok, false);
  assert.equal(buildCommand('lc_speed', { id: '"/><sys cmd="shutdown"/><lc id="', v: 5 }, m).ok, false);
  assert.equal(buildCommand('sw_set', { id: 'W1', state: 'x" cmd="shutdown' }, m).ok, false);
  assert.equal(buildCommand('lc_fn', { id: 'BR 103', fn: 99, on: true }, m).ok, false);
  assert.equal(buildCommand('shutdown', {}, m).ok, false);
  assert.equal(buildCommand('lc_speed', null, m).ok, false);
  assert.deepEqual(xml(buildCommand('lc_speed', { id: 'BR 103', v: 9999 }, m)), ['<lc id="BR 103" V="100"/>']);
  assert.deepEqual(xml(buildCommand('lc_speed', { id: 'BR 103', v: -5 }, m)), ['<lc id="BR 103" V="0"/>']);
});

test('Gesamtablauf mit Schein-Rocrail: Plan, Befehle, veraltete Befehle, Nothalt', async () => {
  const received = []; let serverSock;
  const server = net.createServer(s => { serverSock = s; s.on('data', d => received.push(d.toString())); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const queue = []; const pushed = []; const doneIds = [];
  let now = Date.now();
  const store = {
    async fetchCommands() { const rows = queue.splice(0); return { rows, serverNow: now }; },
    async markDone(ids) { doneIds.push(...ids); },
    async pushLayout(r) { pushed.push(r); },
  };
  const b = new Bridge({ client: new RocrailClient({ host: '127.0.0.1', port }), store, maxAgeSec: 10, pollMs: 20, log: () => {} });
  b.start();
  await wait(150);
  assert.ok(received.join('').includes('<model cmd="plan"/>'), 'Plan wird angefordert');
  serverSock.write(`<?xml version="1.0"?>${PLAN}\0`);
  await wait(900);
  assert.equal(pushed.at(-1).plan.lcs.length, 2, 'Plan wurde an die Cloud gemeldet');
  assert.equal(pushed.at(-1).state.connected, true);
  received.length = 0;
  const mk = (id, type, payload, ageSec) => ({ id, type, payload, created_at: new Date(now - ageSec * 1000).toISOString() });
  queue.push(mk(1, 'lc_speed', { id: 'BR 103', v: 40 }, 1), mk(2, 'lc_speed', { id: 'BR 103', v: 90 }, 60), mk(3, 'lc_speed', { id: 'nix', v: 1 }, 1), mk(4, 'nothalt', {}, 300));
  await wait(200);
  const sent = received.join('');
  assert.ok(sent.includes('<lc id="BR 103" V="40"/>'), 'frischer Befehl kam an');
  assert.ok(!sent.includes('V="90"'), 'veralteter Befehl wurde verworfen');
  assert.ok(!sent.includes('nix'), 'unbekannte Lok abgelehnt');
  assert.ok(sent.includes('<sys cmd="ebreak"/>'), 'Nothalt läuft auch bei spätem Eintreffen');
  assert.deepEqual(doneIds, [1, 2, 3, 4]);
  serverSock.write('<lc id="BR 103" V="40"/>\0'); await wait(900);
  assert.equal(pushed.at(-1).state.lc['BR 103'].v, 40, 'Rückmeldung erreicht die Cloud');
  assert.equal(pushed.at(-1).plan, undefined, 'Plan wird nicht bei jeder Änderung erneut gesendet');
  // Verbindung weg: Befehle werden verworfen statt später ausgeführt
  serverSock.destroy(); await wait(100);
  queue.push(mk(5, 'power', { on: true }, 1)); received.length = 0; await wait(150);
  assert.equal(received.length, 0);
  assert.ok(doneIds.includes(5));
  b.stop(); server.close();
});

test('Beispielplan (falls vorhanden) wird gelesen', { skip: !process.env.ROCRAIL_PLAN || !existsSync(process.env.ROCRAIL_PLAN || '') }, () => {
  const m = new Model(); m.applyPlan(parseXml(readFileSync(process.env.ROCRAIL_PLAN, 'utf8')).find(e => e.tag === 'plan'));
  assert.ok(m.plan.sws.length > 5 && m.plan.sts.length > 5 && m.plan.lcs.length >= 1);
});
