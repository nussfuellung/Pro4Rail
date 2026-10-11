// Bildschirminhalte. Maße, Farben und Verhalten folgen Pro4Rail/tft.js und oled.js (dort stehen die Vorlagen).
#pragma once
#include "gfx.h"

namespace p4r {

// ---------- TFT ----------
Scene sceneDeparture(int w, int h, int rows, const std::string& station, const std::vector<const Dep*>& deps, bool loading, time_t now);
Scene sceneZugziel(int w, int h, const std::string& platform, const Dep* dep, bool loading, time_t now);
Scene sceneClock(int w, int h, time_t now);
Scene sceneMessage(int w, int h, const std::string& line1, const std::string& line2);

// ---------- OLED (Text, 5x7-Raster in 6x8-Feldern) ----------
struct OledLine { std::string left, right, full; int avail = 0; };
std::vector<OledLine> oledLines(int w, int h, bool header, const std::string& rightMode, const std::string& station, const std::vector<const Dep*>& deps, time_t now);
void oledDrawLines(Adafruit_GFX& g, int w, const std::vector<OledLine>& lines, uint32_t tMs);
void oledDrawClock(Adafruit_GFX& g, int w, int h, time_t now);
void oledDrawMessage(Adafruit_GFX& g, int w, const std::string& l1, const std::string& l2);
bool oledAnimated(const std::vector<OledLine>& lines);

}  // namespace p4r
