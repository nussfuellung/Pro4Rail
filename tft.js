// Darstellung der TFT-Anzeige. Die Vorschau in der App und die Firmware zeichnen nach diesen Maßen und Farben.
// Aufbau nach dem Vorbild der Abfahrtsanzeiger in Bahnhöfen: dunkelblauer Grund, weiße Schrift, Spalten Zeit, Zug, Ziel, Gleis.
// Schrift und Zeichen der Bahn sind geschützt und nicht enthalten, die Schrift ist Barlow.

export const TFT_MODELS = {
  ST7789: { label: 'ST7789 (240×320)', w: 240, h: 320 },
  ILI9341: { label: 'ILI9341 (240×320)', w: 240, h: 320 },
  ST7735: { label: 'ST7735 (128×160)', w: 128, h: 160 },
};
export const TFT_COLORS = { bg: '#0b2a66', head: '#081f4d', text: '#ffffff', dim: '#b9c6e0', delay: '#ffd23f', cancel: '#ff5a4f', line: 'rgba(255,255,255,.25)' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = d => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// Pixelmaße der Anzeige. Querformat ist Standard, wie bei einer Bahnhofstafel.
export function screenSize(tft = {}) {
  const m = TFT_MODELS[tft.model] || TFT_MODELS.ST7789;
  return tft.landscape === false ? { w: m.w, h: m.h } : { w: m.h, h: m.w };
}
const wrap = (w, h, inner, bg = TFT_COLORS.bg) => ({ w, h, html: `<div class="tft" style="width:${w}px;height:${h}px;background:${bg};color:${TFT_COLORS.text}">${inner}</div>` });

export function clockScreen({ tft, now = new Date() }) {
  const { w, h } = screenSize(tft); const s = Math.max(.55, Math.min(w / 320, h / 240));
  const t = hhmm(now), d = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  return wrap(w, h, `<div class="tft-clock" style="font-size:${Math.round(78 * s)}px">${t}</div><div class="tft-date" style="font-size:${Math.round(18 * s)}px">${esc(d)}</div>`);
}

// Ein oder mehrere Bilder (JPEG, PNG, GIF). Bei mehreren wechseln sie alle `interval` Sekunden (activateSlides in marquee.js).
export function imageScreen({ tft, url, urls, interval = 10 }) {
  const { w, h } = screenSize(tft); const list = urls || [url];
  const imgs = list.map((u, i) => `<img src="${esc(u)}" alt="" class="${i === 0 ? 'on' : ''}">`).join('');
  return wrap(w, h, `<div class="slides" data-interval="${Number(interval) || 10}">${imgs}</div>`, '#000');
}

// deps: Abfahrten in der Form { line, dir, when, planned, delay (Minuten oder null), platform, cancelled }
export function departureScreen({ tft, rows = 2, stationName = '', deps = [], now = new Date() }) {
  const { w, h } = screenSize(tft);
  const s = Math.max(.55, w / 320);                    // Schriftmaß
  const hh = Math.round(30 * s + 2);                   // Kopfzeile
  const n = Math.min(Math.max(rows, 1), 4);
  const rowH = Math.min(Math.floor((h - hh) / n), Math.round(68 * s + 4));
  const cTime = Math.round(60 * s), cTrain = Math.round(64 * s), cPlat = Math.round(38 * s);
  const f = v => Math.max(9, Math.round(v * s));
  const head = `<div class="tft-head" style="height:${hh}px;background:${TFT_COLORS.head};font-size:${f(15)}px"><b>Abfahrt</b><span class="tft-st" style="font-size:${f(13)}px">${esc(stationName)}</span><b>${hhmm(now)}</b></div>`;
  const list = deps.slice(0, n);
  const body = list.length ? list.map(d => {
    const late = !d.cancelled && d.delay > 0;
    const sub = d.cancelled ? `<i style="color:${TFT_COLORS.cancel};font-size:${f(12)}px">Zug fällt aus</i>` : '';
    const ca = late ? `<i style="color:${TFT_COLORS.delay};font-size:${f(12)}px">ca. ${hhmm(d.when)}</i>` : '';
    return `<div class="tft-row" style="height:${rowH}px">
      <div class="c" style="width:${cTime}px"><b style="font-size:${f(21)}px;${d.cancelled ? 'text-decoration:line-through;opacity:.7' : ''}">${hhmm(d.planned || d.when)}</b>${ca}</div>
      <div class="c" style="width:${cTrain}px"><b style="font-size:${f(15)}px">${esc(d.line)}</b></div>
      <div class="c grow"><b class="dest mq" style="font-size:${f(19)}px"><span>${esc(d.dir)}</span></b>${sub}</div>
      <div class="c r" style="width:${cPlat}px"><b style="font-size:${f(21)}px">${esc(d.platform || '')}</b></div></div>`;
  }).join('') : `<div class="tft-none" style="font-size:${f(15)}px">Keine Abfahrten</div>`;
  return wrap(w, h, head + body);
}

// ---------- Zugzielanzeiger am Gleis ----------
// Nachempfunden den LED-Zugzielanzeigern der Bahn: leuchtend blau, cremeweiße Punktschrift, zwei Reihen aus je fünf Modulen.
// Obere Reihe: Gleis | Hinweis (Verspätung) und Zwischenhalte | Zeit und Zug. Untere Reihe: Ziel in großer Schrift.
// Schrift und Zeichen der Bahn sind geschützt und nicht enthalten, die Schrift ist DotGothic16.
export const ZZA = { frame: '#141a3a', bg: '#0e4fd0', seam: 'rgba(5,12,50,.55)', text: '#f7f4dc', strip: '#f1eecf', stripText: '#0c2f8f' };

// Gleis passt: "3" trifft 3, 3a und "3 A-D", aber nicht 13. Mehrere Gleise mit Komma: "3,4".
export function platformMatches(platform, wanted) {
  const p = String(platform ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return String(wanted ?? '').toLowerCase().split(/[,;]+/).map(x => x.trim()).filter(Boolean)
    .some(t => p === t || (p.startsWith(t) && !/\d/.test(p[t.length] || '')));
}

// Hinweistext wie auf der Anzeige: deutsch und englisch hintereinander
export function zzaNotice(dep) {
  if (!dep) return 'Zurzeit keine Abfahrt   No departure at the moment';
  if (dep.cancelled) return 'Zug fällt aus   Train cancelled';
  if (dep.delay > 0) return `ca. ${dep.delay} Min. später   approx. ${dep.delay} min. delay`;
  return '';
}

// Zwischenhalte auf zwei Zeilen verteilen (grob nach Zeichenzahl, was nicht passt, läuft als Laufschrift)
function viaLines(via = [], cap) {
  const lines = ['', '']; let i = 0;
  for (const v of via) {
    if (lines[i] && (lines[i] + '  ' + v).length > cap) { if (i === 1) break; i = 1; }
    lines[i] = lines[i] ? lines[i] + '  ' + v : v;
  }
  return lines.filter(Boolean);
}

// dep: nächste Abfahrt am Gleis (oder null). via: Namen der Zwischenhalte, wenn bekannt.
export function zugzielScreen({ tft, platform = '', dep = null, now = new Date() }) {
  const { w, h } = screenSize(tft);
  const bh = Math.min(h, Math.round(w / 2.05)), top = Math.round((h - bh) / 2);
  const p = Math.max(3, Math.round(w / 64)), rh = Math.floor((bh - 3 * p) / 2), rw = w - 2 * p;
  const fs = v => Math.max(8, Math.round(v * rh));
  const A = Math.round(rw * .2), B = Math.round(rw * .6), C = rw - A - B;
  const seams = [20, 40, 60, 80].map(x => `<i class="zs" style="left:${x}%"></i>`).join('');
  const msg = zzaNotice(dep);
  const stripH = Math.round(rh * .3), viaFs = fs(.22);
  const lines = viaLines(dep?.via, Math.floor(B / (viaFs * .55)));
  const gl = String(platform || '').trim();
  const t = dep ? hhmm(dep.planned || dep.when) : '';
  const abs = (l, t2, wd, hd, inner, cls = '') => `<div class="za ${cls}" style="left:${l}px;top:${t2}px;width:${wd}px;height:${hd}px">${inner}</div>`;
  const mq = (txt, size, cls = '') => `<div class="mq ${cls}" style="font-size:${size}px;line-height:${Math.round(size * 1.15)}px"><span>${esc(txt)}</span></div>`;
  const row1 = `<div class="zrow" style="left:${p}px;top:${p}px;width:${rw}px;height:${rh}px">${seams}
    ${abs(Math.round(rw * .03), 0, A - 2, rh, `<b class="zgl" style="font-size:${fs(gl.length > 2 ? .55 : .86)}px">${esc(gl)}</b>`, 'v')}
    ${msg ? abs(A, Math.round(rh * .04), B, stripH, mq(msg, fs(.2)), 'zstrip') : ''}
    ${lines.map((l, i) => abs(A + 4, Math.round(rh * .04) + stripH + Math.round(rh * .06) + i * Math.round(viaFs * 1.3), B - 8, Math.round(viaFs * 1.2), mq(l, viaFs))).join('')}
    ${abs(A + B, 0, C - Math.round(rw * .02), rh, `<b class="ztime" style="font-size:${fs(.34)}px;${dep?.cancelled ? 'text-decoration:line-through;opacity:.7' : ''}">${t}</b>${dep ? `<b class="ztrain" style="font-size:${fs(.2)}px">${esc(dep.line)}</b>` : ''}`, 'r v')}
  </div>`;
  const row2 = `<div class="zrow" style="left:${p}px;top:${2 * p + rh}px;width:${rw}px;height:${rh}px">${seams}
    ${dep ? abs(A + 4, 0, rw - A - 8, rh, mq(dep.dir, fs(.5)), 'v zdest') : ''}</div>`;
  return { w, h, html: `<div class="tft zza" style="width:${w}px;height:${h}px;background:${ZZA.frame}"><div class="zboard" style="top:${top}px;height:${bh}px">${row1}${row2}</div></div>` };
}
