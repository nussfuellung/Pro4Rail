// Prüft die reine Logik der Firmware auf dem Computer. Erwartete Werte stammen aus den Tests der App (tests/*.test.mjs).
#include <cstdio>
#include <cstring>
#include "../src/logic.h"
using namespace p4r;
static int fails = 0, total = 0;
#define CHECK(c) do { total++; if (!(c)) { fails++; printf("FEHLER Zeile %d: %s\n", __LINE__, #c); } } while (0)
int main() {
  // Gleisfilter
  CHECK(platformMatches("3", "3")); CHECK(platformMatches("3a", "3")); CHECK(platformMatches("3 A-D", "3"));
  CHECK(!platformMatches("13", "3")); CHECK(!platformMatches("30", "3")); CHECK(!platformMatches("", "3"));
  CHECK(platformMatches("4", "3, 4")); CHECK(platformMatches("12", "3;12")); CHECK(!platformMatches("3", ""));
  CHECK(platformMatches(" 3  a ", "3")); CHECK(platformMatches("3A", "3a"));
  CHECK(platformMatches("Gleis 3", "3")); CHECK(platformMatches("3", "Gleis 3")); CHECK(platformMatches("Bahnsteig 4a", "4")); CHECK(!platformMatches("Gleis 13", "3"));
  // Linienfilter
  CHECK(lineMatches("RE 1", "")); CHECK(lineMatches("RE 1", "re")); CHECK(lineMatches("S 3", "RE, S")); CHECK(!lineMatches("ICE 27", "RE,S 1"));
  // Hinweise
  CHECK(zzaNotice(false, false, 0) == "Zurzeit keine Abfahrt   No departure at the moment");
  CHECK(zzaNotice(true, true, 0) == "Zug f\xC3\xA4llt aus   Train cancelled");
  CHECK(zzaNotice(true, false, 7) == "ca. 7 Min. sp\xC3\xA4ter   approx. 7 min. delay");
  CHECK(zzaNotice(true, false, 0).empty());
  // Zeit
  CHECK(parseIso("1970-01-01T00:00:00Z") == 0); CHECK(parseIso("2026-10-11T01:57:00Z") == 1791683820);
  CHECK(parseIso("2026-10-11T03:57:00+02:00") == parseIso("2026-10-11T01:57:00Z"));
  CHECK(parseIso("2026-10-11T01:57:00.250Z") == parseIso("2026-10-11T01:57:00Z"));
  CHECK(parseIso("2026-10-11T01:57:00-01:30") == parseIso("2026-10-11T03:27:00Z")); CHECK(parseIso("quatsch") == 0);
  CHECK(delayMinutes(parseIso("2026-10-11T02:04:00Z"), parseIso("2026-10-11T01:57:00Z")) == 7);
  CHECK(minutesUntil(1000, 1000) == 0); CHECK(minutesUntil(1000 + 150, 1000) == 3); CHECK(minutesUntil(1000, 5000) == 0);
  // Text
  CHECK(charLen("D\xC3\xBCsseldorf") == 10); CHECK(clipText("Frankfurt", 20) == "Frankfurt"); CHECK(clipText("Frankfurt(Main)Hbf", 8) == "Frankfu.");
  CHECK(clipText("K\xC3\xB6ln Hbf", 4) == "K\xC3\xB6l.");
  // Zeichensatz: A hat die Spalten 7e 11 11 11 7e, ä ist vorhanden, Unbekanntes wird zum Fragezeichen
  const uint8_t* a = glyph5x7('A'); CHECK(a[0] == 0x7e && a[1] == 0x11 && a[4] == 0x7e);
  CHECK(glyph5x7(0xE4) != glyph5x7('?')); CHECK(glyph5x7(0xDF) != glyph5x7('?')); CHECK(glyph5x7(0x20AC) != glyph5x7('?'));
  CHECK(glyph5x7(0x4E2D) == glyph5x7('?'));
  // Zwischenhalte
  auto v = viaLines({"Bad Zwischenahn", "Leer(Ostfriesl)", "Emden"}, 16); CHECK(v.size() == 2 && v[0] == "Bad Zwischenahn" && v[1] == "Leer(Ostfriesl)");
  CHECK(viaLines({}, 16).empty());
  // Laufschrift: erst stehen, dann laufen, dann von vorn
  CHECK(marqueeOffset(0, 100, 50) == 0); CHECK(marqueeOffset(1799, 100, 50) == 0); CHECK(marqueeOffset(1800 + 1000, 100, 50) == 50);
  CHECK(marqueeOffset(1800 + 2000, 100, 50) == 0); CHECK(marqueeOffset(5000, 0, 50) == 0);
  // Wochentage
  CHECK(dayInList({1, 2, 3, 4, 5}, 1)); CHECK(!dayInList({1, 2, 3, 4, 5}, 0)); CHECK(dayInList({6, 7}, 0));
  int h, m; CHECK(parseHHMM("07:30", h, m) && h == 7 && m == 30); CHECK(!parseHHMM("25:00", h, m)); CHECK(!parseHHMM("", h, m));
  // TFT-Pins (gleiche Fälle wie tests/oled.test.mjs)
  { std::vector<int> s3 = {10, 9, 8, 4, 14, 18, 21, 38, 15, 39, 40, 41, 42, 47, 48}, es = {5, 19, 4, 32, 27, 14, 16, 17, 21, 22, 15};
    auto a = allocPins(s3, {}, 3); CHECK(a[0].cs == 10 && a[0].dc == 9 && a[0].rst == 8 && a[0].bl == 4); CHECK(a[1].cs == 14 && a[1].dc == 18 && a[1].rst == 21 && a[1].bl == 38); CHECK(a[2].cs == 15 && a[2].dc == 39 && a[2].rst == 40 && a[2].bl == 41);
    auto b = allocPins(es, {}, 2); CHECK(b[0].cs == 5 && b[0].bl == 32); CHECK(b[1].cs == 27 && b[1].dc == 14 && b[1].rst == 16 && b[1].bl == 17);
    auto d = allocPins(es, {21, 22}, 1); CHECK(d[0].ok && d[0].cs == 5 && d[0].dc == 19 && d[0].rst == 4 && d[0].bl == 32);
    auto e = allocPins({5, 19, 4, 32, 27, 14}, {}, 2); CHECK(e[0].ok && !e[1].ok); }
  // Multiplexer (gleiche Fälle wie tests/oled.test.mjs)
  { auto a = muxChannels({-1, -1, -1}, false); CHECK(a == (std::vector<int>{0, 1, 2}));
    auto b = muxChannels({5, 5, -1, 9}, true); CHECK(b == (std::vector<int>{5, 5, 2, 3}));
    auto c = muxChannels({5, 4}, false); CHECK(c == (std::vector<int>{0, 1}));
    std::vector<int> ok = {16, 17, 21, 22}; CHECK(muxPin(16, true, ok, 21) == 16); CHECK(muxPin(6, true, ok, 21) == 21); CHECK(muxPin(16, false, ok, 21) == 21); }
  printf("%d von %d Prüfungen bestanden\n", total - fails, total);
  return fails ? 1 : 0;
}
