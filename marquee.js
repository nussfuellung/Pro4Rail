// Laufschrift und Bildwechsel für die Anzeige-Vorschau. Verhalten wie bei LED-Anzeigen der Bahn:
// Passt ein Text nicht in sein Feld, bleibt er kurz stehen und läuft dann gleichmäßig von rechts nach links durch,
// danach folgt er nach einer Lücke von vorn (Endlosschleife). Passt er, bleibt er stehen.
const HOLD_MS = 1800;      // Pause, bevor der Text losläuft
const SPEED_EM = 2.6;      // Zeichenhöhen pro Sekunde

function run(node, dist, speed) {
  const move = dist / speed * 1000, total = move + HOLD_MS;
  node.animate([
    { transform: 'translateX(0)', offset: 0 },
    { transform: 'translateX(0)', offset: HOLD_MS / total },
    { transform: `translateX(${-dist}px)`, offset: 1 },
  ], { duration: total, iterations: Infinity, easing: 'linear' });
}

export function activateMarquee(root = document) {
  root.querySelectorAll('.mq:not([data-on])').forEach(el => {
    const span = el.firstElementChild; const cw = el.clientWidth;
    if (!span || !cw) return;                       // noch nicht sichtbar (zugeklappt): beim Aufklappen erneut versuchen
    el.dataset.on = '1';
    const sw = span.scrollWidth; if (sw <= cw + 1) return;
    const fs = parseFloat(getComputedStyle(el).fontSize) || 14, gap = Math.round(fs * 3);
    const txt = span.outerHTML;
    el.innerHTML = `<span class="mq-track">${txt}<span class="mq-gap" style="width:${gap}px"></span>${txt}</span>`;
    run(el.firstElementChild, sw + gap, fs * SPEED_EM);
  });
  // SVG-Zeilen (OLED): Weg und Tempo stehen schon im Attribut
  root.querySelectorAll('[data-mq]:not([data-on])').forEach(g => {
    g.dataset.on = '1';
    try { const o = JSON.parse(g.dataset.mq); run(g, o.dist, o.speed); } catch { /* egal */ }
  });
}

// Mehrere Bilder oder GIFs nacheinander einblenden
export function activateSlides(root = document) {
  root.querySelectorAll('.slides:not([data-on])').forEach(el => {
    const imgs = [...el.querySelectorAll('img')]; if (imgs.length < 2) return;
    el.dataset.on = '1';
    const ms = Math.max(2, Number(el.dataset.interval) || 10) * 1000; let i = 0;
    const t = setInterval(() => {
      if (!el.isConnected) { clearInterval(t); return; }
      imgs[i].classList.remove('on'); i = (i + 1) % imgs.length; imgs[i].classList.add('on');
    }, ms);
  });
}
