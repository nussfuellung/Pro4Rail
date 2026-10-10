// Rocrail-Protokoll: Rahmen für gesendete Nachrichten, Zerlegen empfangener Nachrichten, kleiner XML-Leser.
// Aufbau der Nachrichten nach dem Verhalten des Open-Source-Clients py-rocrail (nur als Beobachtung genutzt).

export const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Gesendet wird: <xmlh><xml size="LÄNGE" name="TYP"/></xmlh> direkt gefolgt vom XML.
// size zählt Bytes, nicht Zeichen (wichtig bei Umlauten in IDs).
export function frame(name, xml) {
  return `<xmlh><xml size="${Buffer.byteLength(xml, 'utf8')}" name="${name}"/></xmlh>${xml}`;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

// Liest XML (Elemente und Attribute, kein Text). Wirft nie bei kaputten Eingaben: Unlesbares wird übersprungen.
// Ergebnis: Liste der Wurzelelemente, jedes { tag, attrs, children }.
export function parseXml(text) {
  const roots = []; const stack = [];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/)?([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue; // Kommentar, Verarbeitungsanweisung, CDATA
    const [, closing, tag, attrSrc, selfClose] = m;
    if (closing) {
      const i = stack.map(e => e.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      continue;
    }
    const attrs = {};
    for (const a of attrSrc.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
    const el = { tag, attrs, children: [] };
    (stack.length ? stack[stack.length - 1].children : roots).push(el);
    if (!selfClose) stack.push(el);
  }
  return roots;
}

// Zerlegt den TCP-Strom in Nachrichten. Der Server beendet jede Nachricht mit einem NUL-Byte.
export class Deframer {
  constructor(maxBytes = 16 * 1024 * 1024) { this.buf = Buffer.alloc(0); this.max = maxBytes; }
  // Liefert eine Liste von Element-Listen (eine pro vollständiger Nachricht). Kopfelemente (xmlh) entfallen.
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out = [];
    let i;
    while ((i = this.buf.indexOf(0)) >= 0) {
      const text = this.buf.subarray(0, i).toString('utf8');
      this.buf = this.buf.subarray(i + 1);
      const els = parseXml(text).filter(e => e.tag !== 'xmlh');
      if (els.length) out.push(els);
    }
    if (this.buf.length > this.max) this.buf = Buffer.alloc(0); // Schutz vor endlosem Datenstrom ohne Ende
    return out;
  }
}
