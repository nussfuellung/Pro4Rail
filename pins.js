// Pinbelegung je Board (ESP32-S3 und ESP32 WROOM).
// Diese Tabelle und die Firmware (config.h) müssen übereinstimmen. Änderungen immer an beiden Stellen machen.

import { OLED_MODELS } from './oled.js';

export const BOARDS = {
  esp32s3: {
    name: 'ESP32-S3 DevKitC-1 (N16R8)',
    warning: 'Nicht belegen: GPIO26 bis 37 (Flash und PSRAM), GPIO19 und 20 (USB), GPIO0, 3, 45 und 46 (Startpins).',
    maxDisplays: 3,
    tftBus: { sck: 12, mosi: 11 },
    // Freie Pins für CS, DC, RST und Beleuchtung. Jede TFT-Anzeige nimmt vier davon der Reihe nach (Anzeige 1 hat die bisherige Belegung).
    tftPool: [10, 9, 8, 4, 14, 18, 21, 38, 15, 39, 40, 41, 42, 47, 48],
    i2c: [{ sda: 1, scl: 2 }, { sda: 16, scl: 17 }],   // je OLED ein eigener Bus
    audio: { bclk: 5, lrc: 6, din: 13 },
    light: 7,
  },
  esp32: {
    name: 'ESP32 DevKit (WROOM-32)',
    warning: 'Nicht belegen: GPIO6 bis 11 (Flash), GPIO34 bis 39 (nur Eingang), GPIO0 und 12 (Startpins). Ein ESP32 hat weniger freie Pins und weniger Rechenleistung als ein ESP32-S3, deshalb sind höchstens zwei Anzeigen möglich.',
    maxDisplays: 2,
    tftBus: { sck: 18, mosi: 23 },
    tftPool: [5, 19, 4, 32, 27, 14, 16, 17, 21, 22, 15],   // GPIO21/22 und 16/17 entfallen, wenn dort eine OLED hängt
    i2c: [{ sda: 21, scl: 22 }, { sda: 16, scl: 17 }],   // je OLED ein eigener Bus. GPIO16 und 17 sind bei WROVER-Modulen mit PSRAM belegt
    audio: { bclk: 26, lrc: 25, din: 33 },
    light: 13,
  },
};
export const boardOf = config => BOARDS[config.board] || BOARDS.esp32s3;
const OLED_MAX = 2;   // Ohne Multiplexer: der Chip hat zwei I²C-Controller, jede OLED bekommt einen eigenen Bus mit Adresse 0x3C
export const MUX_MAX = 8;       // Der Multiplexer TCA9548A hat acht Kanäle
export const MUX_ADDR_DEFAULT = 0x70;

// Alle Anzeigen, die auf dem Gerät wirklich gebraucht werden, nach Platz sortiert.
const activeDisplays = config => (config.features?.displays === false ? [] : config.displays || []).slice().sort((x, y) => x.slot - y.slot);
export const muxOn = config => !!config.mux?.on && config.features?.displays !== false;
// Wie viele Plätze gibt es? Mit Multiplexer bis zu 8, sonst so viele, wie das Board schafft.
export const maxDisplays = config => muxOn(config) ? MUX_MAX : boardOf(config).maxDisplays;
// Anschlüsse, die für den I²C-Bus des Multiplexers zur Wahl stehen (alle ohne Einschränkung beim Start und nicht nur Eingang)
export const busPinChoices = config => { const B = boardOf(config); return [...new Set([...B.i2c.flatMap(b => [b.sda, b.scl]), ...B.tftPool])].sort((x, y) => x - y); };

// Belegung des Multiplexers: Adresse, Busleitungen und der Kanal jeder OLED. Ohne "selbst festlegen" ergibt sich alles von selbst.
export function muxPlan(config) {
  if (!muxOn(config)) return null;
  const B = boardOf(config); const m = config.mux || {}; const manual = !!m.manual;
  const okAddr = Number.isInteger(m.addr) && m.addr >= 0x70 && m.addr <= 0x77;
  const choices = busPinChoices(config); const okPin = v => Number.isInteger(v) && choices.includes(v);
  const sda = manual && okPin(m.sda) ? m.sda : B.i2c[0].sda, scl = manual && okPin(m.scl) ? m.scl : B.i2c[0].scl;
  const oleds = activeDisplays(config).filter(d => d.type === 'oled' && d.slot <= MUX_MAX);
  const channels = {}; oleds.forEach((d, i) => { const c = d.oled?.channel; channels[d.slot] = manual && Number.isInteger(c) && c >= 0 && c < MUX_MAX ? c : i; });
  return { manual, addr: manual && okAddr ? m.addr : MUX_ADDR_DEFAULT, sda, scl, channels, count: oleds.length };
}

