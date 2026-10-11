// Zeichenfläche und Textausgabe. Unabhängig von der Hardware, läuft auch auf dem Computer (siehe test/render.cpp).
#pragma once
#include <Adafruit_GFX.h>
#include <U8g2_for_Adafruit_GFX.h>
#include <functional>
#include <string>
#include <vector>
#include "logic.h"

namespace p4r {

constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) { return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)); }
struct Rect { int x = 0, y = 0, w = 0, h = 0; };

// Ein Fenster des Bildschirms im Arbeitsspeicher. Gezeichnet wird in Bildschirmkoordinaten, das Fenster schneidet ab.
// Danach schickt die Hardware-Schicht den Inhalt in einem Stück an die Anzeige (kein Flackern).
class Cell : public Adafruit_GFX {
 public:
  Cell() : Adafruit_GFX(1, 1) {}
  bool alloc(size_t pixels);
  void open(Rect r, uint16_t bg);           // Fenster öffnen und füllen; Zeichnen ist auf das Fenster begrenzt
  void clipTo(Rect r);                       // Zeichnen auf r (innerhalb des Fensters) begrenzen
  void drawPixel(int16_t x, int16_t y, uint16_t c) override;
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) override;
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) override;
  void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) override;
  void fillScreen(uint16_t c) override { fillRect(win.x, win.y, win.w, win.h, c); }
  const uint16_t* data() const { return buf; }
  Rect window() const { return win; }
  void setScreen(int w, int h) { WIDTH = _width = w; HEIGHT = _height = h; }
 private:
  uint16_t* buf = nullptr; size_t cap = 0; Rect win, clip;
};

// Schrift: entweder eine U8g2-Schrift (Umlaute inklusive) oder Punktmatrix aus dem 5x7-Zeichensatz (Zugzielanzeiger, OLED).
struct Style {
  bool dot = false; const uint8_t* font = nullptr; int c = 1;   // c: Kantenlänge eines Punktes in Pixeln
  uint16_t fg = 0xFFFF; int em = 0;                              // em: Schriftgröße für das Tempo der Laufschrift
};
Style styleSans(bool bold, int px, uint16_t fg);          // nächstkleinere vorhandene Größe
Style styleDot(int px, uint16_t fg);                       // Punktgröße so, dass 7 Punktzeilen höchstens px hoch sind
Style styleClock(int digitPx, uint16_t fg);
int textW(const Style& s, const std::string& t);
int lineH(const Style& s);
int drawText(Cell& c, const Style& s, int x, int top, const std::string& t);   // top: obere Kante der Zeile

// Laufschrift: erst stehen, dann gleichmäßig durchlaufen (wie marquee.js)
struct Marq {
  Rect r; std::string text; Style st; int top = 0, pad = 0, align = 0;   // align: 0 links, 1 mitte, 2 rechts (nur wenn es passt)
  uint16_t bg = 0; int speed = 0, gap = 0; bool transparent = false;   // transparent: Hintergrund zeichnet das Element selbst (zum Beispiel Trennfugen)
  bool overflows() const { return textW(st, text) > r.w - pad; }
};
void paintMarq(Cell& c, const Marq& m, uint32_t tMs);

struct Item { Rect r; uint16_t bg = 0; std::function<void(Cell&)> paint; std::vector<Marq> marqs; };
struct Scene { int w = 0, h = 0; uint16_t bg = 0; std::vector<Item> items; };
void paintItem(Cell& c, const Item& it, uint32_t tMs);   // Fenster öffnen, zeichnen, Laufschriften an die Stelle t setzen
void paintMarqFrame(Cell& c, const Item& it, const Marq& m, uint32_t tMs);   // nur das Laufschriftfeld neu zeichnen

}  // namespace p4r
