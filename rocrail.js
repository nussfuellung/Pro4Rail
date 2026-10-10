// Rocrail-Seite: Fahrstrom, Loks, Weichen, Fahrstraßen und Schaltungen bedienen.
// Die App spricht nie direkt mit Rocrail, sondern über die Bridge (Ordner rocrail-bridge). Siehe store.js, Rocrail.

import { DEMO, Rocrail } from './store.js';

let sub = 'loks';        // gewählter Unterreiter
let showHidden = false;  // ausgeblendete Fahrstraßen (vom Analyser erzeugte) anzeigen
let filter = '';

const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

// Plan (plan.xml aus Rocrail) in das schlanke Format der App umwandeln. Gleiche Form wie in der Bridge.
export function parsePlan(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'plan') throw new Error('Das ist keine Rocrail-Planatei (plan.xml).');
  const list = (tag, fn) => [...doc.querySelectorAll(`${tag}list > ${tag}`)].map(fn).filter(x => x.id);
  const at = (e, n, d = '') => e.getAttribute(n) ?? d;
  return {
    title: at(doc.documentElement, 'title', 'Rocrail-Anlage'), version: at(doc.documentElement, 'rocrailversion'),
    lcs: list('lc', e => ({ id: at(e, 'id'), desc: at(e, 'desc'), addr: num(at(e, 'addr')), vmode: /kmh/i.test(at(e, 'V_mode')) ? 'kmh' : 'percent', vmax: num(at(e, 'V_max', '100')) || 100, fncnt: num(at(e, 'fncnt', '4')), hidden: at(e, 'show') === 'false' })),
    sws: list('sw', e => ({ id: at(e, 'id'), type: at(e, 'type'), state: at(e, 'state', 'straight') })),
    sts: list('st', e => ({ id: at(e, 'id'), desc: at(e, 'desc'), hidden: at(e, 'show') === 'false' })),
    cos: list('co', e => ({ id: at(e, 'id'), desc: at(e, 'desc'), type: at(e, 'type') })),
  };
}

