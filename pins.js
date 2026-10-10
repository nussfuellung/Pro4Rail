// Pinbelegung für ESP32-S3 DevKitC-1 mit N16R8.
// Diese Tabelle und die Firmware (config.h) müssen übereinstimmen. Änderungen immer an beiden Stellen machen.

export const BOARD = {
  name: 'ESP32-S3 DevKitC-1 (N16R8)',
  warning: 'Nicht belegen: GPIO26 bis 37 (Flash und PSRAM), GPIO19 und 20 (USB), GPIO0, 3, 45 und 46 (Startpins).',
};

const TFT_BUS = { sck: 12, mosi: 11, dc: 9, rst: 8, bl: 4 };
const TFT_CS = { 1: 10, 2: 14, 3: 15 };
const SEG = { 1: [16, 17, 18], 2: [21, 38, 39], 3: [40, 41, 42] };
const I2C = { sda: 1, scl: 2 };
const HT16K33_ADDR = { 1: '0x70', 2: '0x71', 3: '0x72' };
const HT16K33_BRIDGE = { 1: 'keine Lötbrücke', 2: 'Brücke A0', 3: 'Brücke A1' };
export const AUDIO_PINS = { bclk: 5, lrc: 6, din: 13 };
export const LIGHT_PIN = 7;

const pwr = (v, mod, alt, note) => ({ gpio: v, mod, alt, note, pwr: true });
const io = (gpio, mod, alt, note) => ({ gpio: String(gpio), mod, alt, note });

function tftSet(d) {
  return {
    title: `Anzeige ${d.slot}: TFT ${d.tft.model}`,
    sub: 'Alle TFT-Anzeigen teilen sich Takt, Daten, DC, Reset und Beleuchtung. Nur CS ist pro Anzeige eigen.',
    rows: [
      pwr('3V3', 'VCC', '', ''),
      pwr('GND', 'GND', '', ''),
      io(TFT_BUS.sck, 'SCL', 'auch SCK oder CLK', 'gemeinsam'),
      io(TFT_BUS.mosi, 'SDA', 'auch MOSI oder DIN', 'gemeinsam'),
      io(TFT_BUS.dc, 'DC', 'auch A0 oder RS', 'gemeinsam'),
      io(TFT_BUS.rst, 'RES', 'auch RST oder RESET', 'gemeinsam'),
      io(TFT_CS[d.slot], 'CS', '', 'nur diese Anzeige'),
      io(TFT_BUS.bl, 'BLK', 'auch BL oder LED', 'gemeinsam'),
    ],
    notes: [],
  };
}

function segSet(d) {
  const [a, b, c] = SEG[d.slot];
  const kind = { '7seg': '7-Segment', '14seg': '14-Segment', '16seg': '16-Segment' }[d.seg.kind] || 'Segment';
  const title = `Anzeige ${d.slot}: ${kind} mit ${d.seg.driver}`;
  if (d.seg.driver === 'TM1637') {
    return { title, sub: 'Zwei Datenleitungen, keine gemeinsamen Pins mit anderen Anzeigen.',
      rows: [pwr('5V', 'VCC', 'viele Module laufen auch mit 3V3', ''), pwr('GND', 'GND', '', ''), io(a, 'CLK', '', ''), io(b, 'DIO', '', '')],
      notes: [] };
  }
  if (d.seg.driver === 'MAX7219') {
    return { title, sub: 'Drei Datenleitungen, keine gemeinsamen Pins mit anderen Anzeigen.',
      rows: [pwr('5V', 'VCC', '', ''), pwr('GND', 'GND', '', ''), io(a, 'DIN', '', ''), io(b, 'CLK', '', ''), io(c, 'CS', 'auch LOAD', '')],
      notes: ['Das Datenblatt verlangt bei 5 V Versorgung mindestens 3,5 V für ein High-Signal. Ein Pegelwandler von 3,3 V auf 5 V ist sicherer.'] };
  }
  return { title, sub: 'I²C-Bus, gemeinsam mit allen anderen HT16K33-Anzeigen. Jede Anzeige braucht eine eigene Adresse.',
    rows: [pwr('3V3', 'VCC', 'je nach Modul auch 5V', ''), pwr('GND', 'GND', '', ''), io(I2C.sda, 'SDA', '', 'gemeinsam'), io(I2C.scl, 'SCL', '', 'gemeinsam')],
    notes: [`Adresse ${HT16K33_ADDR[d.slot]} einstellen: ${HT16K33_BRIDGE[d.slot]} auf dem Modul.`] };
}

export function pinSets(config) {
  const sets = [];
  (config.displays || []).slice().sort((x, y) => x.slot - y.slot)
    .forEach(d => sets.push(d.type === 'seg' ? segSet(d) : tftSet(d)));
  sets.push({
    title: 'Lautsprecher: Verstärker MAX98357A',
    sub: 'Der Lautsprecher selbst kommt an die Klemmen des Verstärkers, nicht an den ESP32.',
    rows: [pwr('5V', 'VIN', '', ''), pwr('GND', 'GND', '', ''), io(AUDIO_PINS.bclk, 'BCLK', '', ''), io(AUDIO_PINS.lrc, 'LRC', 'auch WS', ''), io(AUDIO_PINS.din, 'DIN', '', '')],
    notes: ['SD und GAIN offen lassen.'],
  });
  sets.push({
    title: 'Beleuchtung',
    sub: 'Ein Ausgang für ein MOSFET-Modul oder einen WS2812-Streifen.',
    rows: [pwr('GND', 'GND', 'gemeinsame Masse mit der Lichtversorgung', ''), io(LIGHT_PIN, 'Signal', 'Gate des MOSFET oder DIN des Streifens', '')],
    notes: ['Das Licht bekommt eine eigene Spannungsversorgung. Nicht über den ESP32 speisen.'],
  });
  return sets;
}
