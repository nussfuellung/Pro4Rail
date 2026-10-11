#include <stdlib.h>
#include <string.h>
#ifdef ARDUINO_ARCH_ESP32
#include <esp_heap_caps.h>
#endif
#include "gfx.h"

namespace p4r {

bool Cell::alloc(size_t pixels) {
#ifdef ARDUINO_ARCH_ESP32
  buf = (uint16_t*)heap_caps_malloc(pixels * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);   // PSRAM, falls vorhanden
  if (!buf) buf = (uint16_t*)heap_caps_malloc(pixels * 2, MALLOC_CAP_8BIT);
#else
  buf = (uint16_t*)malloc(pixels * 2);
#endif
  cap = buf ? pixels : 0; return buf != nullptr;
}
void Cell::open(Rect r, uint16_t bg) {
  if ((size_t)r.w * r.h > cap) { r.h = r.w ? (int)(cap / r.w) : 0; }
  win = clip = r;
  for (int i = 0, n = r.w * r.h; i < n; i++) buf[i] = bg;
}
void Cell::clipTo(Rect r) {   // immer relativ zum Fenster, nicht zum vorherigen Ausschnitt
  int x0 = std::max(win.x, r.x), y0 = std::max(win.y, r.y), x1 = std::min(win.x + win.w, r.x + r.w), y1 = std::min(win.y + win.h, r.y + r.h);
  clip = {x0, y0, std::max(0, x1 - x0), std::max(0, y1 - y0)};
}
void Cell::drawPixel(int16_t x, int16_t y, uint16_t c) {
  if (x < clip.x || y < clip.y || x >= clip.x + clip.w || y >= clip.y + clip.h) return;
  buf[(y - win.y) * win.w + (x - win.x)] = c;
}
void Cell::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) {
  int x0 = std::max<int>(x, clip.x), y0 = std::max<int>(y, clip.y), x1 = std::min<int>(x + w, clip.x + clip.w), y1 = std::min<int>(y + h, clip.y + clip.h);
  for (int yy = y0; yy < y1; yy++) { uint16_t* p = buf + (yy - win.y) * win.w + (x0 - win.x); for (int xx = x0; xx < x1; xx++) *p++ = c; }
}
void Cell::drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) { fillRect(x, y, w, 1, c); }
void Cell::drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) { fillRect(x, y, 1, h, c); }

// ---------- Schrift ----------
static U8G2_FOR_ADAFRUIT_GFX u8;
struct FontEnt { int px; const uint8_t* f; };
static const FontEnt BOLD[] = {{8, u8g2_font_helvB08_tf}, {10, u8g2_font_helvB10_tf}, {12, u8g2_font_helvB12_tf}, {14, u8g2_font_helvB14_tf}, {18, u8g2_font_helvB18_tf}, {24, u8g2_font_helvB24_tf}};
static const FontEnt REG[] = {{8, u8g2_font_helvR08_tf}, {10, u8g2_font_helvR10_tf}, {12, u8g2_font_helvR12_tf}, {14, u8g2_font_helvR14_tf}, {18, u8g2_font_helvR18_tf}, {24, u8g2_font_helvR24_tf}};
static const FontEnt CLOCK[] = {{16, u8g2_font_logisoso16_tn}, {18, u8g2_font_logisoso18_tn}, {20, u8g2_font_logisoso20_tn}, {22, u8g2_font_logisoso22_tn}, {24, u8g2_font_logisoso24_tn}, {26, u8g2_font_logisoso26_tn}, {28, u8g2_font_logisoso28_tn}, {30, u8g2_font_logisoso30_tn}, {32, u8g2_font_logisoso32_tn}, {34, u8g2_font_logisoso34_tn}, {38, u8g2_font_logisoso38_tn}, {42, u8g2_font_logisoso42_tn}, {46, u8g2_font_logisoso46_tn}, {50, u8g2_font_logisoso50_tn}, {54, u8g2_font_logisoso54_tn}, {58, u8g2_font_logisoso58_tn}, {62, u8g2_font_logisoso62_tn}, {78, u8g2_font_logisoso78_tn}};
template <size_t N> static const uint8_t* pick(const FontEnt (&t)[N], int px, int* got = nullptr) {
  const FontEnt* best = &t[0]; for (auto& f : t) if (f.px <= px) best = &f;
  if (got) *got = best->px; return best->f;
}
Style styleSans(bool bold, int px, uint16_t fg) { Style s; int g; s.font = bold ? pick(BOLD, px, &g) : pick(REG, px, &g); s.fg = fg; s.em = g; return s; }
Style styleClock(int digitPx, uint16_t fg) { Style s; int g; s.font = pick(CLOCK, digitPx, &g); s.fg = fg; s.em = g; return s; }
Style styleDot(int px, uint16_t fg) { Style s; s.dot = true; s.c = std::max(1, px / 7); s.fg = fg; s.em = 7 * s.c; return s; }