export async function pageRocrail(app, { esc, toast }) {
  let row = await Rocrail.get();
  let busy = false;       // true, solange ein Regler gezogen wird
  let pending = false;
  const timers = new Map();

  const send = (type, payload) => Rocrail.command(type, payload).catch(e => toast('Senden nicht möglich: ' + (e.message || e)));
  const throttled = (key, fn) => { clearTimeout(timers.get(key)); timers.set(key, setTimeout(fn, 180)); };

  const plan = () => row.plan || {};
  const st = () => row.state || {};
  const hasPlan = () => (plan().lcs || []).length + (plan().sws || []).length + (plan().sts || []).length + (plan().cos || []).length > 0;
  const bridgeOk = () => row.bridge_seen && Date.now() - new Date(row.bridge_seen).getTime() < 60000;

  function head() {
    const on = st().power === 'on';
    const b = DEMO ? '<span class="rr-state warn"><i></i>Demo-Anlage</span>'
      : bridgeOk() ? '<span class="rr-state on"><i></i>Bridge verbunden</span>' : '<span class="rr-state bad"><i></i>Bridge nicht erreichbar</span>';
    return `<div class="pagehead"><h1>Rocrail</h1>${b}</div>
      <div class="panel rr-top">
        <label class="switch"><input type="checkbox" id="rr-power" ${on ? 'checked' : ''}><span class="tr"></span><span class="tx">Fahrstrom ${on ? 'an' : 'aus'}</span></label>
        <label class="switch"><input type="checkbox" id="rr-auto" ${st().auto ? 'checked' : ''}><span class="tr"></span><span class="tx">Automatik</span></label>
        <span class="grow"></span>
        <button type="button" class="rr-stop" id="rr-stop">NOTHALT</button>
      </div>`;
  }

  const speedText = (l, v) => l.vmode === 'kmh' ? `${Math.round(v / 100 * l.vmax)} km/h` : `${v}%`;

  function loks() {
    const lcs = (plan().lcs || []).filter(l => !l.hidden);
    if (!lcs.length) return '<p class="muted">Keine Lokomotiven im Plan.</p>';
    return lcs.map(l => {
      const s = (st().lc || {})[l.id] || { v: 0, fwd: true, fn: {}, mode: 'stop' };
      const fns = Array.from({ length: Math.min(Math.max(l.fncnt || 4, 1), 13) }, (_, n) =>
        `<button type="button" data-fn="${n}" data-id="${esc(l.id)}" class="${s.fn?.[n] ? 'on' : ''}" aria-pressed="${!!s.fn?.[n]}">F${n}</button>`).join('');
      return `<section class="panel rr-card" data-lc="${esc(l.id)}">
        <div class="head"><div><b>${esc(l.id)}</b><small>${esc(l.desc || 'Adresse ' + l.addr)}</small></div><output>${speedText(l, s.v)}</output></div>
        <div class="rr-spd"><input type="range" min="0" max="100" value="${s.v}" data-speed="${esc(l.id)}" aria-label="Geschwindigkeit ${esc(l.id)}"></div>
        <div class="rr-btns">
          <button type="button" data-dir="back" data-id="${esc(l.id)}" class="${s.fwd ? '' : 'on'}">Rückwärts</button>
          <button type="button" data-stop="${esc(l.id)}" class="ghost">Halt</button>
          <button type="button" data-dir="fwd" data-id="${esc(l.id)}" class="${s.fwd ? 'on' : ''}">Vorwärts</button>
        </div>
        <div class="rr-fn" role="group" aria-label="Funktionen">${fns}</div>
        <div class="rr-btns"><button type="button" class="ghost ${s.mode === 'auto' ? 'on' : ''}" data-lcauto="${esc(l.id)}" data-on="${s.mode === 'auto' ? 0 : 1}">${s.mode === 'auto' ? 'Automatik beenden' : 'Automatik starten'}</button></div>
      </section>`;
    }).join('');
  }

  function weichen() {
    const sws = plan().sws || [];
    if (!sws.length) return '<p class="muted">Keine Weichen im Plan.</p>';
    const label = { straight: 'gerade', turnout: 'abzweigend', left: 'links', right: 'rechts' };
    return `<div class="rr-items">${sws.map(w => {
      const cur = (st().sw || {})[w.id] || w.state;
      return `<button type="button" class="rr-item ${cur !== 'straight' ? 'on' : ''}" data-sw="${esc(w.id)}"><b>${esc(w.id)}</b><small>${esc(label[cur] || cur)}</small></button>`;
    }).join('')}</div><p class="hint">Antippen schaltet die Weiche um.</p>`;
  }

  function routes() {
    const all = plan().sts || [];
    const f = filter.trim().toLowerCase();
    const list = all.filter(r => (showHidden || !r.hidden) && (!f || r.id.toLowerCase().includes(f)));
    const hiddenCount = all.filter(r => r.hidden).length;
    return `<div class="row" style="margin-bottom:12px"><input type="text" id="rr-filter" placeholder="Fahrstraße suchen" value="${esc(filter)}" style="max-width:320px" aria-label="Fahrstraße suchen">
      ${hiddenCount ? `<label class="switch"><input type="checkbox" id="rr-hidden" ${showHidden ? 'checked' : ''}><span class="tr"></span><span class="tx">Automatisch erzeugte zeigen (${hiddenCount})</span></label>` : ''}</div>
      ${list.length ? `<div class="rr-items">${list.map(r => {
        const locked = (st().st || {})[r.id] === 'locked';
        return `<button type="button" class="rr-item ${locked ? 'on' : ''}" data-st="${esc(r.id)}"><b>${esc(r.id)}</b><small>${locked ? 'gestellt' : esc(r.desc || 'Tippen zum Stellen')}</small></button>`;
      }).join('')}</div>` : '<p class="muted">Keine Fahrstraßen gefunden.</p>'}`;
  }

  function schaltungen() {
    const cos = plan().cos || [];
    if (!cos.length) return '<p class="muted">Keine Schaltungen im Plan.</p>';
    return `<div class="rr-items">${cos.map(c => {
      const on = !!(st().co || {})[c.id];
      return `<button type="button" class="rr-item ${on ? 'on' : ''}" data-co="${esc(c.id)}" data-on="${on ? 0 : 1}"><b>${esc(c.id)}</b><small>${on ? 'an' : 'aus'}</small></button>`;
    }).join('')}</div>`;
  }

  function empty() {
    return `<div class="panel empty"><h2>Noch keine Anlage</h2>
      <p class="muted">Die Bridge läuft auf dem Rechner, auf dem Rocrail läuft, und meldet den Plan automatisch. Wie du sie startest, steht in rocrail-bridge/README.md.</p>
      <p class="muted">Solange die Bridge nicht läuft, kannst du den Plan auch von Hand laden. Schalten geht trotzdem erst mit laufender Bridge.</p>
      <div class="row"><label class="btn ghost" style="cursor:pointer">plan.xml laden<input type="file" id="rr-file" accept=".xml,text/xml" hidden></label>
      ${DEMO ? '<button type="button" id="rr-demo" class="ghost">Demo-Anlage laden</button>' : ''}</div></div>`;
  }

  function body() {
    if (!hasPlan()) return empty();
    const subs = [['loks', 'Loks'], ['weichen', 'Weichen'], ['routen', 'Fahrstraßen'], ['cos', 'Schaltungen']];
    const view = { loks, weichen, routen: routes, cos: schaltungen }[sub]();
    return `<div class="rr-sub" role="tablist">${subs.map(([k, l]) => `<button type="button" role="tab" data-sub="${k}" class="${sub === k ? 'on' : ''}" aria-selected="${sub === k}">${l}</button>`).join('')}</div>${view}
      <p class="hint">${esc(plan().title || '')}${plan().version ? ', Rocrail ' + esc(plan().version) : ''}. <button type="button" class="link" id="rr-reload">Plan neu laden</button></p>`;
  }

  function render() {
    const y = window.scrollY;
    const hadFilter = document.activeElement?.id === 'rr-filter';
    app.innerHTML = head() + body();
    window.scrollTo(0, y);
    bind();
    if (hadFilter) { const f = app.querySelector('#rr-filter'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }

  function bind() {
    const q = (s, fn) => app.querySelectorAll(s).forEach(fn);
    app.querySelector('#rr-power').onchange = e => send('power', { on: e.target.checked });
    app.querySelector('#rr-auto').onchange = e => send('auto', { on: e.target.checked });
    app.querySelector('#rr-stop').onclick = () => send('nothalt', {});
    q('[data-sub]', b => b.onclick = () => { sub = b.dataset.sub; render(); });
    q('[data-speed]', el => {
      const id = el.dataset.speed; const out = el.closest('.rr-card').querySelector('output');
      const lc = (plan().lcs || []).find(l => l.id === id);
      const show = () => { out.textContent = speedText(lc, Number(el.value)); };
      el.addEventListener('pointerdown', () => { busy = true; });
      const release = () => { busy = false; if (pending) { pending = false; render(); } };
      el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release);
      el.addEventListener('input', () => { busy = true; show(); throttled('v' + id, () => send('lc_speed', { id, v: Number(el.value) })); });
      el.addEventListener('change', () => { clearTimeout(timers.get('v' + id)); send('lc_speed', { id, v: Number(el.value) }); busy = false; if (pending) { pending = false; render(); } });
    });
    q('[data-dir]', b => b.onclick = () => send('lc_dir', { id: b.dataset.id, forward: b.dataset.dir === 'fwd' }));
    q('[data-stop]', b => b.onclick = () => send('lc_stop', { id: b.dataset.stop }));
    q('[data-fn]', b => b.onclick = () => send('lc_fn', { id: b.dataset.id, fn: Number(b.dataset.fn), on: b.getAttribute('aria-pressed') !== 'true' }));
    q('[data-lcauto]', b => b.onclick = () => send('lc_auto', { id: b.dataset.lcauto, on: b.dataset.on === '1' }));
    q('[data-sw]', b => b.onclick = () => send('sw_set', { id: b.dataset.sw, state: 'flip' }));
    q('[data-st]', b => b.onclick = () => send('st_set', { id: b.dataset.st }));
    q('[data-co]', b => b.onclick = () => send('co_set', { id: b.dataset.co, on: b.dataset.on === '1' }));
    const f = app.querySelector('#rr-filter'); if (f) f.oninput = () => { filter = f.value; render(); };
    const h = app.querySelector('#rr-hidden'); if (h) h.onchange = () => { showHidden = h.checked; render(); };
    const file = app.querySelector('#rr-file');
    if (file) file.onchange = async () => {
      try { await Rocrail.setPlan(parsePlan(await file.files[0].text())); row = await Rocrail.get(); render(); toast('Plan geladen'); }
      catch (e) { toast(e.message); }
    };
    const demo = app.querySelector('#rr-demo'); if (demo) demo.onclick = async () => { await Rocrail.useDemoPlan(); row = await Rocrail.get(); render(); };
    const rl = app.querySelector('#rr-reload'); if (rl) rl.onclick = async () => { await send('plan_reload', {}); toast('Plan wird bei Rocrail neu angefragt'); setTimeout(async () => { row = await Rocrail.get(); render(); }, 2500); };
  }

  const off = Rocrail.subscribe(r => {
    row = r;
    if (busy || document.activeElement?.id === 'rr-filter') { pending = true; return; }
    render();
  });
  // Bridge-Status regelmäßig neu bewerten, ohne dass ein Ereignis kommen muss.
  const tick = setInterval(() => { if (!busy) render(); }, 30000);
  render();
  return () => { off(); clearInterval(tick); timers.forEach(clearTimeout); };
}
