import { CONFIG } from './config.js';
import { OLED_MODELS, OLED_COLORS, OLED_DEFAULT, oledSize, oledDepartureScreen, oledClockScreen } from './oled.js';
import { DEMO, initStore, Auth, Devices, Media, defaultConfig, uid } from './store.js';
import { pinSets, BOARDS, boardOf, boardWarnings, muxPlan, muxOn, maxDisplays, busPinChoices, MUX_MAX } from './pins.js';
import { searchStations, getDepartures, clearDepartureCache } from './transport.js';
import { TFT_MODELS, screenSize, departureScreen, clockScreen, imageScreen, zugzielScreen, platformMatches } from './tft.js';
import { activateMarquee, activateSlides } from './marquee.js';
import { pageRocrail } from './rocrail.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let user = null;
let draft = null;      // Arbeitskopie des Geräts, das gerade bearbeitet wird
let devIndex = 1;      // Nummer in der Geräteliste (Gleisschild)
let tab = 'direkt';
let cleanup = null;    // Aufräumfunktion der aktuellen Seite (zum Beispiel Live-Abo bei Rocrail)
const openDisp = new Set(); // aufgeklappte Anzeigen auf der Geräteseite
let dirty = false;
let mediaList = [];
let player = null;     // laufende MP3-Vorschau

// ---------- Hilfsfunktionen ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}
const isDemoDev = d => !!d?.config?.demo;
const simulated = d => DEMO || isDemoDev(d);   // läuft ohne Hardware: Ansagen hört man im Browser
const isOnline = d => isDemoDev(d) || d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 120000;
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
  if (isDemoDev(d)) return '<span class="status on"><i></i>Demo, immer online</span>';
  if (isOnline(d)) return '<span class="status on"><i></i>online</span>';
  return `<span class="status"><i></i>${d.last_seen ? 'zuletzt ' + ago(d.last_seen) : 'noch nie verbunden'}</span>`;
}
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
const sel = (path, cur, opts, attrs = '') => `<select data-k="${path}" ${attrs}>${opts.map(([v, l]) => opt(v, l, cur)).join('')}</select>`;