// Hinweise, die zur Auswahl passen (Leistung, zu viele Anzeigen).
export function boardWarnings(config) {
  const b = boardOf(config); const ds = activeDisplays(config); const n = ds.length; const mux = muxPlan(config);
  const nOled = ds.filter(d => d.type === 'oled').length, nTft = n - nOled;
  const w = [];
  if (mux) {
    if (n > MUX_MAX) w.push(`Mit dem Multiplexer sind höchstens ${MUX_MAX} Anzeigen möglich. Entferne eine Anzeige.`);
    if (nTft > b.maxDisplays) w.push(`Dieses Board schafft höchstens ${b.maxDisplays} TFT-Anzeigen, weil jede eigene Pins braucht. Entferne ein TFT oder wähle ein ESP32-S3-Board.`);
    const seen = {}; for (const [slot, ch] of Object.entries(mux.channels)) { if (seen[ch] !== undefined) w.push(`Anzeige ${seen[ch]} und Anzeige ${slot} nutzen beide Kanal ${ch} des Multiplexers. Jede OLED braucht einen eigenen Kanal.`); else seen[ch] = slot; }
  } else {
    if (nOled > OLED_MAX) w.push('Ohne Multiplexer sind höchstens zwei OLED-Anzeigen pro Gerät möglich, weil der Chip nur zwei I²C-Controller hat. Aktiviere im Reiter Gerät den Multiplexer, um mehr anzuschließen.');
    if (n > b.maxDisplays) w.push(`Dieses Board schafft höchstens ${b.maxDisplays} Anzeigen. Entferne eine Anzeige oder wähle ein ESP32-S3-Board.`);
  }
  if (!(n > maxDisplays(config)) && config.board === 'esp32' && n >= 2) w.push('Mit zwei Anzeigen ist ein normaler ESP32 schnell am Limit. Bild und Abfahrtstafel können ruckeln, besonders zusammen mit Ansagen. Ein ESP32-S3 hat hier deutlich mehr Reserven.');
  if (config.board === 'esp32' && config.features?.audio !== false && n >= 1) w.push('Ansagen und Anzeigen gleichzeitig belasten einen normalen ESP32 stark. Spiele Ansagen am besten nur ab, während sich die Anzeigen kaum ändern.');
  w.push(...allocTft(config).errors, ...pinConflicts(config));
  return w;
}

const pwr = (v, mod, alt, note) => ({ gpio: v, mod, alt, note, pwr: true });
const ext = (gpio, mod, alt, note) => ({ gpio, mod, alt, note, pwr: true });
const io = (gpio, mod, alt, note) => ({ gpio: String(gpio), mod, alt, note });

// Verteilt die freien Pins auf die TFT-Anzeigen. Gleiche Regel wie allocPins in firmware/src/logic.h, ein Test vergleicht beide.
// Jede TFT-Anzeige bekommt eigene Pins für CS, DC, RST und Beleuchtung. Takt und Daten teilen sich alle.
export const TFT_PIN_NAMES = ['cs', 'dc', 'rst', 'bl'];
export function allocTft(config) {
  const B = boardOf(config); const mux = muxPlan(config);
  const ds = activeDisplays(config).filter(d => d.slot <= maxDisplays(config));
  const oleds = ds.filter(d => d.type === 'oled').length;
  const taken = new Set(mux ? (oleds ? [mux.sda, mux.scl] : []) : B.i2c.slice(0, Math.min(oleds, B.i2c.length)).flatMap(b => [b.sda, b.scl]));
  const pool = B.tftPool.filter(g => !taken.has(g)); const bySlot = {}; const errors = []; let i = 0;
  for (const d of ds.filter(x => x.type !== 'oled')) {
    if (i + TFT_PIN_NAMES.length > pool.length) {
      errors.push(`Anzeige ${d.slot}: Keine freien Pins mehr. Eine TFT-Anzeige braucht vier eigene Pins (CS, DC, RST, Beleuchtung), es sind nur noch ${Math.max(0, pool.length - i)} übrig. Entferne eine Anzeige oder eine OLED, oder nimm ein ESP32-S3-Board.`);
      bySlot[d.slot] = null; continue;
    }
    bySlot[d.slot] = Object.fromEntries(TFT_PIN_NAMES.map((n, k) => [n, pool[i + k]])); i += TFT_PIN_NAMES.length;
  }
  return { bySlot, errors };
}

