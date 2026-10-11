// Zeichnet die Bildschirme der Firmware auf dem Computer in Bilddateien (PPM). Dieselben Painter wie auf dem Gerät.
// Aufruf: render <Ausgabeordner>
#include <cstdio>
#include <cstdlib>
#include <string>
#include "../src/screens.h"
using namespace p4r;

struct Fb { int w, h; std::vector<uint16_t> px; };
static void blit(Cell& c, Fb& fb) {
  Rect r = c.window();
  for (int y = 0; y < r.h; y++) for (int x = 0; x < r.w; x++) { int X = r.x + x, Y = r.y + y; if (X >= 0 && Y >= 0 && X < fb.w && Y < fb.h) fb.px[Y * fb.w + X] = c.data()[y * r.w + x]; }
}
static void save(const Fb& fb, const std::string& path, int k) {
  FILE* f = fopen(path.c_str(), "wb"); fprintf(f, "P6\n%d %d\n255\n", fb.w * k, fb.h * k);
  for (int y = 0; y < fb.h * k; y++) for (int x = 0; x < fb.w * k; x++) {
    uint16_t p = fb.px[(y / k) * fb.w + x / k]; uint8_t rgb[3] = {(uint8_t)((p >> 8) & 0xF8), (uint8_t)((p >> 3) & 0xFC), (uint8_t)((p << 3) & 0xF8)}; fwrite(rgb, 1, 3, f);
  }
  fclose(f);
}
static void draw(Cell& c, const Scene& sc, Fb& fb, uint32_t t) {
  fb.w = sc.w; fb.h = sc.h; fb.px.assign(sc.w * sc.h, sc.bg);
  for (auto& it : sc.items) { paintItem(c, it, t); blit(c, fb); }
}
static Dep mk(const char* line, const char* dir, const char* pl, time_t planned, int delay, bool canc = false, std::vector<std::string> via = {}) {
  Dep d; d.line = line; d.dir = dir; d.platform = pl; d.planned = planned; d.when = planned + delay * 60; d.delay = delay; d.hasDelay = true; d.cancelled = canc; d.via = via; return d;
}
int main(int argc, char** argv) {
  std::string out = argc > 1 ? argv[1] : "."; setenv("TZ", "Europe/Berlin", 1); tzset();
  Cell cell; cell.alloc(320 * 96); cell.setScreen(320, 240);
  time_t now = parseIso("2026-10-11T01:50:00Z");   // 03:50 Ortszeit
  Dep a = mk("IC 2036", "Norddeich Mole", "3", parseIso("2026-10-11T01:50:00Z"), 7, false, {"Bad Zwischenahn", "Leer(Ostfriesl)", "Emden Hbf"});
  Dep b = mk("RE 1", "Hannover Hbf", "13", parseIso("2026-10-11T01:55:00Z"), 0);
  Dep c = mk("ICE 27", "Berlin Gesundbrunnen \xE2\x80\x93 Stralsund (Hansestadt)", "4 A-D", parseIso("2026-10-11T02:05:00Z"), 12);
  Dep d = mk("S 3", "D\xC3\xBCsseldorf Flughafen", "2", parseIso("2026-10-11T02:10:00Z"), 0, true);
  std::vector<const Dep*> all = {&a, &b, &c, &d};
  for (int mode = 0; mode < 2; mode++) {
    uint32_t t = mode ? 6000 : 0; std::string sfx = mode ? "-laeuft" : "";
    Fb fb; Scene sc;
    sc = sceneDeparture(320, 240, 4, "Frankfurt(Main)Hbf", all, false, now); draw(cell, sc, fb, t); save(fb, out + "/abfahrt" + sfx + ".ppm", 2);
    sc = sceneZugziel(320, 240, "3", &a, false, now); draw(cell, sc, fb, t); save(fb, out + "/zugziel" + sfx + ".ppm", 2);
    if (mode) continue;
    sc = sceneZugziel(320, 240, "3", &d, false, now); draw(cell, sc, fb, t); save(fb, out + "/zugziel-ausfall.ppm", 2);
    sc = sceneZugziel(320, 240, "9", nullptr, false, now); draw(cell, sc, fb, t); save(fb, out + "/zugziel-leer.ppm", 2);
    sc = sceneZugziel(160, 128, "3", &a, false, now); draw(cell, sc, fb, 0); save(fb, out + "/zugziel-klein.ppm", 4);
    sc = sceneClock(320, 240, now); draw(cell, sc, fb, 0); save(fb, out + "/uhr.ppm", 2);
    sc = sceneDeparture(160, 128, 2, "Frankfurt(Main)Hbf", all, false, now); draw(cell, sc, fb, 0); save(fb, out + "/abfahrt-klein.ppm", 4);
    sc = sceneDeparture(240, 320, 4, "Frankfurt(Main)Hbf", all, false, now); draw(cell, sc, fb, 0); save(fb, out + "/abfahrt-hoch.ppm", 2);
    sc = sceneMessage(320, 240, "Einrichtung", "WLAN Pro4Rail-Setup-A1B2"); draw(cell, sc, fb, 0); save(fb, out + "/nachricht.ppm", 2);
  }
  // OLED: Ausgabe als Raster
  for (int h : {32, 64}) for (int mode = 0; mode < 2; mode++) {
    struct Oled : Adafruit_GFX { std::vector<uint8_t> px; Oled(int w, int h) : Adafruit_GFX(w, h), px(w * h) {} void drawPixel(int16_t x, int16_t y, uint16_t c) override { if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) px[y * WIDTH + x] = c ? 1 : 0; } } g(128, h);
    if (mode == 0) oledDrawLines(g, 128, oledLines(128, h, true, "min", "Frankfurt(Main)Hbf", all, now), 0);
    else oledDrawClock(g, 128, h, now);
    Fb fb; fb.w = 128; fb.h = h; fb.px.resize(128 * h); for (int i = 0; i < 128 * h; i++) fb.px[i] = g.px[i] ? rgb(0x59, 0xb4, 0xff) : 0;
    save(fb, out + "/oled" + std::to_string(h) + (mode ? "-uhr" : "") + ".ppm", 5);
  }
  printf("fertig\n"); return 0;
}