// Eigener Bestätigungsdialog im Look der App (statt confirm() des Browsers).
function ask({ title, text, ok = 'OK', danger = false }) {
  return new Promise(res => {
    const d = document.createElement('dialog'); d.className = 'dlg';
    d.setAttribute('aria-labelledby', 'dlg-t');
    d.innerHTML = `<form method="dialog"><h2 id="dlg-t">${esc(title)}</h2><p>${esc(text)}</p>
      <div class="dlg-btns"><button value="no" class="ghost">Abbrechen</button><button value="yes" class="${danger ? 'danger solid' : ''}">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { res(d.returnValue === 'yes'); d.remove(); });
    d.addEventListener('click', e => { if (e.target === d) d.close('no'); });
    d.showModal();
  });
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('p4r_theme', next); } catch (e) { /* Speicher gesperrt */ }
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = next === 'dark' ? '#1d2631' : '#f6f8f9';
}

const CONTENT = {
  tft: { abfahrt: 'Bahnhofstafel mit Abfahrten', zugziel: 'Zugzielanzeiger (Gleisanzeige)', uhr: 'Uhr', bild: 'Werbung (Bilder und GIFs)' },
  oled: { abfahrt: 'Abfahrtsliste als Text', uhr: 'Uhr' },
};
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

const newDisplay = slot => ({
  slot, type: 'tft', tft: { model: 'ST7789', w: 240, h: 320, landscape: true },
  oled: { ...OLED_DEFAULT },
  content: 'abfahrt', station: null, rows: 2, filter: '', platform: '', imageIds: [], interval: 10,
});

// ---------- Fahrplandaten (Vorschau direkt aus der PWA) ----------
function applyFilter(list, filter) {
  const f = (filter || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return f.length ? list.filter(d => f.some(x => d.line.toLowerCase().includes(x))) : list;
}

// Rahmen für eine TFT-Darstellung. Die Skalierung auf die Breite des Fensters macht fitScreens().
const tftBox = scr => `<div class="tftwrap" data-w="${scr.w}" data-h="${scr.h}">${scr.html}</div><p class="hint">Genau so erscheint es auf dem Display (${scr.px || scr.w + '×' + scr.h} Pixel).</p>`;
function fitScreens(root) {
  root.querySelectorAll('.tftwrap').forEach(wrapEl => {
    const w = Number(wrapEl.dataset.w), h = Number(wrapEl.dataset.h);
    const avail = wrapEl.parentElement?.clientWidth; if (!avail) return;
    const sc = Math.max(.5, Math.min(avail / w, 2.2));
    const inner = wrapEl.firstElementChild;
    inner.style.transform = `scale(${sc})`;
    wrapEl.style.width = Math.round(w * sc) + 'px'; wrapEl.style.height = Math.round(h * sc) + 'px';
  });
  activateMarquee(root); activateSlides(root);   // Laufschrift und Bildwechsel starten, sobald die Vorschau sichtbar ist
}
window.addEventListener('resize', debounce(() => fitScreens(document), 120));

async function previewHtml(disp) {
  const isOled = disp.type === 'oled';
  const note = t => `<p class="hint">${t}</p>`;
  if (disp.content === 'uhr') return tftBox(isOled ? oledClockScreen({ oled: disp.oled }) : clockScreen({ tft: disp.tft }));
  if (disp.content === 'bild') {
    const items = (disp.imageIds || []).map(id => mediaList.find(m => m.id === id)).filter(Boolean);
    const urls = (await Promise.all(items.map(it => Media.url(it)))).filter(Boolean);
    return urls.length ? tftBox(imageScreen({ tft: disp.tft, urls, interval: disp.interval })) + (urls.length > 1 ? note(`${urls.length} Bilder, Wechsel alle ${disp.interval || 10} Sekunden.`) : '')
      : note('Hake bei den Bildern unten mindestens eine Datei an. Hier erscheint sie dann so, wie sie auf dem Display aussieht.');
  }
  if (disp.content === 'zugziel' && !String(disp.platform || '').trim()) return note('Gib das Gleis ein, dann erscheint hier die Vorschau.');
  if (!disp.station) return note('Wähle einen Bahnhof, dann erscheint hier die Live-Vorschau.');
  try {
    const list = applyFilter(await getDepartures(disp.station, fetch, disp.content === 'zugziel' ? 60 : 15), disp.filter);
    if (!list.length && disp.content !== 'zugziel') return note('Keine Abfahrten gefunden. Prüfe den Linienfilter.');
    if (disp.content === 'zugziel') {
      const onPlat = list.filter(d => platformMatches(d.platform, disp.platform));
      return tftBox(zugzielScreen({ tft: disp.tft, platform: disp.platform, dep: onPlat[0] || null }))
        + (onPlat.length ? '' : note(`Zurzeit keine Abfahrt an Gleis ${esc(disp.platform)}. So sieht die Anzeige dann aus.`));
    }
    if (isOled) return tftBox(oledDepartureScreen({ oled: disp.oled, stationName: disp.station.name, deps: list }));
    return tftBox(departureScreen({ tft: disp.tft, rows: disp.rows || 2, stationName: disp.station.name, deps: list }));
  } catch (e) {
    return note(`Vorschau nicht verfügbar: ${esc(e.message)}.`);
  }
}

// Große Vorschau in einem Fenster, aktualisiert sich selbst.
async function showPreview(disp) {
  const d = document.createElement('dialog'); d.className = 'dlg wide';
  d.innerHTML = `<form method="dialog"><h2>Vorschau Anzeige ${disp.slot}</h2><div id="pv" class="pv"><p class="hint">Lädt …</p></div>
    <div class="dlg-btns"><button value="x">Schließen</button></div></form>`;
  document.body.appendChild(d);
  const draw = async () => { const el = d.querySelector('#pv'); if (!el) return; el.innerHTML = await previewHtml(disp); fitScreens(d); };
  d.addEventListener('close', () => { clearInterval(timer); d.remove(); });
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.showModal(); await draw();
  const timer = setInterval(draw, 20000);
}

// ---------- Router ----------
const routes = [
  [/^#\/?$/, pageDirekt],
  [/^#\/devices$/, pageDevices],
  [/^#\/add$/, pageAdd],
  [/^#\/device\/(.+)$/, pageDevice],
  [/^#\/rocrail$/, () => pageRocrail(app, { esc, toast })],
  [/^#\/media$/, pageMedia],
  [/^#\/installer$/, pageInstaller],
  [/^#\/account$/, pageAccount],
];

async function route() {
  user = await Auth.user();
  $('#banner').textContent = DEMO ? 'Demo-Modus: Die Daten bleiben nur in diesem Browser. Trage in config.js dein Backend ein, um echte Geräte zu koppeln.' : '';
  const h = location.hash || '#/';
  const seg1 = h.split('/')[1] || '';
  const key = seg1 === 'device' || seg1 === 'add' ? 'devices' : ['devices', 'rocrail', 'media', 'installer', 'account'].includes(seg1) ? seg1 : '';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === key));
  if (cleanup) { try { cleanup(); } catch (e) { /* egal */ } cleanup = null; }
  if (Auth.recovery) { if (user) return pageRecovery(); Auth.recovery = false; }
  if (!user) return pageLogin();
  if (Auth.intent?.kind === 'confirmed') { Auth.intent = null; toast('E-Mail bestätigt. Willkommen bei Pro4Rail!'); }
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      try { const r = await fn(m[1]); if (typeof r === 'function') cleanup = r; window.scrollTo(0, 0); }
      catch (e) { app.innerHTML = `<div class="panel"><h2>Das hat nicht geklappt</h2><p>${esc(e.message || e)}</p><a class="btn ghost" href="#/devices">Zur Geräteliste</a></div>`; }
      return;
    }
  }
  location.hash = '#/';
}

// ---------- Anmeldung und Konto ----------
const MAILRE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PW = 8;
const MAIL_ICON = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';

// Anmeldeseite mit mehreren Ansichten: in (Anmelden), up (Konto erstellen), confirm (Mail bestätigen), forgot / resetsent (Passwort vergessen)
function pageLogin(view = 'in', ctx = {}) {
  const fromRoute = Object.keys(ctx).length === 0;   // route() läuft beim Start mehrfach: Hinweis zum Link erst beim ersten Klick verwerfen
  if (!fromRoute && Auth.intent?.kind === 'error') Auth.intent = null;
  if (Auth.intent?.kind === 'error' && view === 'in' && !ctx.msg) {
    ctx = { ...ctx, msg: 'Der Link aus der E-Mail ist abgelaufen oder wurde schon benutzt. Hast du dein Konto schon bestätigt, melde dich einfach an. Sonst fordere unter „Passwort vergessen?“ einen neuen Link an.' };
  }
  const email = ctx.email || '';
  const shell = (title, lead, body) => { app.innerHTML = `<div class="authbox"><div class="pagehead"><h1>${title}</h1></div>${lead ? `<p class="muted authlead">${lead}</p>` : ''}${body}</div>`; };
  const msg = (text, cls = 'errtxt') => `<p class="hint ${cls}" id="msg" role="alert">${text ? esc(text) : ''}</p>`;
  const pwField = (id, label, auto) => `<label class="field pwf"><span class="lbl">${label}</span><span class="pwwrap"><input id="${id}" type="password" autocomplete="${auto}"><button type="button" class="pwtoggle" data-for="${id}" aria-label="Passwort anzeigen oder verbergen">Anzeigen</button></span></label>`;
  const bindToggles = () => document.querySelectorAll('.pwtoggle').forEach(b => b.onclick = () => { const i = $('#' + b.dataset.for), h = i.type === 'password'; i.type = h ? 'text' : 'password'; b.textContent = h ? 'Verbergen' : 'Anzeigen'; });
  const busy = (btn, label, on) => { btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = label; } else btn.textContent = btn.dataset.t || btn.textContent; };
  const setMsg = (t, cls = 'errtxt') => { const m = $('#msg'); m.className = 'hint ' + cls; m.textContent = t; };

  if (view === 'in') {
    shell('Anmelden', '', `<form class="panel" id="f" novalidate>
      <label class="field"><span class="lbl">E-Mail</span><input id="em" type="email" autocomplete="username" value="${esc(email)}"></label>
      <div style="margin-top:14px">${pwField('pw', 'Passwort', 'current-password')}</div>
      ${msg(ctx.msg)}<div id="extra"></div>
      <div class="row" style="margin-top:14px"><button type="submit" id="in">Anmelden</button></div>
      <p class="authlinks"><button type="button" class="linkbtn" id="forgot">Passwort vergessen?</button><span>Noch kein Konto? <button type="button" class="linkbtn" id="up">Konto erstellen</button></span></p></form>`);
    bindToggles();
    $('#forgot').onclick = () => pageLogin('forgot', { email: $('#em').value.trim() });
    $('#up').onclick = () => pageLogin('up', { email: $('#em').value.trim() });
    $('#f').onsubmit = async ev => {
      ev.preventDefault();
      const e = $('#em').value.trim(), p = $('#pw').value;
      if (!MAILRE.test(e)) return setMsg('Bitte gib eine gültige E-Mail-Adresse ein.');
      if (!p) return setMsg('Bitte gib dein Passwort ein.');
      busy($('#in'), 'Melde an …', true); setMsg('', 'hint');
      try { await Auth.signIn(e, p); route(); }
      catch (err) {
        busy($('#in'), '', false); setMsg(err.message);
        if (err.code === 'email_not_confirmed') {
          $('#extra').innerHTML = '<button type="button" class="ghost" id="rs" style="margin-top:8px">Bestätigungsmail erneut senden</button>';
          $('#rs').onclick = async () => { try { await Auth.resend(e); setMsg('Die Mail ist unterwegs. Schau auch im Spam-Ordner nach.', 'okbox'); } catch (x) { setMsg(x.message); } };
        }
      }
    };
    return;
  }

  if (view === 'up') {
    shell('Konto erstellen', 'Mit einer E-Mail-Adresse kann nur ein Konto angelegt werden. Danach schicken wir dir eine Mail, in der du die Adresse bestätigst.', `<form class="panel" id="f" novalidate>
      <label class="field"><span class="lbl">E-Mail</span><input id="em" type="email" autocomplete="username" value="${esc(email)}"></label>
      <div style="margin-top:14px">${pwField('pw', 'Passwort', 'new-password')}</div>
      <p class="hint" style="margin-top:4px">Mindestens ${MIN_PW} Zeichen.</p>
      <div style="margin-top:10px">${pwField('pw2', 'Passwort wiederholen', 'new-password')}</div>
      ${msg(ctx.msg)}<div id="extra"></div>
      <div class="row" style="margin-top:14px"><button type="submit" id="go">Konto erstellen</button></div>
      <p class="authlinks"><span>Schon ein Konto? <button type="button" class="linkbtn" id="back">Anmelden</button></span></p></form>`);
    bindToggles();
    $('#back').onclick = () => pageLogin('in', { email: $('#em').value.trim() });
    $('#f').onsubmit = async ev => {
      ev.preventDefault();
      const e = $('#em').value.trim(), p = $('#pw').value, p2 = $('#pw2').value;
      $('#extra').innerHTML = '';
      if (!MAILRE.test(e)) return setMsg('Bitte gib eine gültige E-Mail-Adresse ein.');
      if (p.length < MIN_PW) return setMsg(`Das Passwort braucht mindestens ${MIN_PW} Zeichen.`);
      if (p !== p2) return setMsg('Die beiden Passwörter sind nicht gleich.');
      busy($('#go'), 'Erstelle Konto …', true); setMsg('', 'hint');
      try {
        const r = await Auth.signUp(e, p);
        if (r.status === 'signedIn') return route();
        if (r.status === 'confirm') return pageLogin('confirm', { email: e });
        busy($('#go'), '', false);
        setMsg('Zu dieser E-Mail-Adresse gibt es schon ein Konto. Melde dich an, oder setze das Passwort zurück, falls du es vergessen hast.');
        $('#extra').innerHTML = '<div class="row" style="margin-top:8px"><button type="button" id="x-in">Zur Anmeldung</button><button type="button" class="ghost" id="x-fg">Passwort vergessen</button></div>';
        $('#x-in').onclick = () => pageLogin('in', { email: e });
        $('#x-fg').onclick = () => pageLogin('forgot', { email: e });
      } catch (err) { busy($('#go'), '', false); setMsg(err.message); }
    };
    return;
  }

  if (view === 'confirm') {
    shell('Bestätige deine E-Mail', '', `<div class="panel authdone"><div class="authicon">${MAIL_ICON}</div>
      <p><strong>Wir haben dir eine Mail an ${esc(email)} geschickt.</strong></p>
      <p>Öffne sie und klicke auf den Bestätigungslink. Erst danach kannst du dich anmelden.</p>
      <p class="hint">Nichts angekommen? Schau im Spam-Ordner nach. Die Mail kann ein paar Minuten brauchen. Hast du dich vertippt, gehe zurück und erstelle das Konto mit der richtigen Adresse.</p>
      ${msg('', 'hint')}
      <div class="row" style="margin-top:14px"><button type="button" id="rs">Mail erneut senden</button><button type="button" class="ghost" id="back">Zur Anmeldung</button></div></div>`);
    $('#back').onclick = () => pageLogin('in', { email });
    const rs = $('#rs'); let t = 0;
    const cool = () => { clearInterval(t); let n = 60; rs.disabled = true; const tick = () => { rs.textContent = `Erneut senden in ${n} s`; if (n-- <= 0) { clearInterval(t); rs.disabled = false; rs.textContent = 'Mail erneut senden'; } }; tick(); t = setInterval(tick, 1000); };
    rs.onclick = async () => { try { await Auth.resend(email); setMsg('Die Mail ist unterwegs.', 'okbox'); cool(); } catch (x) { setMsg(x.message); } };
    return;
  }

  if (view === 'forgot') {
    shell('Passwort vergessen', 'Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.', `<form class="panel" id="f" novalidate>
      <label class="field"><span class="lbl">E-Mail</span><input id="em" type="email" autocomplete="username" value="${esc(email)}"></label>
      ${msg(ctx.msg)}
      <div class="row" style="margin-top:14px"><button type="submit" id="go">Link senden</button><button type="button" class="ghost" id="back">Zurück</button></div></form>`);
    $('#back').onclick = () => pageLogin('in', { email: $('#em').value.trim() });
    $('#f').onsubmit = async ev => {
      ev.preventDefault();
      const e = $('#em').value.trim();
      if (!MAILRE.test(e)) return setMsg('Bitte gib eine gültige E-Mail-Adresse ein.');
      busy($('#go'), 'Sende …', true);
      try { await Auth.resetPassword(e); pageLogin('resetsent', { email: e }); } catch (err) { busy($('#go'), '', false); setMsg(err.message); }
    };
    return;
  }

  if (view === 'resetsent') {
    shell('Mail ist unterwegs', '', `<div class="panel authdone"><div class="authicon">${MAIL_ICON}</div>
      <p><strong>Falls es zu ${esc(email)} ein Konto gibt, haben wir dir einen Link geschickt.</strong></p>
      <p>Klicke darauf und lege ein neues Passwort fest. Schau auch im Spam-Ordner nach.</p>
      <div class="row" style="margin-top:14px"><button type="button" id="back">Zur Anmeldung</button></div></div>`);
    $('#back').onclick = () => pageLogin('in', { email });
  }
}

// Nach dem Klick auf den Link aus der Passwort-Mail: neues Passwort festlegen
function pageRecovery() {
  app.innerHTML = `<div class="authbox"><div class="pagehead"><h1>Neues Passwort</h1></div><p class="muted authlead">Lege ein neues Passwort für ${esc(user.email)} fest.</p>
    <form class="panel" id="f" novalidate>
      <label class="field"><span class="lbl">Neues Passwort</span><input id="pw" type="password" autocomplete="new-password"></label>
      <p class="hint" style="margin-top:4px">Mindestens ${MIN_PW} Zeichen.</p>
      <label class="field" style="margin-top:10px"><span class="lbl">Passwort wiederholen</span><input id="pw2" type="password" autocomplete="new-password"></label>
      <p class="hint errtxt" id="msg" role="alert"></p>
      <div class="row" style="margin-top:14px"><button type="submit" id="go">Passwort speichern</button><button type="button" class="ghost" id="cancel">Abbrechen</button></div></form></div>`;
  const setMsg = t => { $('#msg').textContent = t; };
  $('#cancel').onclick = async () => { await Auth.signOut(); route(); };
  $('#f').onsubmit = async ev => {
    ev.preventDefault();
    const p = $('#pw').value, p2 = $('#pw2').value;
    if (p.length < MIN_PW) return setMsg(`Das Passwort braucht mindestens ${MIN_PW} Zeichen.`);
    if (p !== p2) return setMsg('Die beiden Passwörter sind nicht gleich.');
    $('#go').disabled = true; setMsg('');
    try { await Auth.setPassword(p); toast('Passwort geändert. Du bist angemeldet.'); location.hash = '#/'; route(); }
    catch (err) { $('#go').disabled = false; setMsg(err.message); }
  };
}

function pageAccount() {
  app.innerHTML = `<div class="pagehead"><h1>Konto</h1></div><div class="panel" style="max-width:520px"><p><strong>${esc(user.email)}</strong></p>
    ${DEMO ? '<p class="muted">Im Demo-Modus ist keine Anmeldung nötig. Alle Daten liegen nur in diesem Browser.</p><button id="reset" class="danger">Demo-Daten löschen</button>' : '<button id="out" class="ghost">Abmelden</button>'}</div>`;
  if (DEMO) $('#reset').onclick = async () => { if (await ask({ title: 'Demo-Daten löschen?', text: 'Alle Demo-Daten in diesem Browser werden gelöscht.', ok: 'Löschen', danger: true })) { Object.keys(localStorage).filter(k => k.startsWith('demo_')).forEach(k => localStorage.removeItem(k)); location.hash = '#/'; location.reload(); } };
  else $('#out').onclick = async () => { await Auth.signOut(); route(); };
}

// ---------- Geräteliste ----------
async function pageDevices() {
  const list = await Devices.list();
  const rows = list.map((d, i) => {
    const disp = d.config?.displays || [];
    const rules = d.config?.audio?.rules?.length || 0;
    const chips = disp.map(x => `<span class="chip">Anzeige ${x.slot}: ${x.type === 'oled' ? 'OLED' : 'TFT'}${x.station ? ', ' + esc(x.station.name) : ''}</span>`).join('')
      + (rules ? `<span class="chip">${rules} ${rules === 1 ? 'Ansage' : 'Ansagen'}</span>` : '');
    return `<a class="dev ${isOnline(d) ? 'on' : ''}" href="#/device/${esc(d.id)}">
      <span class="gleis" aria-hidden="true">${i + 1}</span>
      <span><span class="dev-name">${esc(d.name)}</span><span class="dev-meta">${chips || '<span class="chip">Noch keine Anzeige</span>'}</span></span>
      ${statusHtml(d)}</a>`;
  }).join('');
  app.innerHTML = `<div class="pagehead"><h1>Meine Geräte</h1><a class="btn" href="#/add">Gerät hinzufügen</a></div>` +
    (list.length ? `<div class="devlist">${rows}</div>`
      : `<div class="panel empty"><h2>Noch kein Gerät</h2><p class="muted">Richte deinen ersten ESP32 ein. Du brauchst dafür nur ein WLAN und etwa fünf Minuten. Oder probiere die App erst mit einem Demo-Gerät aus.</p><div class="row"><a class="btn" href="#/add">Gerät hinzufügen</a><button class="ghost" id="demo2" type="button">Demo-Gerät anlegen</button></div></div>`);
  bindDemoBtn('#demo2');
}
// Demo-Gerät anlegen und direkt öffnen
function bindDemoBtn(sel) {
  const b = $(sel); if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try { const d = await Devices.createDemo('Demo-Gerät'); location.hash = '#/device/' + d.id; }
    catch (e) { b.disabled = false; toast(e.message); }
  };
}

// ---------- Gerät hinzufügen ----------
async function pageAdd() {
  app.innerHTML = `<div class="pagehead"><h1>Gerät hinzufügen</h1></div>
  <div class="panel" style="margin-bottom:16px">
    <ol class="steps">
      <li><div><h3>Firmware installieren</h3><p class="muted" style="margin:2px 0 8px">Nur bei einem neuen ESP32 ohne Pro4Rail-Firmware nötig. Der Installer arbeitet per USB am Computer.</p><a class="btn ghost small desktop-only" href="#/installer">Zum Installer</a><p class="muted desktop-hint">Der Installer funktioniert nur am Computer mit Chrome oder Edge.</p></div></li>
      <li><div><h3>Kopplungscode erzeugen</h3><p class="muted" style="margin:2px 0 8px">Der Code gilt 15 Minuten und nur für ein Gerät.</p><button id="gen" class="small">Code erzeugen</button><div id="codebox" style="margin-top:14px"></div></div></li>
      <li><div><h3>Mit dem WLAN des Geräts verbinden</h3><p class="muted" style="margin:2px 0 0">Der ESP32 öffnet nach dem Einschalten ein WLAN mit dem Namen Tafel und vier Zeichen dahinter. Verbinde dein Handy damit. Das Einrichtungsfenster öffnet sich von selbst, sonst rufst du <strong>192.168.4.1</strong> im Browser auf.</p></div></li>
      <li><div><h3>WLAN und Code eingeben</h3><p class="muted" style="margin:2px 0 0">Wähle dein Heimnetz, gib das Passwort und den Kopplungscode ein und speichere. Danach erscheint das Gerät in deiner Liste.</p></div></li>
    </ol>
  </div>
  <p class="muted" style="max-width:640px">Warum nicht direkt hier? Diese App läuft über HTTPS, das Einrichtungs-WLAN des Geräts nur über HTTP. Der Browser blockiert diese Verbindung, deshalb läuft der WLAN-Schritt im Fenster des Geräts.</p>
  <div class="panel" style="margin-top:16px;max-width:520px"><h3>Ohne Hardware ausprobieren</h3><p class="muted" style="margin:4px 0 12px">Das Demo-Gerät hat eine Anzeige, Licht und Lautsprecher und ist immer online. Du kannst alles einstellen und in der Vorschau sehen. Gesendet wird an keine echte Hardware. Löschen kannst du es jederzeit.</p><button id="sim" class="ghost small" type="button">Demo-Gerät anlegen</button></div>`;
  $('#gen').onclick = async () => {
    try {
      const { code, expires } = await Devices.createPairingCode();
      $('#codebox').innerHTML = `<div class="code" aria-label="Kopplungscode ${code.split('').join(' ')}">${code}</div><p class="hint">Gültig bis ${hhmm(expires)} Uhr</p>`;
    } catch (e) { toast('Code konnte nicht erzeugt werden: ' + e.message); }
  };
  bindDemoBtn('#sim');
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
function ruleSummary(r, cfg = draft.config) {
  if (r.trigger === 'zeit') return `${daysText(r.days || [])} um ${r.time || '--:--'} Uhr`;
  const d = cfg.displays.find(x => x.slot === r.slot && x.station);
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
  const soundOpts = [['', 'MP3 wählen …'], ['auto', 'Gong (Sprachansage folgt später)'], ...audios.map(m => [m.id, m.name])];
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

async function hearRule(r, cfg = draft?.config) {
  if (player) { player.pause(); player = null; }
  speechSynthesis?.cancel?.();
  if (!r.mediaId) { toast('Wähle zuerst eine MP3 oder die automatische Ansage.'); return false; }
  if (r.mediaId === 'auto') {   // wie auf dem Gerät: zwei Töne als Gong, noch keine gesprochene Ansage
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)(); let t = ac.currentTime;
      for (const [f, d] of [[880, .25], [659, .4]]) {
        const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(.35 * cfg.audio.volume / 100, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.start(t); o.stop(t + d); t += d * .9;
      }
      return true;
    } catch { toast('Dieser Browser kann den Gong nicht abspielen.'); return false; }
  }
  const item = mediaList.find(m => m.id === r.mediaId);
  const url = item ? await Media.url(item) : null;
  if (!url) { toast('Diese Datei ist hier nicht abspielbar. Lade die MP3 bei den Medien erneut hoch.'); return false; }
  player = new Audio(url); player.volume = cfg.audio.volume / 100;
  try { await player.play(); return true; } catch (e) { toast('Wiedergabe nicht möglich: ' + e.message); return false; }
}

// ---------- Gerät bearbeiten ----------
function normConfig(c) {
  const base = defaultConfig();
  const o = { ...base, ...c };
  o.features = { ...base.features, ...o.features };
  o.light = { ...base.light, ...o.light };
  o.audio = { ...base.audio, ...o.audio };
  if (!BOARDS[o.board]) o.board = base.board;
  if (!Array.isArray(o.audio.rules)) o.audio.rules = [];
  if (!Array.isArray(o.displays)) o.displays = [];
  // Ältere Geräte: Segmentanzeigen gibt es nicht mehr, sie werden zu OLED-Textdisplays. Fehlende Teile ergänzen.
  o.displays = o.displays.map(d => {
    const n = { ...d, tft: { model: 'ST7789', w: 240, h: 320, landscape: true, ...d.tft }, oled: { ...OLED_DEFAULT, ...d.oled } };
    n.imageIds = Array.isArray(n.imageIds) ? n.imageIds : (n.imageId ? [n.imageId] : []);   // früher nur ein Bild
    delete n.imageId;
    n.interval = Math.min(3600, Math.max(2, Number(n.interval) || 10)); n.platform = n.platform || '';
    if (n.type === 'seg') { n.type = 'oled'; n.content = n.content === 'uhr' ? 'uhr' : 'abfahrt'; }
    delete n.seg;
    if (!OLED_MODELS[n.oled.model]) n.oled.model = OLED_DEFAULT.model;
    if (!OLED_COLORS[n.oled.color]) n.oled.color = OLED_DEFAULT.color;
    if (!CONTENT[n.type]?.[n.content]) n.content = 'abfahrt';
    return n;
  });
  return o;
}

async function pageDevice(id) {
  const list = await Devices.list();
  const idx = list.findIndex(d => d.id === id);
  if (idx < 0) { location.hash = '#/devices'; return; }
  devIndex = idx + 1;
  draft = JSON.parse(JSON.stringify(list[idx]));
  draft.config = normConfig(draft.config);
  mediaList = await Media.list();
  tab = 'direkt'; dirty = false;
  openDisp.clear(); if (draft.config.displays[0]) openDisp.add(draft.config.displays[0].slot);
  renderDevice();
}

function markDirty() {
  dirty = true;
  const sb = $('.savebar'); if (sb) sb.classList.add('changed');
}

const feat = k => draft.config.features?.[k] !== false;
// Reiter, die zu abgewählten Funktionen gehören, verschwinden.
function visibleTabs() {
  return [['direkt', 'Direkt', true], ['anzeigen', 'Anzeigen', feat('displays')], ['ansagen', 'Ansagen', feat('audio')],
    ['licht', 'Licht', feat('light')], ['pins', 'Anschlüsse', true], ['geraet', 'Gerät', true]].filter(t => t[2]);
}

const lightPayload = c => ({ on: c.light.on, brightness: c.light.dimmable === false ? 100 : c.light.brightness });

// Funktionsliste eines Geräts. Wird im Reiter Direkt und auf der Startseite verwendet.
function fnItems(dev) {
  const c = dev.config; const did = `data-dev="${esc(dev.id)}"`;
  const items = [];
  if (c.features.light) {
    items.push(`<div class="fn"><div class="fn-main"><b>Licht</b><small>Beleuchtung am Gerät</small></div>
      <label class="switch"><input type="checkbox" data-d="light-on" ${did} aria-label="Licht ${esc(dev.name)}" ${c.light.on ? 'checked' : ''}><span class="tr"></span><span class="tx">${c.light.on ? 'An' : 'Aus'}</span></label></div>`);
    if (c.light.dimmable !== false) items.push(`<div class="fn slide"><label class="field"><span class="lbl">Helligkeit <b class="val">${c.light.brightness}%</b></span>
      <input type="range" min="0" max="100" data-d="light-bri" ${did} value="${c.light.brightness}"></label></div>`);
  }
  if (c.features.audio) {
    items.push(`<div class="fn slide"><label class="field"><span class="lbl">Lautstärke <b class="val">${c.audio.volume}%</b></span>
      <input type="range" min="0" max="100" data-d="vol" ${did} value="${c.audio.volume}"></label></div>`);
    const rules = c.audio.rules.map((r, i) => r.mediaId ? `<div class="fn"><div class="fn-main"><b>${esc(r.name)}</b><small>${esc(ruleSummary(r, c))}</small></div>
      <button type="button" class="small" data-d="play" ${did} data-i="${i}">Abspielen</button></div>` : '').join('');
    items.push(rules || `<div class="fn"><div class="fn-main"><b>Ansagen</b><small>Noch keine Ansage mit MP3. Lege sie am Gerät im Reiter Ansagen an.</small></div></div>`);
  }
  if (c.features.displays) c.displays.forEach(d => items.push(`<div class="fn"><div class="fn-main"><b>Anzeige ${d.slot}</b><small>${d.station ? esc(d.station.name) : 'Kein Bahnhof gewählt'}</small></div>
      <button type="button" class="ghost small" data-d="refresh" ${did} data-slot="${d.slot}">Aktualisieren</button></div>`));
  return items.length ? `<div class="panel fnlist">${items.join('')}</div>`
    : '<div class="panel empty"><h2>Keine Funktion aktiv</h2><p class="muted">Aktiviere am Gerät im Reiter Gerät, was verbaut ist.</p></div>';
}

function tabDirekt() {
  const off = isDemoDev(draft) && !DEMO ? '<p class="callout">Demo-Gerät: Änderungen werden gespeichert, aber an keine Hardware gesendet.</p>' : !DEMO && !isOnline(draft) ? '<p class="callout">Das Gerät ist gerade offline. Befehle kommen erst an, wenn es sich wieder meldet.</p>' : '';
  return `${off}${fnItems(draft)}<p class="hint">Hier wirkt jede Änderung sofort. Sie wird auch dauerhaft gespeichert.</p>`;
}

// Startseite: alle Geräte mit ihren Funktionen, dazu Schalter für alle Lichter.
async function pageDirekt() {
  const list = await Devices.list();
  const devs = list.map(d => ({ ...d, config: normConfig(d.config) }));
  const lit = devs.filter(d => d.config.features.light);
  if (!devs.length) {
    app.innerHTML = `<div class="pagehead"><h1>Direkt</h1></div><div class="panel empty"><h2>Noch kein Gerät</h2><p class="muted">Sobald du ein Gerät eingerichtet hast, bedienst du hier alles direkt.</p><div class="row"><a class="btn" href="#/add">Gerät hinzufügen</a><button class="ghost" id="demo3" type="button">Demo-Gerät anlegen</button></div></div>`;
    bindDemoBtn('#demo3');
    return;
  }
  app.innerHTML = `<div class="pagehead"><h1>Direkt</h1></div>
    ${lit.length ? `<div class="panel alllights"><div class="fn-main"><b>Alle Lichter</b><small>${plural(lit.length, 'Gerät', 'Geräte')} mit Licht</small></div>
      <div class="row"><button type="button" data-all="1">Alle an</button><button type="button" class="ghost" data-all="0">Alle aus</button></div></div>` : ''}
    ${devs.map(d => `<section class="dgroup"><div class="dg-head"><h2><a href="#/device/${esc(d.id)}">${esc(d.name)}</a></h2>${statusHtml(d)}</div>${fnItems(d)}</section>`).join('')}`;
  bindFn(app, id => devs.find(d => d.id === id));
  app.querySelectorAll('[data-all]').forEach(b => b.onclick = async () => {
    const on = b.dataset.all === '1';
    await Promise.all(lit.map(d => { d.config.light.on = on; return directSave(d.id, x => { x.light = { ...(x.light || {}), on }; }, 'light', lightPayload(d.config)); }));
    toast(on ? 'Alle Lichter an' : 'Alle Lichter aus');
    pageDirekt();
  });
}

// Auswahl der Bilder für eine Werbeanzeige. Die Reihenfolge ist die Reihenfolge des Anhakens.
function imagePicker(d, i, images) {
  if (!images.length) return '<p class="hint" style="margin-top:14px">Noch keine Bilder. Lade bei <a href="#/media">Medien</a> JPEG, PNG oder GIF hoch.</p>';
  const sel = d.imageIds || [];
  return `<div style="margin-top:14px"><span class="lbl">Bilder (der Reihe nach, bei mehreren wechseln sie automatisch)</span><ul class="imgpick">${images.map(m => {
    const n = sel.indexOf(m.id) + 1;
    return `<li><label><input type="checkbox" data-img="${i}" value="${esc(m.id)}" ${n ? 'checked' : ''}><img data-mid="${esc(m.id)}" alt=""><span class="nm">${esc(m.name)}</span>${n ? `<span class="ord" title="Reihenfolge">${n}</span>` : ''}</label></li>`;
  }).join('')}</ul></div>`;
}
async function loadThumbs(root) {
  for (const img of root.querySelectorAll('img[data-mid]:not([src])')) {
    const it = mediaList.find(m => m.id === img.dataset.mid); const u = it ? await Media.url(it) : null; if (u) img.src = u;
  }
}

function tabAnzeigen() {
  const c = draft.config;
  const images = mediaList.filter(m => m.kind === 'image');
  const blocks = c.displays.map((d, i) => {
    const p = `config.displays.${i}`;
    const isOled = d.type === 'oled';
    const needsStation = d.content === 'abfahrt' || d.content === 'zugziel';
    const sum = isOled ? `OLED ${OLED_MODELS[d.oled.model].label}` : `TFT ${d.tft.model}`;
    return `<details class="panel disp" data-slot="${d.slot}" ${openDisp.has(d.slot) ? 'open' : ''}>
      <summary><span class="disp-t"><b>Anzeige ${d.slot}</b><small>${esc(sum)}${d.station ? ', ' + esc(d.station.name) : ''}</small></span><i class="chev" aria-hidden="true"></i></summary>
      <div class="grid">
        <label class="field"><span class="lbl">Bauart</span>${sel(`${p}.type`, d.type, [['tft', 'TFT-Display'], ['oled', 'OLED-Textdisplay (I²C)']], 'data-rerender')}</label>
        ${isOled ? `
          <label class="field"><span class="lbl">Modell</span>${sel(`${p}.oled.model`, d.oled.model, Object.entries(OLED_MODELS).map(([k, v]) => [k, v.label]), 'data-rerender')}</label>
          <label class="field"><span class="lbl">Farbe der Pixel</span>${sel(`${p}.oled.color`, d.oled.color, Object.entries(OLED_COLORS).map(([k, v]) => [k, v.label]), 'data-rerender')}</label>
          ${muxOn(c) && c.mux.manual ? `<label class="field"><span class="lbl">Kanal am Multiplexer</span>${sel(`${p}.oled.channel`, muxPlan(c).channels[d.slot] ?? 0, Array.from({ length: MUX_MAX }, (_, n) => [n, `Kanal ${n} (SD${n} und SC${n})`]), 'data-num data-rerender')}</label>` : ''}` : `
          <label class="field"><span class="lbl">Modell</span>${sel(`${p}.tft.model`, d.tft.model, Object.entries(TFT_MODELS).map(([k, v]) => [k, v.label]), 'data-rerender')}</label>
          <label class="field"><span class="lbl">Ausrichtung</span>${sel(`${p}.tft.landscape`, String(d.tft.landscape !== false), [['true', 'Querformat (wie eine Bahnhofstafel)'], ['false', 'Hochformat']], 'data-bool data-rerender')}</label>`}
        <label class="field"><span class="lbl">Inhalt</span>${sel(`${p}.content`, d.content, Object.entries(CONTENT[d.type]), 'data-rerender')}</label>
        ${isOled && d.content === 'abfahrt' ? `
          <label class="field"><span class="lbl">Rechte Spalte</span>${sel(`${p}.oled.right`, d.oled.right, [['min', 'Minuten bis Abfahrt'], ['zeit', 'Abfahrtszeit (mit Verspätung)']], 'data-rerender')}</label>
          <label class="field"><span class="lbl">Kopfzeile</span>${sel(`${p}.oled.header`, String(d.oled.header !== false), [['true', 'Bahnhof und Uhrzeit'], ['false', 'Aus (mehr Abfahrten)']], 'data-bool data-rerender')}</label>` : ''}
        ${!isOled && d.content === 'abfahrt' ? `<label class="field"><span class="lbl">Zeilen</span>${sel(`${p}.rows`, d.rows, [1, 2, 3, 4].map(n => [n, n]), 'data-num data-rerender')}</label>` : ''}
        ${needsStation ? `<label class="field"><span class="lbl">Nur diese Linien (zum Beispiel RE5, S1)</span><input type="text" data-rerender data-k="${p}.filter" value="${esc(d.filter)}"></label>` : ''}
        ${!isOled && d.content === 'zugziel' ? `<label class="field"><span class="lbl">Gleis (zum Beispiel 3 oder 3,4)</span><input type="text" data-rerender data-k="${p}.platform" value="${esc(d.platform)}" maxlength="12" autocomplete="off"></label>` : ''}
        ${!isOled && d.content === 'bild' ? `<label class="field"><span class="lbl">Sekunden pro Bild</span><input type="number" min="2" max="3600" data-num data-rerender data-k="${p}.interval" value="${d.interval || 10}"></label>` : ''}
      </div>
      ${!isOled && d.content === 'bild' ? imagePicker(d, i, images) : ''}
      ${needsStation ? `<div style="margin-top:14px"><label class="field"><span class="lbl">Bahnhof${d.station ? `: <strong style="color:var(--ink)">${esc(d.station.name)}</strong>` : ''}</span>
        <input type="text" placeholder="Bahnhof suchen" data-search="${i}" autocomplete="off"></label><div class="res" id="res${i}" hidden></div></div>` : ''}
      ${isOled && d.content === 'abfahrt' ? `<p class="hint" style="margin-top:10px">Dieses Display hat ${oledSize(d.oled).cols} Zeichen pro Zeile und zeigt ${oledSize(d.oled).lines - (d.oled.header !== false ? 1 : 0)} Abfahrten.</p>` : ''}
      <div class="prev" data-prev="${i}"><p class="hint">Vorschau wird geladen</p></div>
      <div class="row disp-foot"><button type="button" class="small" data-act="bigprev" data-i="${i}">Vorschau</button><button type="button" class="ghost small" data-act="topins">Anschlüsse</button><button type="button" class="danger small" data-act="rm" data-i="${i}">Entfernen</button></div>
    </details>`;
  }).join('');
  const maxD = maxDisplays(c);
  const add = c.displays.length < maxD
    ? `<button type="button" class="${c.displays.length ? 'ghost' : ''}" data-act="add">Anzeige hinzufügen</button>`
    : `<p class="muted">${muxOn(c) ? `Mit dem Multiplexer sind höchstens ${maxD} Anzeigen möglich.` : `Dieses Board unterstützt höchstens ${maxD} Anzeigen. Mit einem Multiplexer (Reiter Gerät) sind bis zu ${MUX_MAX} OLED-Anzeigen möglich.`}</p>`;
  return warnHtml() + (blocks || `<div class="panel empty" style="margin-bottom:16px"><h2>Noch keine Anzeige</h2><p class="muted">Füge die erste Anzeige hinzu und wähle, ob ein TFT oder ein OLED-Textdisplay angeschlossen ist.</p></div>`) + add;
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
  const l = draft.config.light; const dim = l.dimmable !== false;
  return `<section class="panel" style="max-width:560px"><div class="row sp" style="margin-bottom:14px"><label class="switch"><input type="checkbox" data-k="config.light.on" ${l.on ? 'checked' : ''}><span class="tr"></span><span class="tx">Licht an</span></label></div>
    ${dim ? `<label class="field"><span class="lbl">Helligkeit <b class="val">${l.brightness}%</b></span><input type="range" min="0" max="100" data-num data-k="config.light.brightness" value="${l.brightness}"></label>`
      : '<p class="hint" style="margin-top:0">Dieses Licht ist nicht dimmbar. Du kannst das im Reiter Gerät ändern.</p>'}
    <p class="hint">Änderungen wirken sofort am Gerät. Zum dauerhaften Speichern der Einstellung unten auf Speichern tippen.</p></section>`;
}

const warnHtml = () => boardWarnings(draft.config).map(w => `<p class="callout warn">${esc(w)}</p>`).join('');

function tabPins() {
  const sets = pinSets(draft.config).map(s => `<section class="pinset"><h3>${esc(s.title)}</h3><p class="muted">${esc(s.sub)}</p>
    <div class="pins"><div class="pin head muted"><span>Pin am ESP32</span><span></span><span>Beschriftung am Modul</span></div>
      ${s.rows.map(r => `<div class="pin"><span class="gpio ${r.pwr ? 'pwr' : ''}">${/^\d+$/.test(String(r.gpio)) ? 'GPIO ' : ''}${esc(r.gpio)}</span><span class="track"></span>
        <span class="mod"><b>${esc(r.mod)}</b>${r.alt || r.note ? `<small>${[r.alt, r.note].filter(Boolean).map(esc).join(', ')}</small>` : ''}</span></div>`).join('')}
    </div>${s.notes.map(n => `<p class="hint">${esc(n)}</p>`).join('')}</section>`).join('');
  const B = boardOf(draft.config);
  return `<div class="callout"><p><strong>${esc(B.name)}</strong></p><p>${esc(B.warning)}</p></div>${warnHtml()}${sets}`;
}

// Multiplexer TCA9548A: mehr als zwei OLEDs an zwei Pins. Die Belegung ergibt sich von selbst und lässt sich bei Bedarf selbst festlegen.
function muxRows() {
  const c = draft.config; c.mux = { on: false, manual: false, addr: 0x70, sda: null, scl: null, ...(c.mux || {}) };
  const on = muxOn(c); const plan = muxPlan(c);
  let h = `<div class="fn sub"><div class="fn-main"><b>Multiplexer TCA9548A</b><small>Ein kleines Zusatzmodul, an dem bis zu ${MUX_MAX} OLED-Anzeigen an nur zwei Pins hängen. Ohne Multiplexer sind höchstens zwei OLEDs möglich.</small></div>
    <label class="switch"><input type="checkbox" data-k="config.mux.on" data-rerender aria-label="Multiplexer verbaut" ${c.mux.on ? 'checked' : ''}><span class="tr"></span></label></div>`;
  if (!on) return h;
  h += `<div class="fn sub"><div class="fn-main"><b>Belegung selbst festlegen</b><small>Normalerweise ergibt sich alles von selbst: Adresse 0x70, die Pins ${plan.manual ? '' : `GPIO ${plan.sda} und ${plan.scl}, `}und Kanal 0, 1, 2 … in der Reihenfolge der Anzeigen. Nur ändern, wenn dein Aufbau anders verdrahtet ist.</small></div>
    <label class="switch"><input type="checkbox" data-k="config.mux.manual" data-rerender aria-label="Belegung selbst festlegen" ${c.mux.manual ? 'checked' : ''}><span class="tr"></span></label></div>`;
  if (c.mux.manual) {
    const pins = busPinChoices(c).map(g => [g, `GPIO ${g}`]);
    h += `<div class="fn sub"><div class="fn-main"><b>Adresse und Pins</b><small>Adresse des Multiplexers (Werkseinstellung 0x70) und die zwei Pins am ESP32. Den Kanal jeder OLED wählst du in der jeweiligen Anzeige.</small></div>
      <div class="grid" style="min-width:min(100%,340px)">
        <label class="field"><span class="lbl">Adresse</span>${sel('config.mux.addr', plan.addr, Array.from({ length: 8 }, (_, i) => [0x70 + i, '0x' + (0x70 + i).toString(16).toUpperCase()]), 'data-num data-rerender')}</label>
        <label class="field"><span class="lbl">SDA</span>${sel('config.mux.sda', plan.sda, pins, 'data-num data-rerender')}</label>
        <label class="field"><span class="lbl">SCL</span>${sel('config.mux.scl', plan.scl, pins, 'data-num data-rerender')}</label></div></div>`;
  }
  return h;
}

function tabGeraet() {
  return `<section class="panel" style="max-width:560px"><label class="field"><span class="lbl">Name des Geräts</span><input type="text" data-k="name" value="${esc(draft.name)}"></label>
    <label class="field" style="margin-top:14px"><span class="lbl">Board</span>${sel('config.board', draft.config.board, Object.entries(BOARDS).map(([k, v]) => [k, v.name]), 'data-rerender')}</label>
    <p class="hint">Bestimmt die Anschlussbelegung im Reiter Anschlüsse. Die Firmware muss zum Board passen.</p>
    <p class="hint">Geräte-ID: ${esc(draft.device_uid)}</p></section>
    <section class="section" style="margin-top:32px;max-width:560px"><h2>Funktionen</h2>
      <p class="muted">Schalte ab, was an diesem Gerät nicht verbaut ist. Die Funktion verschwindet aus der App und braucht keine Anschlüsse. Einstellungen bleiben erhalten.</p>
      <div class="panel fnlist">${[['displays', 'Anzeigen', 'TFT oder OLED-Anzeigen'], ['audio', 'Lautsprecher', 'Ansagen und Lautstärke'], ['light', 'Beleuchtung', 'Schaltbares Licht']].map(([k, t, s]) => `
        <div class="fn"><div class="fn-main"><b>${t}</b><small>${s}</small></div>
          <label class="switch"><input type="checkbox" data-k="config.features.${k}" data-rerender aria-label="${t} verbaut" ${feat(k) ? 'checked' : ''}><span class="tr"></span></label></div>${k === 'displays' && feat('displays') ? muxRows() : ''}${k === 'light' && feat('light') ? `
        <div class="fn sub"><div class="fn-main"><b>Art des Lichts</b><small>Relais oder Schalter: nur An und Aus. MOSFET-Modul: stufenlos dimmbar.</small></div>
          ${sel('config.light.dimmable', String(draft.config.light.dimmable !== false), [['false', 'Relais (An und Aus)'], ['true', 'MOSFET (dimmbar)']], 'data-bool data-rerender')}</div>${draft.config.light.dimmable === false ? `
        <div class="fn sub"><div class="fn-main"><b>Relais schaltet bei LOW</b><small>Viele Relaismodule schalten, wenn der Eingang auf LOW geht (Low-Level-Trigger). Schaltet dein Licht verkehrt herum, aktiviere das.</small></div>
          <label class="switch"><input type="checkbox" data-k="config.light.invert" data-rerender aria-label="Relais schaltet bei LOW" ${draft.config.light.invert ? 'checked' : ''}><span class="tr"></span></label></div>` : ''}` : ''}`).join('')}</div></section>
    <section class="section" style="margin-top:32px;max-width:560px"><h2>Gerät entkoppeln</h2>
      <p class="muted">Das Gerät verschwindet aus deinem Konto und muss danach neu eingerichtet werden.</p>
      <button type="button" class="danger" data-act="del">Gerät entkoppeln</button></section>`;
}

function renderDevice() {
  const y = window.scrollY;
  if (!visibleTabs().some(t => t[0] === tab)) tab = 'direkt';
  const body = { direkt: tabDirekt, anzeigen: tabAnzeigen, ansagen: tabAnsagen, licht: tabLicht, pins: tabPins, geraet: tabGeraet }[tab]();
  app.innerHTML = `
    <div class="pagehead"><div class="lead"><span class="gleis" aria-hidden="true">${devIndex}</span><div><h1>${esc(draft.name)}</h1>${statusHtml(draft)}</div></div></div>
    <div class="tabs" role="tablist">${visibleTabs().map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    ${body}
    <div class="savebar ${dirty ? 'changed' : ''}"><span class="clean">Alles gespeichert</span><span class="dirty">Ungespeicherte Änderungen</span><button type="button" data-act="save">Speichern</button></div>`;
  window.scrollTo(0, y);
  app.querySelector('.tabs .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  bindDevice();
  if (tab === 'anzeigen') { fillPreviews(); loadThumbs(app); }
}

async function fillPreviews() {
  const els = [...app.querySelectorAll('[data-prev]')];
  await Promise.all(els.map(async el => {
    const d = draft.config.displays[Number(el.dataset.prev)];
    if (!d) return;
    const html = await previewHtml(d);
    if (app.contains(el)) { el.innerHTML = html; fitScreens(el); }
  }));
}

async function directSave(devId, mutate, cmdType, payload) {
  try {
    await Devices.patchConfig(devId, mutate);
    if (cmdType) await Devices.command(devId, cmdType, payload);
  } catch (e) { toast('Senden nicht möglich: ' + e.message); }
}

// Bedienelemente der Funktionsliste. getDev liefert zum data-dev-Wert das Gerät samt Konfiguration.
function bindFn(root, getDev) {
  root.querySelectorAll('[data-d]').forEach(el => {
    const dev = getDev(el.dataset.dev); if (!dev) return;
    const c = dev.config; const d = el.dataset.d;
    if (el.type === 'range') el.addEventListener('input', () => { const b = el.closest('.field')?.querySelector('.val'); if (b) b.textContent = el.value + '%'; });
    if (d === 'light-on') el.onchange = () => {
      c.light.on = el.checked; const tx = el.closest('.switch').querySelector('.tx'); if (tx) tx.textContent = el.checked ? 'An' : 'Aus';
      directSave(dev.id, x => { x.light = { ...(x.light || {}), on: c.light.on }; }, 'light', lightPayload(c));
    };
    else if (d === 'light-bri') el.onchange = () => {
      c.light.brightness = Number(el.value);
      directSave(dev.id, x => { x.light = { ...(x.light || {}), brightness: c.light.brightness }; }, 'light', lightPayload(c));
    };
    else if (d === 'vol') el.onchange = () => {
      c.audio.volume = Number(el.value);
      directSave(dev.id, x => { x.audio = { ...(x.audio || {}), volume: c.audio.volume }; }, 'volume', { volume: c.audio.volume });
    };
    else if (d === 'play') el.onclick = async () => {
      const r = c.audio.rules[Number(el.dataset.i)];
      try {
        await Devices.command(dev.id, 'announce', { rule: r, volume: c.audio.volume });
        if (simulated(dev)) { mediaList = await Media.list(); await hearRule(r, c); toast('Demo: Die Ansage läuft in diesem Browser.'); } else toast('Ansage gesendet');
      } catch (e) { toast('Senden nicht möglich: ' + e.message); }
    };
    else if (d === 'refresh') el.onclick = async () => {
      try { clearDepartureCache(); await Devices.command(dev.id, 'refresh', { slot: Number(el.dataset.slot) }); toast(simulated(dev) ? 'Demo: Anzeige würde jetzt aktualisiert.' : 'Anzeige wird aktualisiert'); }
      catch (e) { toast('Senden nicht möglich: ' + e.message); }
    };
  });
}

let lightTimer;
function sendLight() {
  clearTimeout(lightTimer);
  lightTimer = setTimeout(() => Devices.command(draft.id, 'light', lightPayload(draft.config)).catch(e => toast('Licht konnte nicht geschaltet werden: ' + e.message)), 300);
}

function bindDevice() {
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderDevice(); window.scrollTo(0, 0); });

  app.querySelectorAll('details[data-slot]').forEach(d => d.addEventListener('toggle', () => {
    const s = Number(d.dataset.slot); d.open ? openDisp.add(s) : openDisp.delete(s);
    if (d.open) fitScreens(d);
  }));
  bindFn(app, () => draft);

  app.querySelectorAll('[data-img]').forEach(el => el.addEventListener('change', () => {
    const d = draft.config.displays[Number(el.dataset.img)]; const set = (d.imageIds || []).filter(x => x !== el.value);
    if (el.checked) set.push(el.value);
    d.imageIds = set; markDirty(); renderDevice();
  }));
  app.querySelectorAll('[data-k]').forEach(el => {
    const val = () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.hasAttribute('data-num')) v = Number(v);
      if (el.hasAttribute('data-bool')) v = v === 'true';
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
        const d = draft.config.displays[m[1]]; d.content = 'abfahrt'; d.oled = { ...OLED_DEFAULT, ...d.oled };
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
      const slot = Array.from({ length: maxDisplays(draft.config) }, (_, n) => n + 1).find(s => !used.includes(s));
      const nd = newDisplay(slot);
      if (muxOn(draft.config) && draft.config.displays.filter(x => x.type !== 'oled').length >= boardOf(draft.config).maxDisplays) nd.type = 'oled', nd.content = 'abfahrt';   // TFT-Plätze sind belegt, mit dem Multiplexer geht eine OLED
      draft.config.displays.push(nd); openDisp.add(slot); markDirty(); renderDevice();
    } else if (a === 'rm') {
      const slot = draft.config.displays[i].slot;
      draft.config.displays.splice(i, 1);
      rules.forEach(r => { if (r.slot === slot) r.slot = 0; });
      markDirty(); renderDevice();
    } else if (a === 'bigprev') {
      await showPreview(draft.config.displays[i]);
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
        if (simulated(draft)) { await hearRule(r); toast('Demo: Die Ansage läuft in diesem Browser.'); }
        else toast('Testansage an das Gerät gesendet');
      } catch (e) { toast('Senden nicht möglich: ' + e.message); }
    } else if (a === 'save') {
      try { await Devices.save(draft); dirty = false; $('.savebar')?.classList.remove('changed'); toast('Gespeichert'); }
      catch (e) { toast('Speichern nicht möglich: ' + e.message); }
    } else if (a === 'del') {
      if (await ask({ title: 'Gerät entkoppeln?', text: 'Das Gerät verschwindet aus deinem Konto und muss danach neu eingerichtet werden.', ok: 'Entkoppeln', danger: true })) {
        try { await Devices.remove(draft.id); location.hash = '#/devices'; } catch (e) { toast('Entkoppeln nicht möglich: ' + e.message); }
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
      <input id="file" type="file" accept="audio/mpeg,.mp3,image/jpeg,image/png,image/gif"></label>
      <p class="hint">MP3 bis ${CONFIG.MAX_AUDIO_BYTES / 1048576} MB. JPEG und PNG werden auf höchstens 320 Pixel Kantenlänge verkleinert und als JPEG gespeichert. GIFs bleiben animiert und werden unverändert gespeichert (bis ${CONFIG.MAX_GIF_BYTES / 1048576} MB und 480 Pixel Kantenlänge). MP4-Video folgt später.</p>
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
      if (await ask({ title: 'Datei löschen?', text: 'Ansagen und Anzeigen, die diese Datei nutzen, brauchen danach eine neue Datei.', ok: 'Löschen', danger: true })) { await Media.remove(m); pageMedia(); }
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
      } else if (f.type === 'image/gif') {
        // GIFs bleiben unverändert (sonst ginge die Animation verloren), müssen aber klein genug sein
        kind = 'image';
        if (f.size > CONFIG.MAX_GIF_BYTES) throw new Error(`Das GIF ist größer als ${CONFIG.MAX_GIF_BYTES / 1048576} MB. Verkleinere es zum Beispiel auf 320 Pixel Kantenlänge.`);
        const bmp = await createImageBitmap(f);
        if (Math.max(bmp.width, bmp.height) > 480) throw new Error(`Das GIF ist ${bmp.width}×${bmp.height} Pixel groß. Höchstens 480 Pixel Kantenlänge sind erlaubt.`);
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
    <div class="callout warn" style="margin-top:20px;max-width:640px"><p><strong>Welcher ESP32?</strong> Der Installer erkennt den Chip selbst und spielt die passende Firmware auf. Unterstützt sind der ESP32-S3 (empfohlen) und der normale ESP32, zum Beispiel WROOM-32.</p>
      <p>Ein normaler ESP32 hat weniger Pins und weniger Rechenleistung. Mit mehr als einer Anzeige kann die Darstellung ruckeln, besonders zusammen mit Ansagen. Mehr als zwei Anzeigen sind damit nicht möglich. Wähle danach am Gerät im Reiter Gerät das passende Board.</p></div>
    <div class="callout" style="margin-top:12px;max-width:640px"><p><strong>Nach dem Aufspielen:</strong> Das Gerät öffnet ein WLAN-Netz namens <strong>Pro4Rail-Setup-XXXX</strong>. Verbinde dich damit, wähle dein WLAN und gib den Kopplungscode aus der App ein (Geräte, Gerät hinzufügen). Mit gedrückter BOOT-Taste beim Einschalten (5 Sekunden) werden WLAN und Kopplung gelöscht.</p></div>`;
  if (!customElements.get('esp-web-install-button')) {
    try { await import('https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module'); }
    catch { toast('Die Installer-Bibliothek konnte nicht geladen werden.'); }
  }
}

// ---------- Start ----------
(async () => {
  $('#year').textContent = new Date().getFullYear();
  if (CONFIG.DATA_SOURCE === 'transitous') $('#src').innerHTML = 'Fahrplandaten: <a href="https://transitous.org/sources/" target="_blank" rel="noopener">Transitous</a> ·';
  $('#themebtn').onclick = toggleTheme;
  await initStore();
  Auth.onChange(route);
  window.addEventListener('hashchange', route);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