function tftSet(d, B, alloc) {
  const a = alloc.bySlot[d.slot]; const none = 'kein Pin frei';
  return {
    title: `Anzeige ${d.slot}: TFT ${d.tft.model}`,
    sub: 'Takt und Daten teilen sich alle TFT-Anzeigen. CS, DC, Reset und Beleuchtung hat jede Anzeige für sich.',
    rows: [
      pwr('3V3', 'VCC', '', ''),
      pwr('GND', 'GND', '', ''),
      io(B.tftBus.sck, 'SCL', 'auch SCK oder CLK', 'gemeinsam'),
      io(B.tftBus.mosi, 'SDA', 'auch MOSI oder DIN', 'gemeinsam'),
      io(a ? a.dc : none, 'DC', 'auch A0 oder RS', 'nur diese Anzeige'),
      io(a ? a.rst : none, 'RES', 'auch RST oder RESET', 'nur diese Anzeige'),
      io(a ? a.cs : none, 'CS', '', 'nur diese Anzeige'),
      io(a ? a.bl : none, 'BLK', 'auch BL oder LED', 'nur diese Anzeige'),
    ],
    notes: [],
  };
}

function oledSet(d, B, idx, mux) {
  const m = OLED_MODELS[d.oled?.model] || OLED_MODELS.SSD1306_32;
  const title = `Anzeige ${d.slot}: OLED ${m.ctrl} (${m.w}×${m.h})`;
  if (mux) {
    const ch = mux.channels[d.slot];
    return { title, sub: `Diese OLED hängt am Multiplexer, Kanal ${ch}. Mit dem Multiplexer teilen sich alle OLEDs dieselben zwei Pins am ESP32.`,
      rows: [pwr('3V3', 'VCC', 'die meisten Module vertragen auch 5V', ''), pwr('GND', 'GND', '', ''), ext(`Multiplexer SD${ch}`, 'SDA', 'Anschluss am Multiplexer, nicht am ESP32', ''), ext(`Multiplexer SC${ch}`, 'SCL', 'auch SCK, Anschluss am Multiplexer', '')],
      notes: ['Die Adresse 0x3C (Werkseinstellung) bleibt, es muss nichts umgelötet werden.'] };
  }
  const bus = B.i2c[Math.min(idx, B.i2c.length - 1)];
  const note = idx < OLED_MAX ? 'Diese Anzeige hat einen eigenen I²C-Bus. Die Adresse 0x3C (Werkseinstellung) bleibt, es muss nichts umgelötet werden.'
    : 'Eine dritte OLED-Anzeige ist ohne Multiplexer nicht möglich, der Chip hat nur zwei I²C-Controller.';
  return { title, sub: 'Zwei Leitungen (I²C). Jede OLED hat ihre eigenen Anschlüsse, nur 3V3 und GND sind gemeinsam.',
    rows: [pwr('3V3', 'VCC', 'die meisten Module vertragen auch 5V', ''), pwr('GND', 'GND', '', ''), io(bus.sda, 'SDA', '', 'nur diese Anzeige'), io(bus.scl, 'SCL', 'auch SCK', 'nur diese Anzeige')],
    notes: [note] };
}

function muxSet(mux) {
  const a = '0x' + mux.addr.toString(16).toUpperCase();
  return { title: 'Multiplexer TCA9548A', sub: `Ein kleines Modul, das die zwei Leitungen des ESP32 auf bis zu acht OLEDs verteilt. Es braucht nur diese vier Drähte zum ESP32. Adresse ${a}.`,
    rows: [pwr('3V3', 'VIN', 'auch VCC', ''), pwr('GND', 'GND', '', ''), io(mux.sda, 'SDA', '', 'gemeinsam für alle OLEDs'), io(mux.scl, 'SCL', '', 'gemeinsam für alle OLEDs')],
    notes: [mux.addr === 0x70 ? 'Die Adresspins A0, A1 und A2 bleiben frei (oder an GND). Das ergibt die Adresse 0x70.' : `Für die Adresse ${a} müssen A0, A1 und A2 passend an 3V3 oder GND liegen (A0 = 1, A1 = 2, A2 = 4 zur Grundadresse 0x70 addiert).`, 'Der Reset-Pin (RST) bleibt frei. Die OLEDs hängen an den Kanälen SD0/SC0 bis SD7/SC7.'] };
}

