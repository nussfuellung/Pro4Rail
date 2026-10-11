// Text-OLED-Anzeigen (SSD1306 / SH1106, I²C) wie die kleinen 0,91-Zoll-Module mit 128×32 Pixeln.
// Die Firmware zeichnet mit demselben 5×7-Raster: Zeichenfeld 6×8 Pixel, 21 Zeichen pro Zeile, 8 Pixel pro Zeile.
// Schriftdaten ASCII: aus dem Paket "oled-font-5x7" (MIT-Lizenz, (c) Suz Hinton und Mitwirkende). ß und ~ sind ergänzt.

export const OLED_MODELS = {
  SSD1306_32: { label: 'SSD1306 0,91 Zoll (128×32)', ctrl: 'SSD1306', w: 128, h: 32 },
  SSD1306_64: { label: 'SSD1306 0,96 Zoll (128×64)', ctrl: 'SSD1306', w: 128, h: 64 },
  SH1106_64: { label: 'SH1106 1,3 Zoll (128×64)', ctrl: 'SH1106', w: 128, h: 64 },
};
export const OLED_COLORS = {
  blau: { label: 'Blau', on: '#59b4ff', glow: 'rgba(60,150,255,.55)' },
  weiss: { label: 'Weiß', on: '#eef3ff', glow: 'rgba(200,215,255,.45)' },
  gelb: { label: 'Gelb', on: '#ffd23f', glow: 'rgba(255,190,40,.5)' },
};
export const OLED_DEFAULT = { model: 'SSD1306_32', color: 'blau', right: 'min', header: true };

const CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ[\\]^_`abcdefghijklmnopqrstuvwxyzäöü{|}€°ß~';
const DATA = '000000000000005f00000007000700147f147f14242a7f2a12231308646236495522500005030000001c2241000041221c00082a1c2a0808083e080800503000000808080808006060000020100804023e5149453e00427f400042615149462141454b311814127f1027454545393c4a49493001710905033649494936064949291e003636000000563600000008142241141414141441221408000201510906324979413e7e1111117e7f494949363e414141227f4141221c7f494949417f090901013e414151327f0808087f00417f41002040413f017f081422417f404040407f0204027f7f0408107f3e4141413e7f090909063e4151215e7f09192946464949493101017f01013f4040403f1f2040201f7f2018207f6314081463030478040361514945437d12127d003d4242423d3d4040403d00007f4141020408102041417f000004020102044040404040000102040020545454787f484444383844444420384444487f3854545418087e090102081454543c7f0804047800447d40002040443d00007f10284400417f40007c041804787c0804047838444444387c14141408081414187c7c080404084854545420043f4440203c4040207c1c2040201c3c4030403c44281028440c5050503c4464544c4420555455783a44443a003a40403a00000836410000007f00000041360800143e55412200000705077e494949360804081008';
const BYTES = Uint8Array.from(DATA.match(/../g), x => parseInt(x, 16));
// Spalten eines Zeichens (5 Bytes, Bit 0 = oberste Pixelzeile). Unbekannte Zeichen erscheinen als Fragezeichen.
function glyph(ch) {
  let i = CHARS.indexOf(ch);
  if (i < 0) i = CHARS.indexOf('?');
  return BYTES.subarray(i * 5, i * 5 + 5);
}

export function oledSize(oled = {}) {
  const m = OLED_MODELS[oled.model] || OLED_MODELS.SSD1306_32;
  return { ...m, cols: Math.floor(m.w / 6), lines: Math.floor(m.h / 8) };
}

const hhmm = d => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
// Ein Zeilenfeld: passt der Text nicht, steht in left die gekürzte Fassung (so zeigt es ein Display ohne Laufschrift),
// in full der ganze Text, der als Laufschrift durchläuft.
const field = (text, avail, right) => (text.length <= avail ? { left: text, right } : { left: clip(text, avail), right, full: text, avail });
const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '.' : s);
// Pixel in Textzeilen umwandeln. Jede Zeile hat links einen Text und rechts einen kurzen Wert.
// deps: Abfahrten in der Form { line, dir, when, planned, delay, platform, cancelled }
export function oledLines({ oled, stationName = '', deps = [], now = new Date() }) {
  const m = oledSize(oled); const out = [];
  if (oled?.header !== false) out.push(field(stationName, m.cols - 6, hhmm(now)));
  const n = m.lines - out.length;
  for (const d of deps.slice(0, n)) {
    const mins = Math.max(0, Math.round((new Date(d.when) - now) / 60000));
    let right;
    if (d.cancelled) right = 'Ausfall';
    else if (oled?.right === 'zeit') right = hhmm(d.planned || d.when) + (d.delay > 0 ? '+' + d.delay : '');
    else right = mins === 0 ? 'jetzt' : mins + ' min';
    out.push(field(`${d.line} ${d.dir}`, m.cols - right.length - 1, right));
  }
  return out;
}

// Pixelraster (true = leuchtet) für Textzeilen. scale vergrößert die Schrift ganzzahlig (für die Uhr).
export function oledPixels(m, lines, { scale = 1, x0 = 0, y0 = 0 } = {}) {
  const on = Array.from({ length: m.h }, () => new Uint8Array(m.w));
  const put = (str, x, y) => {
    for (const ch of str) {
      const g = glyph(ch);
      for (let c = 0; c < 5; c++) for (let r = 0; r < 7; r++) if (g[c] >> r & 1)
        for (let dx = 0; dx < scale; dx++) for (let dy = 0; dy < scale; dy++) {
          const px = x + c * scale + dx, py = y + r * scale + dy;
          if (px >= 0 && px < m.w && py >= 0 && py < m.h) on[py][px] = 1;
        }
      x += 6 * scale;
    }
  };
  lines.forEach((l, i) => {
    const y = y0 + i * 8 * scale;
    put(l.left, x0, y);
    if (l.right) put(l.right, m.w - l.right.length * 6 * scale, y);
  });
  return on;
}

const K = 4;   // Bildpunkte je OLED-Pixel in der Vorschau
function pathOf(on, k = K) {
  let d = '';
  for (let y = 0; y < on.length; y++) for (let x = 0; x < on[y].length; x++) if (on[y][x]) d += `M${x * k + .5} ${y * k + .5}h${k - 1}v${k - 1}h${1 - k}z`;
  return d;
}
// Laufschrift-Zeilen: ganzer Text mit Lücke und Wiederholung, im Feld abgeschnitten, per Animation verschoben (marquee.js).
function scrollers(m, lines, k = K) {
  return lines.map((l, i) => {
    if (!l.full) return '';
    const gap = 3, unit = (l.full.length + gap) * 6;
    const grid = oledPixels({ w: unit * 2, h: 8 }, [{ left: l.full + ' '.repeat(gap) + l.full, right: '' }]);
    const fw = l.avail * 6 * k;
    return `<svg x="0" y="${i * 8 * k}" width="${fw}" height="${8 * k}" viewBox="0 0 ${fw} ${8 * k}"><g data-mq='${JSON.stringify({ dist: unit * k, speed: 25 * k })}'><path d="${pathOf(grid, k)}" fill="currentColor"/></g></svg>`;
  }).join('');
}

// Zeichnet das Raster als Bild aus einzelnen Leuchtpunkten, wie ein echtes OLED-Modul unter dem Rahmen.
function render(m, on, color, extra = '') {
  const c = OLED_COLORS[color] || OLED_COLORS.blau, k = 4, pad = 16;      // k: Bildpunkte je OLED-Pixel
  const d = pathOf(on, k);
  const w = m.w * k + pad * 2, h = m.h * k + pad * 2;
  return { w, h, px: `${m.w}×${m.h}`, html: `<div class="oled" style="width:${w}px;height:${h}px"><svg width="${m.w * k}" height="${m.h * k}" viewBox="0 0 ${m.w * k} ${m.h * k}" shape-rendering="crispEdges" role="img" aria-label="OLED-Anzeige" style="filter:drop-shadow(0 0 3px ${c.glow})"><path d="${d}" fill="${c.on}"/>${extra}</svg></div>` };
}

export function oledDepartureScreen({ oled, stationName, deps, now = new Date() }) {
  const m = oledSize(oled), lines = oledLines({ oled, stationName, deps, now });
  const c = OLED_COLORS[oled?.color] || OLED_COLORS.blau;
  // Zeilen mit Laufschrift: der feste Teil (rechter Wert) ins Raster, der Text als bewegte Ebene
  const on = oledPixels(m, lines.map(l => ({ left: l.full ? '' : l.left, right: l.right })));
  return render(m, on, oled?.color, `<g style="color:${c.on}">${scrollers(m, lines)}</g>`);
}
export function oledClockScreen({ oled, now = new Date() }) {
  const m = oledSize(oled), t = hhmm(now);
  const s = Math.max(1, Math.min(Math.floor(m.w / (t.length * 6)), Math.floor((m.h >= 64 ? m.h - 12 : m.h) / 8)));
  const tw = t.length * 6 * s - s, th = 7 * s;
  const lines = [{ left: t, right: '' }];
  const x0 = Math.round((m.w - tw) / 2), y0 = m.h >= 64 ? Math.round((m.h - 12 - th) / 2) : Math.round((m.h - th) / 2);
  const on = oledPixels(m, lines, { scale: s, x0, y0 });
  if (m.h >= 64) {
    const dt = now.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace(',', '');
    const p = oledPixels(m, [{ left: dt, right: '' }], { x0: Math.round((m.w - dt.length * 6) / 2), y0: m.h - 10 });
    p.forEach((row, y) => row.forEach((v, x) => { if (v) on[y][x] = 1; }));
  }
  return render(m, on, oled?.color);
}