static void bind(Cell& c, const Style& s) { u8.begin(c); u8.setFont(s.font); u8.setFontMode(1); u8.setForegroundColor(s.fg); }
int textW(const Style& s, const std::string& t) {
  if (s.dot) { size_t n = charLen(t); return n ? (int)(n * 6 * s.c - s.c) : 0; }
  static Cell probe; bind(probe, s); return u8.getUTF8Width(t.c_str());
}
int lineH(const Style& s) { if (s.dot) return 7 * s.c; static Cell probe; bind(probe, s); return u8.getFontAscent() - u8.getFontDescent(); }

static void dotGlyphs(Cell& c, const Style& s, int x, int y, const std::string& t) {
  int k = s.c, gap = k >= 6 ? 2 : k >= 3 ? 1 : 0;
  for (uint32_t cp : decodeUtf8(t)) {
    const uint8_t* g = glyph5x7(cp);
    for (int col = 0; col < 5; col++) for (int row = 0; row < 7; row++) if (g[col] >> row & 1) c.fillRect(x + col * k, y + row * k, k - gap, k - gap, s.fg);
    x += 6 * k;
  }
}
int drawText(Cell& c, const Style& s, int x, int top, const std::string& t) {
  if (s.dot) { dotGlyphs(c, s, x, top, t); return textW(s, t); }
  bind(c, s); u8.drawUTF8(x, top + u8.getFontAscent(), t.c_str()); return u8.getUTF8Width(t.c_str());
}

// ---------- Laufschrift ----------
void paintMarq(Cell& c, const Marq& m, uint32_t t) {
  c.clipTo(m.r); if (!m.transparent) c.fillRect(m.r.x, m.r.y, m.r.w, m.r.h, m.bg);
  int tw = textW(m.st, m.text), avail = m.r.w - m.pad, x0 = m.r.x + m.pad;
  if (tw <= avail) { int x = m.align == 1 ? x0 + (avail - tw) / 2 : m.align == 2 ? x0 + avail - tw : x0; drawText(c, m.st, x, m.top, m.text); return; }
  int dist = tw + m.gap, off = marqueeOffset(t, dist, m.speed);
  drawText(c, m.st, x0 - off, m.top, m.text); drawText(c, m.st, x0 - off + dist, m.top, m.text);
}
void paintMarqFrame(Cell& c, const Item& it, const Marq& m, uint32_t t) {
  c.open(m.r, it.bg);
  if (it.paint) it.paint(c);           // Untergrund (zum Beispiel Trennfugen) neu zeichnen, dann die Schrift darüber
  paintMarq(c, m, t);
}
void paintItem(Cell& c, const Item& it, uint32_t t) {
  c.open(it.r, it.bg);
  if (it.paint) it.paint(c);
  for (auto& m : it.marqs) paintMarq(c, m, t);
}

}  // namespace p4r