export function pinConflicts(config) {
  const use = new Map(); const out = [];
  for (const s of pinSets(config)) for (const r of s.rows) {
    if (r.pwr || !/^\d+$/.test(String(r.gpio))) continue;
    const who = r.note === 'gemeinsam' ? `gemeinsam ${r.mod}` : `${s.title} (${r.mod})`;
    const prev = use.get(r.gpio); if (prev && prev !== who) out.push(`GPIO${r.gpio} ist doppelt belegt: ${prev} und ${who}. Bitte melde das, die Belegung ist fehlerhaft.`); else use.set(r.gpio, who);
  }
  return out;
}

export function pinSets(config) {
  const B = boardOf(config); const sets = []; let oledN = 0; const alloc = allocTft(config); const mux = muxPlan(config);
  // Abgewählte Funktionen (Gerät, Reiter "Gerät") brauchen keine Anschlüsse.
  const on = k => config.features?.[k] !== false;
  (on('displays') ? config.displays || [] : []).slice().sort((x, y) => x.slot - y.slot)
    .filter(d => d.slot <= maxDisplays(config))
    .forEach(d => { if (d.type === 'oled') { if (mux && oledN === 0) sets.push(muxSet(mux)); sets.push(oledSet(d, B, oledN++, mux)); } else sets.push(tftSet(d, B, alloc)); });
  if (on('audio')) sets.push({
    title: 'Lautsprecher: Verstärker MAX98357A',
    sub: 'Der Lautsprecher kommt an den Verstärker, nicht an den ESP32. Der Verstärker (ein kleines Modul) bekommt fünf Drähte vom ESP32.',
    rows: [pwr('5V', 'VIN', 'auch VCC', ''), pwr('GND', 'GND', '', ''), io(B.audio.bclk, 'BCLK', '', ''), io(B.audio.lrc, 'LRC', 'auch WS', ''), io(B.audio.din, 'DIN', '', ''),
      ext('Lautsprecher +', '+', 'Schraubklemme am Verstärker', ''), ext('Lautsprecher −', '−', 'Schraubklemme am Verstärker', '')],
    notes: ['SD und GAIN am Verstärker offen lassen, dort kommt kein Draht hin.', 'Verbinde jeden Draht mit dem Pin, dessen Name in der rechten Spalte steht. Die Farbe der Drähte ist egal.'],
  });
  if (on('light')) {
    const relay = config.light?.dimmable === false;
    sets.push(relay ? {
      title: 'Beleuchtung: Relaismodul',
      sub: 'Drei Drähte vom ESP32 zum Relais. Das Licht selbst hängt an den Kontakten des Relais, nicht am ESP32.',
      rows: [pwr('5V', 'VCC', 'bei den meisten Relaismodulen 5V', ''), pwr('GND', 'GND', '', ''), io(B.light, 'IN', 'auch S oder Signal', ''),
        ext('Strom für das Licht', 'COM', 'Schraubklemme am Relais, Plusleitung des Lichts hier hinein', ''), ext('zum Licht', 'NO', 'Schraubklemme am Relais, von hier zum Licht', '')],
      notes: ['Schaltet das Licht verkehrt herum, aktiviere im Reiter Gerät „Relais schaltet bei LOW“. Manche Module brauchen für den Eingang 5V. Dann ein Modul mit Optokoppler oder Pegelwandler nehmen.', 'Das Licht bekommt seine eigene Spannungsversorgung über die Relaiskontakte (COM und NO).'],
    } : {
      title: 'Beleuchtung: MOSFET-Modul',
      sub: 'Zwei Drähte vom ESP32 zum MOSFET-Modul, das das Licht stufenlos dimmt.',
      rows: [pwr('GND', 'GND', 'gemeinsame Masse mit der Lichtversorgung', ''), io(B.light, 'Signal', 'auch PWM, IN oder Gate', ''),
        ext('Strom für das Licht', 'V+ IN', 'Schraubklemme, Pluspol der Lichtversorgung', ''), ext('zum Licht', 'OUT+', 'Schraubklemme, Pluspol des Lichts', '')],
      notes: ['Das Licht bekommt eine eigene Spannungsversorgung. Nicht über den ESP32 speisen.'],
    });
  }
  return sets;
}
