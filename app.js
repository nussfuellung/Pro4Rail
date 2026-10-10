import { CONFIG } from './config.js';
import { DEMO, initStore, Auth, Devices, Media, defaultConfig, uid } from './store.js';
import { pinSets, BOARD } from './pins.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let user = null;
let draft = null;      // Arbeitskopie des Geräts, das gerade bearbeitet wird
let devIndex = 1;      // Nummer in der Geräteliste (Gleisschild)
let tab = 'anzeigen';
let dirty = false;
let mediaList = [];
let player = null;     // laufende MP3-Vorschau

// ---------- Hilfsfunktionen ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}
const isOnline = d => d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 120000;
const hhmm = iso => iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function setPath(o, path, v) {
  const k = path.split('.'); let c = o;
  for (let i = 0; i < k.length - 1; i++) c = c[k[i]];
  c[k[k.length - 1]] = v;
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return 'gerade eben';
  if (m < 60) return `vor ${m} Minuten`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} ${h === 1 ? 'Stunde' : 'Stunden'}`;
  const d = Math.round(h / 24);
  return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}
function statusHtml(d) {
  if (isOnline(d)) return '<span class="status on"><i></i>online</span>';
  return `<span class="status"><i></i>${d.last_seen ? 'zuletzt ' + ago(d.last_seen) : 'noch nie verbunden'}</span>`;
}
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
const sel = (path, cur, opts, attrs = '') => `<select data-k="${path}" ${attrs}>${opts.map(([v, l]) => opt(v, l, cur)).join('')}</select>`;

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('p4r_theme', next); } catch (e) { /* Speicher gesperrt */ }
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = next === 'dark' ? '#1d2631' : '#f6f8f9';
}

const TFT_MODELS = {
  ST7789: { label: 'ST7789 (240×320)', w: 240, h: 320 },
  ILI9341: { label: 'ILI9341 (240×320)', w: 240, h: 320 },
  ST7735: { label: 'ST7735 (128×160)', w: 128, h: 160 },
};
const SEG_KINDS = { '7seg': '7-Segment', '14seg': '14-Segment', '16seg': '16-Segment' };
const SEG_DRIVERS = { TM1637: 'TM1637 (4 oder 6 Stellen)', MAX7219: 'MAX7219 (bis 8 Stellen)', HT16K33: 'HT16K33 (I²C, 4 Stellen)' };
const CONTENT = {
  tft: { abfahrt: 'Bahnhofstafel mit Abfahrten', uhr: 'Uhr', bild: 'Bild (JPEG)' },
  seg: { min_bis: 'Minuten bis zur nächsten Abfahrt', zeit: 'Abfahrtszeit des nächsten Zugs', verspaetung: 'Verspätung in Minuten', gleis: 'Gleis des nächsten Zugs', uhr: 'Uhr' },
};
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

const newDisplay = slot => ({
  slot, type: 'tft', tft: { model: 'ST7789', w: 240, h: 320 },
  seg: { kind: '7seg', driver: 'TM1637', digits: 4 },
  content: 'abfahrt', station: null, rows: 2, filter: '', imageId: null,
});

// ---------- Fahrplandaten (Vorschau direkt aus der PWA) ----------
const depCache = new Map();
async function searchStations(q) {
  const r = await fetch(`${CONFIG.TRANSPORT_API}/locations?query=${encodeURIComponent(q)}&results=6&stops=true&addresses=false&poi=false`);
  if (!r.ok) throw new Error('Suche fehlgeschlagen');
  return (await r.json()).filter(x => x.id && x.name);
}
async function getDepartures(stationId) {
  const hit = depCache.get(stationId);
  if (hit && Date.now() - hit.t < 30000) return hit.data;
  const r = await fetch(`${CONFIG.TRANSPORT_API}/stops/${encodeURIComponent(stationId)}/departures?duration=120&results=12`);
  if (!r.ok) throw new Error('Abfahrten nicht abrufbar');
  const j = await r.json();
  const list = Array.isArray(j) ? j : (j.departures || []);
  const data = list.map(d => ({
    line: d.line?.name || '?', dir: d.direction || '', when: d.when || d.plannedWhen, planned: d.plannedWhen,
    delay: d.delay == null ? null : Math.round(d.delay / 60), platform: d.platform || d.plannedPlatform || '', cancelled: !!d.cancelled,
  }));
  depCache.set(stationId, { t: Date.now(), data });
  return data;
}
function applyFilter(list, filter) {
  const f = (filter || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return f.length ? list.filter(d => f.some(x => d.line.toLowerCase().includes(x))) : list;
}

async function previewHtml(disp) {
  const isSeg = disp.type === 'seg';
  const note = t => `<p class="hint">${t}</p>`;
  if (disp.content === 'uhr') {
    const t = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return isSeg ? `<div class="seg">${t}<small>Uhr</small></div>` : `<div class="board"><div class="bh"><span>Uhr</span></div><div style="font-size:46px;font-weight:700">${t}</div></div>`;
  }
  if (disp.content === 'bild') return note('Das gewählte Bild erscheint auf dem Display.');
  if (!disp.station) return note('Wähle einen Bahnhof, dann erscheint hier die Live-Vorschau.');
  try {
    const list = applyFilter(await getDepartures(disp.station.id), disp.filter);
    if (!list.length) return note('Keine Abfahrten gefunden. Prüfe den Linienfilter.');
    if (isSeg) {
      const n = list[0]; const digits = disp.seg.digits || 4;
      let txt, cap;
      if (disp.content === 'min_bis') { txt = String(Math.max(0, Math.round((new Date(n.when) - Date.now()) / 60000))); cap = 'Minuten'; }
      else if (disp.content === 'zeit') { txt = hhmm(n.when).replace(':', '.'); cap = 'Abfahrt'; }
      else if (disp.content === 'verspaetung') { txt = String(n.delay ?? 0); cap = 'Minuten Verspätung'; }
      else { txt = String(n.platform || '-'); cap = 'Gleis'; }
      const shown = txt.slice(-digits).padStart(digits, ' ').replace(/ /g, '&nbsp;');
      return `<div class="seg">${shown}<small>${cap}, ${esc(n.line)} nach ${esc(n.dir)}</small></div>`;
    }
    const rows = list.slice(0, disp.rows || 2).map(d => {
      const late = d.cancelled ? '<span class="late">fällt aus</span>' : d.delay > 0 ? `<span class="late">+${d.delay}</span>` : '<span class="okk">pünktlich</span>';
      return `<div class="br"><span>${esc(d.line)}</span><span>${esc(d.dir)}</span><span>${hhmm(d.planned || d.when)}${late}</span></div>`;
    }).join('');
    return `<div class="board"><div class="bh"><span>${esc(disp.station.name)}</span><span>Abfahrt</span></div>${rows}</div>`;
  } catch (e) {
    return note(`Vorschau nicht verfügbar: ${esc(e.message)}.`);
  }
}

// ---------- Router ----------
const routes = [
  [/^#\/?$/, pageDevices],
  [/^#\/add$/, pageAdd],
  [/^#\/device\/(.+)$/, pageDevice],
  [/^#\/media$/, pageMedia],
  [/^#\/installer$/, pageInstaller],
  [/^#\/account$/, pageAccount],
];

async function route() {
  user = await Auth.user();
  $('#banner').textContent = DEMO ? 'Demo-Modus: Die Daten bleiben nur in diesem Browser. Trage in config.js dein Backend ein, um echte Geräte zu koppeln.' : '';
  const h = location.hash || '#/';
  const key = /^#\/(media|installer|account)/.test(h) ? h.split('/')[1] : '';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === key));
  if (!user) return pageLogin();
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      try { await fn(m[1]); window.scrollTo(0, 0); }
      catch (e) { app.innerHTML = `<div class="panel"><h2>Das hat nicht geklappt</h2><p>${esc(e.message || e)}</p><a class="btn ghost" href="#/">Zur Geräteliste</a></div>`; }
      return;
    }
  }
  location.hash = '#/';
}

// ---------- Anmeldung und Konto ----------
function pageLogin() {
  app.innerHTML = `<div style="max-width:420px"><div class="pagehead"><h1>Anmelden</h1></div><div class="panel">
    <label class="field"><span class="lbl">E-Mail</span><input id="em" type="email" autocomplete="username"></label>
    <label class="field" style="margin-top:14px"><span class="lbl">Passwort</span><input id="pw" type="password" autocomplete="current-password"></label>
    <div class="row" style="margin-top:18px"><button id="in">Anmelden</button><button id="up" class="ghost">Konto erstellen</button></div>
    <p class="hint" id="msg" role="alert"></p></div></div>`;
  const go = async fn => {
    try { await fn($('#em').value.trim(), $('#pw').value); route(); }
    catch (e) { $('#msg').textContent = e.message; }
  };
  $('#in').onclick = () => go(Auth.signIn);
  $('#up').onclick = () => go(async (e, p) => { const r = await Auth.signUp(e, p); if (r && !r.session) $('#msg').textContent = 'Bestätige die E-Mail und melde dich danach an.'; });
}

function pageAccount() {
  app.innerHTML = `<div class="pagehead"><h1>Konto</h1></div><div class="panel" style="max-width:520px"><p><strong>${esc(user.email)}</strong></p>
    ${DEMO ? '<p class="muted">Im Demo-Modus ist keine Anmeldung nötig. Alle Daten liegen nur in diesem Browser.</p><button id="reset" class="danger">Demo-Daten löschen</button>' : '<button id="out" class="ghost">Abmelden</button>'}</div>`;
  if (DEMO) $('#reset').onclick = () => { if (confirm('Alle Demo-Daten in diesem Browser löschen?')) { Object.keys(localStorage).filter(k => k.startsWith('demo_')).forEach(k => localStorage.removeItem(k)); location.hash = '#/'; location.reload(); } };
  else $('#out').onclick = async () => { await Auth.signOut(); route(); };
}

// ---------- Geräteliste ----------
async function pageDevices() {
  const list = await Devices.list();
  const rows = list.map((d, i) => {
    const disp = d.config?.displays || [];
    const rules = d.config?.audio?.rules?.length || 0;
    const chips = disp.map(x => `<span class="chip">Anzeige ${x.slot}: ${x.type === 'seg' ? 'Segment' : 'TFT'}${x.station ? ', ' + esc(x.station.name) : ''}</span>`).join('')
      + (rules ? `<span class="chip">${rules} ${rules === 1 ? 'Ansage' : 'Ansagen'}</span>` : '');
    return `<a class="dev ${isOnline(d) ? 'on' : ''}" href="#/device/${esc(d.id)}">
      <span class="gleis" aria-hidden="true">${i + 1}</span>
      <span><span class="dev-name">${esc(d.name)}</span><span class="dev-meta">${chips || '<span class="chip">Noch keine Anzeige</span>'}</span></span>
      ${statusHtml(d)}</a>`;
  }).join('');
  app.innerHTML = `<div class="pagehead"><h1>Meine Geräte</h1><a class="btn" href="#/add">Gerät hinzufügen</a></div>` +
    (list.length ? `<div class="devlist">${rows}</div>`
      : `<div class="panel empty"><h2>Noch kein Gerät</h2><p class="muted">Richte deinen ersten ESP32 ein. Du brauchst dafür nur ein WLAN und etwa fünf Minuten.</p><a class="btn" href="#/add">Gerät hinzufügen</a></div>`);
}

// ---------- Gerät hinzufügen ----------
async function pageAdd() {
  app.innerHTML = `<div class="pagehead"><h1>Gerät hinzufügen</h1></div>
  <div class="panel" style="margin-bottom:16px">
    <ol class="steps">
      <li><div><h3>Firmware installieren</h3><p class="muted" style="margin:2px 0 8px">Nur bei einem neuen ESP32 ohne Pro4Rail-Firmware nötig. Der Installer arbeitet per USB am Computer.</p><a class="btn ghost small" href="#/installer">Zum Installer</a></div></li>
      <li><div><h3>Kopplungscode erzeugen</h3><p class="muted" style="margin:2px 0 8px">Der Code gilt 15 Minuten und nur für ein Gerät.</p><button id="gen" class="small">Code erzeugen</button><div id="codebox" style="margin-top:14px"></div></div></li>
      <li><div><h3>Mit dem WLAN des Geräts verbinden</h3><p class="muted" style="margin:2px 0 0">Der ESP32 öffnet nach dem Einschalten ein WLAN mit dem Namen Tafel und vier Zeichen dahinter. Verbinde dein Handy damit. Das Einrichtungsfenster öffnet sich von selbst, sonst rufst du <strong>192.168.4.1</strong> im Browser auf.</p></div></li>
      <li><div><h3>WLAN und Code eingeben</h3><p class="muted" style="margin:2px 0 0">Wähle dein Heimnetz, gib das Passwort und den Kopplungscode ein und speichere. Danach erscheint das Gerät in deiner Liste.</p></div></li>
    </ol>
  </div>
  <p class="muted" style="max-width:640px">Warum nicht direkt hier? Diese App läuft über HTTPS, das Einrichtungs-WLAN des Geräts nur über HTTP. Der Browser blockiert diese Verbindung, deshalb läuft der WLAN-Schritt im Fenster des Geräts.</p>
  ${DEMO ? `<div class="panel" style="margin-top:16px;max-width:520px"><h3>Demo</h3><p class="muted" style="margin:4px 0 12px">Ohne echtes Gerät kannst du die Kopplung simulieren.</p><button id="sim" class="ghost small">Gerät simulieren</button></div>` : ''}`;
  $('#gen').onclick = async () => {
    try {
      const { code, expires } = await Devices.createPairingCode();
      $('#codebox').innerHTML = `<div class="code" aria-label="Kopplungscode ${code.split('').join(' ')}">${code}</div><p class="hint">Gültig bis ${hhmm(expires)} Uhr</p>`;
    } catch (e) { toast('Code konnte nicht erzeugt werden: ' + e.message); }
  };
  if (DEMO) $('#sim').onclick = async () => { const d = await Devices.simulateClaim('Neues Gerät'); location.hash = '#/device/' + d.id; };
}

// ---------- Ansagen: Regeln ----------
function newRule(trig) {
  const sd = draft.config.displays.find(d => d.station);
  const base = { id: uid(), enabled: true, trigger: trig, mediaId: '' };
  if (trig === 'zeit') return { ...base, name: 'Ansage nach Zeitplan', days: [1, 2, 3, 4, 5], time: '07:30' };
  if (trig === 'abfahrt') return { ...base, name: 'Ansage vor Abfahrt', slot: sd ? sd.slot : 0, minBefore: 2 };
  return { ...base, name: 'Ansage bei Verspätung', slot: sd ? sd.slot : 0, minDelay: 5 };
}
function daysText(days) {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (!d.length) return 'An keinem Tag';
  if (d.length === 7) return 'Täglich';
  if (d.join() === '1,2,3,4,5') return 'Montag bis Freitag';
  if (d.join() === '6,7') return 'Samstag und Sonntag';
  if (d.length === 1) return DAY_LONG[d[0] - 1];
  return d.map(x => DAYS[x - 1]).join(', ');
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function ruleSummary(r) {
  if (r.trigger === 'zeit') return `${daysText(r.days || [])} um ${r.time || '--:--'} Uhr`;
  const d = draft.config.displays.find(x => x.slot === r.slot && x.station);
  if (!d) return 'Wähle zuerst bei einer Anzeige einen Bahnhof.';
  const where = ` am Bahnhof ${d.station.name}${d.filter ? ' (Linien ' + d.filter + ')' : ''}`;
  if (r.trigger === 'abfahrt') return `${plural(r.minBefore, 'Minute', 'Minuten')} vor jeder Abfahrt${where}`;
  return `Sobald ein Zug mindestens ${plural(r.minDelay, 'Minute', 'Minuten')} Verspätung hat${where}`;
}
function ruleHtml(r, i) {
  const p = `config.audio.rules.${i}`;
  const stationDisp = draft.config.displays.filter(d => d.station);
  const audios = mediaList.filter(m => m.kind === 'audio');
  const slotSel = stationDisp.length
    ? sel(`${p}.slot`, r.slot, stationDisp.map(d => [d.slot, `Anzeige ${d.slot}: ${d.station.name}`]), 'data-num data-rerender')
    : '<select disabled><option>Keine Anzeige mit Bahnhof</option></select>';
  let fields = '';
  if (r.trigger === 'zeit') {
    fields = `<div class="grid">
      <div><span class="lbl">Wochentage</span><div class="days" role="group" aria-label="Wochentage">${DAYS.map((n, k) => `<button type="button" class="${(r.days || []).includes(k + 1) ? 'on' : ''}" data-act="day" data-i="${i}" data-d="${k + 1}" aria-pressed="${(r.days || []).includes(k + 1)}" title="${DAY_LONG[k]}">${n}</button>`).join('')}</div></div>
      <label class="field"><span class="lbl">Uhrzeit</span><input type="time" data-k="${p}.time" data-rerender value="${esc(r.time)}"></label></div>`;
  } else if (r.trigger === 'abfahrt') {
    fields = `<div class="grid"><label class="field"><span class="lbl">Bahnhof und Anzeige</span>${slotSel}</label>
      <label class="field"><span class="lbl">Minuten vor Abfahrt</span><input type="number" min="0" max="30" data-num data-k="${p}.minBefore" data-rerender value="${r.minBefore}"></label></div>`;
  } else {
    fields = `<div class="grid"><label class="field"><span class="lbl">Bahnhof und Anzeige</span>${slotSel}</label>
      <label class="field"><span class="lbl">Ab wie vielen Minuten Verspätung</span><input type="number" min="1" max="120" data-num data-k="${p}.minDelay" data-rerender value="${r.minDelay}"></label></div>`;
  }
  const soundOpts = [['', 'MP3 wählen …'], ['auto', 'Automatische Ansage mit Zug, Ziel und Gleis'], ...audios.map(m => [m.id, m.name])];
  const known = soundOpts.some(([v]) => v === r.mediaId);
  return `<div class="panel rule ${r.enabled ? '' : 'off'}">
    <div class="rule-head">
      <div style="min-width:0;flex:1">
        <input class="name" type="text" data-k="${p}.name" value="${esc(r.name)}" aria-label="Name der Ansage">
        <p class="rule-sum">${esc(ruleSummary(r))}</p>
      </div>
      <label class="switch"><input type="checkbox" data-k="${p}.enabled" data-rerender ${r.enabled ? 'checked' : ''}><span class="tr"></span><span class="tx">${r.enabled ? 'Aktiv' : 'Aus'}</span></label>
    </div>
    <div class="rule-body">
      ${fields}
      <div class="sound"><label class="field"><span class="lbl">Was wird abgespielt?</span>${sel(`${p}.mediaId`, known ? r.mediaId : '', soundOpts, 'data-rerender')}</label>
        <button type="button" class="ghost" data-act="hear" data-i="${i}">Anhören</button></div>
      ${!audios.length ? `<p class="hint">Du hast noch keine MP3 hochgeladen. <a href="#/media">Zu den Medien</a></p>` : ''}
    </div>
    <div class="rule-foot">
      <button type="button" class="ghost small" data-act="ruletest" data-i="${i}">Auf dem Gerät testen</button>
      <button type="button" class="danger small" data-act="delrule" data-i="${i}">Löschen</button>
    </div></div>`;
}

async function hearRule(r) {
  if (player) { player.pause(); player = null; }
  speechSynthesis?.cancel?.();
  if (!r.mediaId) { toast('Wähle zuerst eine MP3 oder die automatische Ansage.'); return false; }
  if (r.mediaId === 'auto') {
    const text = r.trigger === 'verspaetung' ? 'Der RE 5 nach Koblenz, Gleis 3, ca. 5 Minuten später.'
      : r.trigger === 'abfahrt' ? 'Der RE 5 nach Koblenz, Gleis 3, fährt in 2 Minuten ab.'
      : 'Hinweis: Dies ist eine Ansage nach Zeitplan.';
    if (!('speechSynthesis' in window)) { toast('Dieser Browser kann die Beispielansage nicht sprechen.'); return false; }
    const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.volume = draft.config.audio.volume / 100;
    speechSynthesis.speak(u); return true;
  }
  const item = mediaList.find(m => m.id === r.mediaId);
  const url = item ? await Media.url(item) : null;
  if (!url) { toast('Diese Datei ist hier nicht abspielbar. Lade die MP3 bei den Medien erneut hoch.'); return false; }
  player = new Audio(url); player.volume = draft.config.audio.volume / 100;
  try { await player.play(); return true; } catch (e) { toast('Wiedergabe nicht möglich: ' + e.message); return false; }
}

// ---------- Gerät bearbeiten ----------
async function pageDevice(id) {
  const list = await Devices.list();
  const idx = list.findIndex(d => d.id === id);
  if (idx < 0) { location.hash = '#/'; return; }
  devIndex = idx + 1;
  draft = JSON.parse(JSON.stringify(list[idx]));
  const base = defaultConfig();
  draft.config = { ...base, ...draft.config };
  draft.config.light = { ...base.light, ...draft.config.light };
  draft.config.audio = { ...base.audio, ...draft.config.audio };
  if (!Array.isArray(draft.config.audio.rules)) draft.config.audio.rules = [];
  if (!Array.isArray(draft.config.displays)) draft.config.displays = [];
  mediaList = await Media.list();
  tab = 'anzeigen'; dirty = false;
  renderDevice();
}

function markDirty() {
  dirty = true;
  const sb = $('.savebar'); if (sb) sb.classList.add('changed');
}

const TABS = [['anzeigen', 'Anzeigen'], ['ansagen', 'Ansagen'], ['licht', 'Licht'], ['pins', 'Anschlüsse'], ['geraet', 'Gerät']];

function tabAnzeigen() {
  const c = draft.config;
  const images = mediaList.filter(m => m.kind === 'image');
  const blocks = c.displays.map((d, i) => {
    const p = `config.displays.${i}`;
    const isSeg = d.type === 'seg';
    const needsStation = ['abfahrt', 'min_bis', 'zeit', 'verspaetung', 'gleis'].includes(d.content);
    return `<section class="panel disp">
      <div class="disp-head"><h3>Anzeige ${d.slot}</h3>
        <div class="row"><button type="button" class="ghost small" data-act="topins">Anschlüsse</button><button type="button" class="danger small" data-act="rm" data-i="${i}">Entfernen</button></div></div>
      <div class="grid">
        <label class="field"><span class="lbl">Bauart</span>${sel(`${p}.type`, d.type, [['tft', 'TFT-Display'], ['seg', 'LED-Segmentanzeige']], 'data-rerender')}</label>
        ${isSeg ? `
          <label class="field"><span class="lbl">Segmente</span>${sel(`${p}.seg.kind`, d.seg.kind, Object.entries(SEG_KINDS), 'data-rerender')}</label>
          <label class="field"><span class="lbl">Treiber-Chip</span>${sel(`${p}.seg.driver`, d.seg.driver, Object.entries(SEG_DRIVERS), 'data-rerender')}</label>
          <label class="field"><span class="lbl">Anzahl Stellen</span><input type="number" min="1" max="8" data-num data-rerender data-k="${p}.seg.digits" value="${d.seg.digits}"></label>` : `
          <label class="field"><span class="lbl">Modell</span>${sel(`${p}.tft.model`, d.tft.model, Object.entries(TFT_MODELS).map(([k, v]) => [k, v.label]), 'data-rerender')}</label>`}
        <label class="field"><span class="lbl">Inhalt</span>${sel(`${p}.content`, d.content, Object.entries(CONTENT[d.type]), 'data-rerender')}</label>
        ${!isSeg && d.content === 'abfahrt' ? `<label class="field"><span class="lbl">Zeilen</span>${sel(`${p}.rows`, d.rows, [1, 2, 3, 4].map(n => [n, n]), 'data-num data-rerender')}</label>` : ''}
        ${needsStation ? `<label class="field"><span class="lbl">Nur diese Linien (zum Beispiel RE5, S1)</span><input type="text" data-rerender data-k="${p}.filter" value="${esc(d.filter)}"></label>` : ''}
        ${!isSeg && d.content === 'bild' ? `<label class="field"><span class="lbl">Bild</span>${sel(`${p}.imageId`, d.imageId || '', [['', 'Bild wählen …'], ...images.map(m => [m.id, m.name])], 'data-rerender')}</label>` : ''}
      </div>
      ${needsStation ? `<div style="margin-top:14px"><label class="field"><span class="lbl">Bahnhof${d.station ? `: <strong style="color:var(--ink)">${esc(d.station.name)}</strong>` : ''}</span>
        <input type="text" placeholder="Bahnhof suchen" data-search="${i}" autocomplete="off"></label><div class="res" id="res${i}" hidden></div></div>` : ''}
      <div class="prev" data-prev="${i}"><p class="hint">Vorschau wird geladen</p></div>
    </section>`;
  }).join('');
  const add = c.displays.length < 3
    ? `<button type="button" class="${c.displays.length ? 'ghost' : ''}" data-act="add">Anzeige hinzufügen</button>`
    : '<p class="muted">Mehr als drei Anzeigen pro Gerät sind nicht möglich.</p>';
  return (blocks || `<div class="panel empty" style="margin-bottom:16px"><h2>Noch keine Anzeige</h2><p class="muted">Füge die erste Anzeige hinzu und wähle, ob ein TFT oder eine Segmentanzeige angeschlossen ist.</p></div>`) + add;
}

function tabAnsagen() {
  const c = draft.config;
  const rules = c.audio.rules.map(ruleHtml).join('');
  return `<section class="section"><h2>Wiedergabe</h2><div class="panel" style="max-width:560px"><label class="field"><span class="lbl">Lautstärke <b class="val">${c.audio.volume}%</b></span>
      <input type="range" min="0" max="100" data-num data-k="config.audio.volume" value="${c.audio.volume}"></label></div></section>
    <section class="section"><h2>Ansagen</h2>
      ${rules || '<p class="muted" style="max-width:560px">Noch keine Ansage. Lege fest, wann das Gerät welche MP3 abspielt.</p>'}
      <h3 style="margin:18px 0 10px">Neue Ansage</h3>
      <div class="newrule">
        <button type="button" data-act="addrule" data-t="zeit">Nach Zeitplan<span>Zu einer festen Uhrzeit an gewählten Wochentagen</span></button>
        <button type="button" data-act="addrule" data-t="abfahrt">Bei Abfahrt<span>Kurz bevor ein Zug abfährt</span></button>
        <button type="button" data-act="addrule" data-t="verspaetung">Bei Verspätung<span>Sobald ein Zug später dran ist</span></button>
      </div></section>`;
}

function tabLicht() {
  const l = draft.config.light;
  return `<section class="panel" style="max-width:560px"><div class="row sp" style="margin-bottom:14px"><label class="switch"><input type="checkbox" data-k="config.light.on" ${l.on ? 'checked' : ''}><span class="tr"></span><span class="tx">Licht an</span></label></div>
    <label class="field"><span class="lbl">Helligkeit <b class="val">${l.brightness}%</b></span><input type="range" min="0" max="100" data-num data-k="config.light.brightness" value="${l.brightness}"></label>
    <p class="hint">Änderungen wirken sofort am Gerät. Zum dauerhaften Speichern der Einstellung unten auf Speichern tippen.</p></section>`;
}

function tabPins() {
  const sets = pinSets(draft.config).map(s => `<section class="pinset"><h3>${esc(s.title)}</h3><p class="muted">${esc(s.sub)}</p>
    <div class="pins"><div class="pin head muted"><span>ESP32</span><span></span><span>Pin am Modul</span></div>
      ${s.rows.map(r => `<div class="pin"><span class="gpio ${r.pwr ? 'pwr' : ''}">${esc(r.gpio)}</span><span class="track"></span>
        <span class="mod"><b>${esc(r.mod)}</b>${r.alt || r.note ? `<small>${[r.alt, r.note].filter(Boolean).map(esc).join(', ')}</small>` : ''}</span></div>`).join('')}
    </div>${s.notes.map(n => `<p class="hint">${esc(n)}</p>`).join('')}</section>`).join('');
  return `<div class="callout"><p><strong>${esc(BOARD.name)}</strong></p><p>${esc(BOARD.warning)}</p></div>${sets}`;
}

function tabGeraet() {
  return `<section class="panel" style="max-width:560px"><label class="field"><span class="lbl">Name des Geräts</span><input type="text" data-k="name" value="${esc(draft.name)}"></label>
    <p class="hint">Geräte-ID: ${esc(draft.device_uid)}</p></section>
    <section class="section" style="margin-top:32px;max-width:560px"><h2>Gerät entkoppeln</h2>
      <p class="muted">Das Gerät verschwindet aus deinem Konto und muss danach neu eingerichtet werden.</p>
      <button type="button" class="danger" data-act="del">Gerät entkoppeln</button></section>`;
}

function renderDevice() {
  const y = window.scrollY;
  const body = { anzeigen: tabAnzeigen, ansagen: tabAnsagen, licht: tabLicht, pins: tabPins, geraet: tabGeraet }[tab]();
  app.innerHTML = `
    <div class="pagehead"><div class="lead"><span class="gleis" aria-hidden="true">${devIndex}</span><div><h1>${esc(draft.name)}</h1>${statusHtml(draft)}</div></div></div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    ${body}
    <div class="savebar ${dirty ? 'changed' : ''}"><span class="clean">Alles gespeichert</span><span class="dirty">Ungespeicherte Änderungen</span><button type="button" data-act="save">Speichern</button></div>`;
  window.scrollTo(0, y);
  bindDevice();
  if (tab === 'anzeigen') fillPreviews();
}

async function fillPreviews() {
  const els = [...app.querySelectorAll('[data-prev]')];
  await Promise.all(els.map(async el => {
    const d = draft.config.displays[Number(el.dataset.prev)];
    if (!d) return;
    const html = await previewHtml(d);
    if (app.contains(el)) el.innerHTML = html;
  }));
}

let lightTimer;
function sendLight() {
  clearTimeout(lightTimer);
  lightTimer = setTimeout(() => Devices.command(draft.id, 'light', draft.config.light).catch(e => toast('Licht konnte nicht geschaltet werden: ' + e.message)), 300);
}

function bindDevice() {
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderDevice(); window.scrollTo(0, 0); });

  app.querySelectorAll('[data-k]').forEach(el => {
    const val = () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.hasAttribute('data-num')) v = Number(v);
      return v;
    };
    if (el.type === 'range') {
      el.addEventListener('input', () => {
        const b = el.closest('.field')?.querySelector('.val'); if (b) b.textContent = el.value + '%';
      });
    }
    el.addEventListener('change', () => {
      const v = val();
      setPath(draft, el.dataset.k, v);
      markDirty();
      let m;
      if ((m = el.dataset.k.match(/^config\.displays\.(\d+)\.type$/))) {
        const d = draft.config.displays[m[1]]; d.content = d.type === 'seg' ? 'min_bis' : 'abfahrt';
      }
      if ((m = el.dataset.k.match(/^config\.displays\.(\d+)\.tft\.model$/))) {
        const d = draft.config.displays[m[1]]; d.tft.w = TFT_MODELS[d.tft.model].w; d.tft.h = TFT_MODELS[d.tft.model].h;
      }
      if (el.dataset.k.startsWith('config.light.')) sendLight();
      if (el.dataset.k === 'name') { const h = $('h1'); if (h) h.textContent = v; }
      if (el.hasAttribute('data-rerender')) renderDevice();
    });
  });

  // Bahnhofssuche
  app.querySelectorAll('[data-search]').forEach(inp => {
    const i = Number(inp.dataset.search); const box = $('#res' + i);
    inp.oninput = debounce(async () => {
      if (inp.value.trim().length < 2) { box.hidden = true; return; }
      try {
        const res = await searchStations(inp.value.trim());
        box.hidden = !res.length;
        box.innerHTML = res.map(s => `<button type="button" data-pick="${esc(s.id)}" data-name="${esc(s.name)}">${esc(s.name)}</button>`).join('');
        box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
          draft.config.displays[i].station = { id: b.dataset.pick, name: b.dataset.name };
          markDirty(); renderDevice();
        });
      } catch (e) { box.hidden = false; box.textContent = 'Die Suche ist gerade nicht erreichbar. Versuche es später noch einmal.'; }
    }, 300);
  });

  app.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const a = b.dataset.act; const i = Number(b.dataset.i);
    const rules = draft.config.audio.rules;
    if (a === 'add') {
      const used = draft.config.displays.map(d => d.slot);
      const slot = [1, 2, 3].find(s => !used.includes(s));
      draft.config.displays.push(newDisplay(slot)); markDirty(); renderDevice();
    } else if (a === 'rm') {
      const slot = draft.config.displays[i].slot;
      draft.config.displays.splice(i, 1);
      rules.forEach(r => { if (r.slot === slot) r.slot = 0; });
      markDirty(); renderDevice();
    } else if (a === 'topins') {
      tab = 'pins'; renderDevice(); window.scrollTo(0, 0);
    } else if (a === 'addrule') {
      rules.push(newRule(b.dataset.t)); markDirty(); renderDevice();
    } else if (a === 'delrule') {
      rules.splice(i, 1); markDirty(); renderDevice();
    } else if (a === 'day') {
      const r = rules[i]; const d = Number(b.dataset.d);
      r.days = (r.days || []).includes(d) ? r.days.filter(x => x !== d) : [...(r.days || []), d];
      markDirty(); renderDevice();
    } else if (a === 'hear') {
      await hearRule(rules[i]);
    } else if (a === 'ruletest') {
      const r = rules[i];
      if (!r.mediaId) { toast('Wähle zuerst eine MP3 oder die automatische Ansage.'); return; }
      try {
        await Devices.command(draft.id, 'announce', { rule: r, volume: draft.config.audio.volume });
        if (DEMO) { await hearRule(r); toast('Demo: Die Ansage läuft in diesem Browser.'); }
        else toast('Testansage an das Gerät gesendet');
      } catch (e) { toast('Senden nicht möglich: ' + e.message); }
    } else if (a === 'save') {
      try { await Devices.save(draft); dirty = false; $('.savebar')?.classList.remove('changed'); toast('Gespeichert'); }
      catch (e) { toast('Speichern nicht möglich: ' + e.message); }
    } else if (a === 'del') {
      if (confirm('Gerät wirklich entkoppeln? Es muss danach neu eingerichtet werden.')) {
        try { await Devices.remove(draft.id); location.hash = '#/'; } catch (e) { toast('Entkoppeln nicht möglich: ' + e.message); }
      }
    }
  });
}

// ---------- Medien ----------
async function resizeImage(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

async function pageMedia() {
  const list = await Media.list();
  const total = list.reduce((a, m) => a + (m.size || 0), 0);
  const pct = Math.min(100, Math.round(total / CONFIG.MAX_USER_BYTES * 100));
  app.innerHTML = `<div class="pagehead"><h1>Medien</h1></div>
    <div class="panel" style="margin-bottom:20px;max-width:640px"><label class="field"><span class="lbl">MP3 für Ansagen oder Bild für ein Display hinzufügen</span>
      <input id="file" type="file" accept="audio/mpeg,.mp3,image/jpeg,image/png"></label>
      <p class="hint">MP3 bis ${CONFIG.MAX_AUDIO_BYTES / 1048576} MB. Bilder werden auf höchstens 320 Pixel Kantenlänge verkleinert und als JPEG gespeichert. MP4-Video folgt später.</p>
      <div class="meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <p class="hint">${(total / 1048576).toFixed(1)} von ${CONFIG.MAX_USER_BYTES / 1048576} MB belegt</p></div>
    <div class="media-grid" id="grid"></div>`;
  const grid = $('#grid');
  for (const m of list) {
    const url = await Media.url(m);
    const el = document.createElement('div'); el.className = 'media-item';
    el.innerHTML = `${m.kind === 'image' && url ? `<img src="${esc(url)}" alt="">` : ''}
      ${m.kind === 'audio' ? (url ? `<audio controls src="${esc(url)}"></audio>` : '<p class="muted" style="margin:0">Vorschau nur direkt nach dem Hochladen</p>') : ''}
      <span class="nm">${esc(m.name)}</span><span class="muted">${m.kind === 'audio' ? 'MP3' : 'Bild'}, ${(m.size / 1024).toFixed(0)} KB</span>
      <button type="button" class="danger small">Löschen</button>`;
    el.querySelector('button').onclick = async () => {
      if (confirm('Datei löschen? Ansagen und Anzeigen, die sie nutzen, brauchen danach eine neue Datei.')) { await Media.remove(m); pageMedia(); }
    };
    grid.appendChild(el);
  }
  if (!list.length) grid.innerHTML = '<p class="muted">Noch keine Dateien.</p>';
  $('#file').onchange = async e => {
    let f = e.target.files[0]; if (!f) return;
    try {
      let kind;
      if (f.type.startsWith('audio/') || /\.mp3$/i.test(f.name)) {
        kind = 'audio';
        if (f.size > CONFIG.MAX_AUDIO_BYTES) throw new Error('Die MP3 ist größer als erlaubt.');
      } else if (f.type.startsWith('image/')) { kind = 'image'; f = await resizeImage(f); }
      else if (f.type.startsWith('video/')) throw new Error('MP4 wird noch nicht unterstützt.');
      else throw new Error('Dieser Dateityp wird nicht unterstützt.');
      if (total + f.size > CONFIG.MAX_USER_BYTES) throw new Error('Der Speicherplatz reicht nicht aus.');
      await Media.upload(f, kind); toast('Hochgeladen'); pageMedia();
    } catch (err) { toast(err.message); }
  };
}

// ---------- Web-Installer ----------
async function pageInstaller() {
  app.innerHTML = `<div class="pagehead"><h1>Installer</h1></div>
    <div class="panel" style="max-width:640px">
      <p>Der Installer spielt die Firmware direkt aus dem Browser auf einen ESP32-S3 per USB.</p>
      <ol class="steps"><li><div>ESP32 per USB mit dem Computer verbinden.</div></li><li><div>Auf Firmware installieren klicken und den Anschluss wählen.</div></li><li><div>Danach das Gerät hinzufügen und mit dem Kopplungscode verbinden.</div></li></ol>
      <div style="margin-top:12px"><esp-web-install-button manifest="install/manifest.json"><button slot="activate" type="button">Firmware installieren</button><span slot="unsupported" class="muted">Dieser Browser kann keine USB-Geräte ansprechen. Nutze Chrome oder Edge an einem Computer.</span><span slot="not-allowed" class="muted">Der Zugriff auf USB-Geräte braucht eine HTTPS-Verbindung.</span></esp-web-install-button></div>
    </div>
    <div class="callout" style="margin-top:20px;max-width:640px"><p>Die Firmware-Datei <strong>install/firmware.bin</strong> gibt es noch nicht. Sie entsteht mit der Firmware und wird danach in diesen Ordner gelegt.</p></div>`;
  if (!customElements.get('esp-web-install-button')) {
    try { await import('https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module'); }
    catch { toast('Die Installer-Bibliothek konnte nicht geladen werden.'); }
  }
}

// ---------- Start ----------
(async () => {
  $('#year').textContent = new Date().getFullYear();
  $('#themebtn').onclick = toggleTheme;
  await initStore();
  Auth.onChange(route);
  window.addEventListener('hashchange', route);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
