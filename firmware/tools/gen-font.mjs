// Erzeugt src/font5x7.h aus Pro4Rail/oled.js (CHARS und DATA). Einzige Quelle bleibt oled.js.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(new URL('../../Pro4Rail/oled.js', import.meta.url), 'utf8');
const chars = [...eval(/const CHARS = (.*);\n/.exec(src)[1])];
const data = eval(/const DATA = (.*);\n/.exec(src)[1]);
const bytes = data.match(/../g).map(x => parseInt(x, 16));
if (bytes.length !== chars.length * 5) throw new Error(`Font: ${bytes.length} Bytes für ${chars.length} Zeichen`);
let out = '// Automatisch erzeugt von tools/gen-font.mjs aus Pro4Rail/oled.js. Nicht von Hand ändern.\n#pragma once\n#include <stdint.h>\n';
out += `static const int FONT5X7_COUNT = ${chars.length};\n`;
out += 'static const uint32_t FONT5X7_CP[] = {' + chars.map(c => c.codePointAt(0)).join(',') + '};\n';
out += 'static const uint8_t FONT5X7_DATA[] = {' + bytes.join(',') + '};\n';
writeFileSync(new URL('../src/font5x7.h', import.meta.url), out);
console.log('font5x7.h:', chars.length, 'Zeichen');
