// Pinbelegung je Board (ESP32-S3 und ESP32 WROOM).
// Diese Tabelle und die Firmware (config.h) müssen übereinstimmen. Änderungen immer an beiden Stellen machen.

import { OLED_MODELS } from './oled.js';

export const BOARDS = {
  esp32s3: {
    name: 'ESP32-S3 DevKitC-1 (N16R8)',
    warning: 'Nicht belegen: GPIO26 bis 37 (Flash und PSRAM), GPIO19 und 20 (USB), GPIO0, 3, 45 und 46 (Startpins).',
    maxDisplays: 3,
    tftBus: { sck: 12, mosi: 11, dc: 9, rst: 8, bl: 4 },
    tftCs: { 1: 10, 2: 14, 3: 15 },
    i2c: { sda: 1, scl: 2 },
    audio: { bclk: 5, lrc: 6, din: 13 },
    light: 7,
  },
  esp32: {
    name: 'ESP32 DevKit (WROOM-32)',
    warning: 'Nicht belegen: GPIO6 bis 11 (Flash), GPIO34 bis 39 (nur Eingang), GPIO0 und 12 (Startpins). Ein ESP32 hat weniger freie Pins und weniger Rechenleistung als ein ESP32-S3, deshalb sind höchstens zwei Anzeigen möglich.',
    maxDisplays: 2,
    tftBus: { sck: 18, mosi: 23, dc: 19, rst: 4, bl: 32 },
    tftCs: { 1: 5, 2: 27 },
    i2c: { sda: 21, scl: 22 },
    audio: { bclk: 26, lrc: 25, din: 33 },
    light: 13,
  },
};
export const boardOf = config => BOARDS[config.board] || BOARDS.esp32s3;
const OLED_ADDR = ['0x3C', '0x3D'];   // Mehr Adressen haben die üblichen OLED-Module nicht, also höchstens zwei am gleichen Bus

// Hinweise, die zur Auswahl passen (Leistung, zu viele Anzeigen).
export function boardWarnings(config) {
  const b = boardOf(config); const n = (config.features?.displays === false ? [] : config.displays || []).length;
  const w = [];
  if ((config.features?.displays === false ? [] : config.displays || []).filter(d => d.type === 'oled').length > OLED_ADDR.length) w.push('Am I²C-Bus sind höchstens zwei OLED-Anzeigen möglich, weil die Module nur die Adressen 0x3C und 0x3D kennen.');
  if (n > b.maxDisplays) w.push(`Dieses Board schafft höchstens ${b.maxDisplays} Anzeigen. Entferne eine Anzeige oder wähle ein ESP32-S3-Board.`);
  else if (config.board === 'esp32' && n >= 2) w.push('Mit zwei Anzeigen ist ein normaler ESP32 schnell am Limit. Bild und Abfahrtstafel können ruckeln, besonders zusammen mit Ansagen. Ein ESP32-S3 hat hier deutlich mehr Reserven.');
  if (config.board === 'esp32' && config.features?.audio !== false && n >= 1) w.push('Ansagen und Anzeigen gleichzeitig belasten einen normalen ESP32 stark. Spiele Ansagen am besten nur ab, während sich die Anzeigen kaum ändern.');
  return w;
}

const pwr = (v, mod, alt, note) => ({ gpio: v, mod, alt, note, pwr: true });
const io = (gpio, mod, alt, note) => ({ gpio: String(gpio), mod, alt, note });

function tftSet(d, B) {
  return {
    title: `Anzeige ${d.slot}: TFT ${d.tft.model}`,
    sub: 'Alle TFT-Anzeigen teilen sich Takt, Daten, DC, Reset und Beleuchtung. Nur CS ist pro Anzeige eigen.',
    rows: [
      pwr('3V3', 'VCC', '', ''),
      pwr('GND', 'GND', '', ''),
      io(B.tftBus.sck, 'SCL', 'auch SCK oder CLK', 'gemeinsam'),
      io(B.tftBus.mosi, 'SDA', 'auch MOSI oder DIN', 'gemeinsam'),
      io(B.tftBus.dc, 'DC', 'auch A0 oder RS', 'gemeinsam'),
      io(B.tftBus.rst, 'RES', 'auch RST oder RESET', 'gemeinsam'),
      io(B.tftCs[d.slot], 'CS', '', 'nur diese Anzeige'),
      io(B.tftBus.bl, 'BLK', 'auch BL oder LED', 'gemeinsam'),
    ],
    notes: [],
  };
}

function oledSet(d, B, idx) {
  const m = OLED_MODELS[d.oled?.model] || OLED_MODELS.SSD1306_32;
  const title = `Anzeige ${d.slot}: OLED ${m.ctrl} (${m.w}×${m.h})`;
  const note = idx === 0 ? `Adresse ${OLED_ADDR[0]}. Das ist die Werkseinstellung der meisten Module.`
    : idx === 1 ? `Adresse ${OLED_ADDR[1]}: Auf dem Modul die Adressbrücke umlöten (oft mit ADDR oder SA0 beschriftet), sonst stören sich die beiden Anzeigen.`
    : 'Eine dritte OLED-Anzeige ist am gleichen Bus nicht möglich, es gibt nur zwei Adressen.';
  return { title, sub: 'Zwei Leitungen (I²C), gemeinsam mit allen anderen I²C-Modulen. Jede Anzeige braucht eine eigene Adresse.',
    rows: [pwr('3V3', 'VCC', 'die meisten Module vertragen auch 5V', ''), pwr('GND', 'GND', '', ''), io(B.i2c.sda, 'SDA', '', 'gemeinsam'), io(B.i2c.scl, 'SCL', 'auch SCK', 'gemeinsam')],
    notes: [note] };
}

export function pinSets(config) {
  const B = boardOf(config); const sets = []; let oledN = 0;
  // Abgewählte Funktionen (Gerät, Reiter "Gerät") brauchen keine Anschlüsse.
  const on = k => config.features?.[k] !== false;
  (on('displays') ? config.displays || [] : []).slice().sort((x, y) => x.slot - y.slot)
    .filter(d => d.slot <= B.maxDisplays)
    .forEach(d => { if (d.type === 'oled') sets.push(oledSet(d, B, oledN++)); else sets.push(tftSet(d, B)); });
  if (on('audio')) sets.push({
    title: 'Lautsprecher: Verstärker MAX98357A',
    sub: 'Der Lautsprecher selbst kommt an die Klemmen des Verstärkers, nicht an den ESP32.',
    rows: [pwr('5V', 'VIN', '', ''), pwr('GND', 'GND', '', ''), io(B.audio.bclk, 'BCLK', '', ''), io(B.audio.lrc, 'LRC', 'auch WS', ''), io(B.audio.din, 'DIN', '', '')],
    notes: ['SD und GAIN offen lassen.'],
  });
  if (on('light')) sets.push({
    title: 'Beleuchtung',
    sub: config.light?.dimmable === false ? 'Ein Ausgang zum Schalten, zum Beispiel für ein Relais oder ein MOSFET-Modul.' : 'Ein Ausgang für ein MOSFET-Modul (dimmbar per PWM) oder einen WS2812-Streifen.',
    rows: [pwr('GND', 'GND', 'gemeinsame Masse mit der Lichtversorgung', ''), io(B.light, 'Signal', 'Gate des MOSFET oder DIN des Streifens', '')],
    notes: ['Das Licht bekommt eine eigene Spannungsversorgung. Nicht über den ESP32 speisen.'],
  });
  return sets;
}
