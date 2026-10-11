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

export function imageScreen({ tft, url }) {
  const { w, h } = screenSize(tft);
  return wrap(w, h, `<img src="${esc(url)}" alt="" style="width:100%;height:100%;object-fit:contain;display:block">`, '#000');
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
      <div class="c grow"><b class="dest" style="font-size:${f(19)}px">${esc(d.dir)}</b>${sub}</div>
      <div class="c r" style="width:${cPlat}px"><b style="font-size:${f(21)}px">${esc(d.platform || '')}</b></div></div>`;
  }).join('') : `<div class="tft-none" style="font-size:${f(15)}px">Keine Abfahrten</div>`;
  return wrap(w, h, head + body);
}
