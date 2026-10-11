// Reine Logik ohne Arduino-Abhängigkeiten. Läuft auch auf dem Computer (siehe firmware/test/run.sh).
// Verhalten entspricht Pro4Rail/tft.js, oled.js, marquee.js und transport.js. Änderungen immer an beiden Stellen.
#pragma once
#include <stdint.h>
#include <time.h>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include "font5x7.h"

namespace p4r {

struct Dep {
  std::string line, dir, platform;
  time_t when = 0, planned = 0;
  int delay = 0;            // Minuten, nur gültig wenn hasDelay
  bool hasDelay = false, cancelled = false;
  std::vector<std::string> via;
};

// ---------- Text ----------
inline std::string lower(std::string s) { for (auto& c : s) c = (char)tolower((unsigned char)c); return s; }
inline std::string trim(const std::string& s) {
  size_t a = s.find_first_not_of(" \t\r\n"), b = s.find_last_not_of(" \t\r\n");
  return a == std::string::npos ? "" : s.substr(a, b - a + 1);
}
inline std::vector<std::string> splitList(const std::string& s, const char* seps) {
  std::vector<std::string> out; std::string cur;
  for (char c : s) { if (strchr(seps, c)) { if (!trim(cur).empty()) out.push_back(trim(cur)); cur.clear(); } else cur += c; }
  if (!trim(cur).empty()) out.push_back(trim(cur));
  return out;
}

// UTF-8 in Codepunkte zerlegen
inline std::vector<uint32_t> decodeUtf8(const std::string& s) {
  std::vector<uint32_t> out;
  for (size_t i = 0; i < s.size();) {
    unsigned char c = s[i]; uint32_t cp; int n;
    if (c < 0x80) { cp = c; n = 1; } else if ((c >> 5) == 6) { cp = c & 0x1F; n = 2; } else if ((c >> 4) == 14) { cp = c & 0x0F; n = 3; } else if ((c >> 3) == 30) { cp = c & 0x07; n = 4; } else { cp = '?'; n = 1; }
    for (int k = 1; k < n && i + k < s.size(); k++) cp = (cp << 6) | (s[i + k] & 0x3F);
    out.push_back(cp); i += n;
  }
  return out;
}
inline std::string encodeUtf8(const std::vector<uint32_t>& cps, size_t from = 0, size_t n = (size_t)-1) {
  std::string o;
  for (size_t i = from; i < cps.size() && i - from < n; i++) {
    uint32_t c = cps[i];
    if (c < 0x80) o += (char)c; else if (c < 0x800) { o += (char)(0xC0 | c >> 6); o += (char)(0x80 | (c & 0x3F)); }
    else if (c < 0x10000) { o += (char)(0xE0 | c >> 12); o += (char)(0x80 | ((c >> 6) & 0x3F)); o += (char)(0x80 | (c & 0x3F)); }
    else { o += (char)(0xF0 | c >> 18); o += (char)(0x80 | ((c >> 12) & 0x3F)); o += (char)(0x80 | ((c >> 6) & 0x3F)); o += (char)(0x80 | (c & 0x3F)); }
  }
  return o;
}
inline size_t charLen(const std::string& s) { return decodeUtf8(s).size(); }
// Kürzen wie clip() in oled.js: bei Überlänge n-1 Zeichen und ein Punkt
inline std::string clipText(const std::string& s, size_t n) {
  auto cps = decodeUtf8(s);
  if (cps.size() <= n) return s;
  return encodeUtf8(cps, 0, n > 0 ? n - 1 : 0) + ".";
}

// Spalten eines 5x7-Zeichens (Bit 0 = oberste Zeile). Unbekanntes Zeichen wird zum Fragezeichen.
inline const uint8_t* glyph5x7(uint32_t cp) {
  int q = -1;
  for (int i = 0; i < FONT5X7_COUNT; i++) { if (FONT5X7_CP[i] == cp) return FONT5X7_DATA + i * 5; if (FONT5X7_CP[i] == '?') q = i; }
  return FONT5X7_DATA + (q < 0 ? 0 : q) * 5;
}

// ---------- Filter ----------
// Linienfilter (applyFilter in app.js): Komma-Liste, Teiltreffer ohne Beachtung der Groß- und Kleinschreibung
inline bool lineMatches(const std::string& line, const std::string& filter) {
  auto f = splitList(filter, ",");
  if (f.empty()) return true;
  std::string l = lower(line);
  for (auto& x : f) if (l.find(lower(x)) != std::string::npos) return true;
  return false;
}
// Gleis passt: "3" trifft 3, 3a und "3 A-D", aber nicht 13. Mehrere Gleise mit Komma oder Semikolon.
inline std::string normPlatform(const std::string& in) {
  std::string p = lower(in); std::string out; std::vector<std::string> words; std::string w;
  for (char c : p + " ") { if (isspace((unsigned char)c)) { if (!w.empty()) { words.push_back(w); w.clear(); } } else w += c; }
  for (auto& x : words) { std::string y = x; if (!y.empty() && y.back() == '.') y.pop_back(); if (y == "gleis" || y == "bahnsteig" || y == "steig" || y == "platform" || y == "track") continue; if (!out.empty()) out += ' '; out += x; }
  return out;
}
// Gleis passt: "3" trifft 3, 3a und "3 A-D", aber nicht 13. Mehrere Gleise mit Komma oder Semikolon. "Gleis 3" zählt wie "3".
inline bool platformMatches(const std::string& platform, const std::string& wanted) {
  const std::string p = normPlatform(platform);
  for (auto& t0 : splitList(wanted, ",;")) {
    const std::string t = normPlatform(t0); if (t.empty()) continue;
    if (p == t) return true;
    if (p.compare(0, t.size(), t) == 0 && p.size() > t.size() && !isdigit((unsigned char)p[t.size()])) return true;
  }
  return false;
}
inline std::string zzaNotice(bool hasDep, bool cancelled, int delay) {
  if (!hasDep) return "Zurzeit keine Abfahrt   No departure at the moment";
  if (cancelled) return "Zug f\xC3\xA4llt aus   Train cancelled";
  if (delay > 0) return "ca. " + std::to_string(delay) + " Min. sp\xC3\xA4ter   approx. " + std::to_string(delay) + " min. delay";
  return "";
}
// Zwischenhalte auf höchstens zwei Zeilen verteilen (viaLines in tft.js)
inline std::vector<std::string> viaLines(const std::vector<std::string>& via, size_t cap) {
  std::string lines[2]; int i = 0;
  for (auto& v : via) {
    if (!lines[i].empty() && charLen(lines[i] + "  " + v) > cap) { if (i == 1) break; i = 1; }
    lines[i] = lines[i].empty() ? v : lines[i] + "  " + v;
  }
  std::vector<std::string> o; for (auto& l : lines) if (!l.empty()) o.push_back(l);
  return o;
}

// ---------- Zeit ----------
inline int64_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2; const int era = (y >= 0 ? y : y - 399) / 400; const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1; const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}
// ISO 8601 ("2026-10-11T01:57:00Z", "...+02:00", mit oder ohne Sekundenbruchteil) in Sekunden seit 1970. 0 bei Fehler.
inline time_t parseIso(const char* s) {
  int Y, M, D, h, m, sec = 0; if (!s || sscanf(s, "%4d-%2d-%2dT%2d:%2d", &Y, &M, &D, &h, &m) != 5) return 0;
  const char* p = s + 16; if (*p == ':') { sec = atoi(p + 1); p += 3; if (*p == '.') { p++; while (isdigit((unsigned char)*p)) p++; } }
  int off = 0;
  if (*p == '+' || *p == '-') { int oh = 0, om = 0; sscanf(p + 1, "%2d:%2d", &oh, &om); off = (oh * 60 + om) * (*p == '-' ? -1 : 1); }
  return (time_t)(daysFromCivil(Y, M, D) * 86400 + h * 3600 + m * 60 + sec - off * 60);
}
// Ganze Minuten bis zur Abfahrt, nie negativ (wie in oledLines: Math.round)
inline int minutesUntil(time_t when, time_t now) { double m = (double)(when - now) / 60.0; int r = (int)(m + (m >= 0 ? 0.5 : -0.5)); return r < 0 ? 0 : r; }
// Verspätung in Minuten aus geplanter und tatsächlicher Zeit (transport.js)
inline int delayMinutes(time_t when, time_t planned) { double m = (double)(when - planned) / 60.0; return (int)(m + (m >= 0 ? 0.5 : -0.5)); }

// ---------- Laufschrift ----------
// Erst stehen, dann gleichmäßig durchlaufen und von vorn (HOLD_MS und Tempo wie in marquee.js).
// dist: Strecke eines Durchlaufs in Pixeln, speed: Pixel pro Sekunde. Ergebnis: Verschiebung nach links.
inline int marqueeOffset(uint32_t tMs, int dist, int speed, int holdMs = 1800) {
  if (dist <= 0 || speed <= 0) return 0;
  uint32_t run = (uint32_t)((int64_t)dist * 1000 / speed), cycle = holdMs + run, ph = tMs % cycle;
  return ph < (uint32_t)holdMs ? 0 : (int)((int64_t)(ph - holdMs) * speed / 1000);
}

// ---------- Ansage-Regeln ----------
// days: 1 = Montag bis 7 = Sonntag. wday: tm_wday (0 = Sonntag).
inline bool dayInList(const std::vector<int>& days, int tmWday) { int d = tmWday == 0 ? 7 : tmWday; return std::find(days.begin(), days.end(), d) != days.end(); }
inline bool parseHHMM(const char* s, int& h, int& m) { return s && sscanf(s, "%d:%d", &h, &m) == 2 && h >= 0 && h < 24 && m >= 0 && m < 60; }

// ---------- Datum und Uhrzeit auf Deutsch (wie toLocaleTimeString/DateString('de-DE') in der App) ----------
inline std::string hhmm(const struct tm& t) { char b[8]; snprintf(b, sizeof b, "%02d:%02d", t.tm_hour, t.tm_min); return b; }
inline std::string dateLongDe(const struct tm& t) {
  static const char* WD[] = {"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"};
  static const char* MO[] = {"Januar", "Februar", "M\xC3\xA4rz", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"};
  return std::string(WD[t.tm_wday % 7]) + ", " + std::to_string(t.tm_mday) + ". " + MO[t.tm_mon % 12];
}
inline std::string dateShortDe(const struct tm& t) {     // "So 11.10." wie weekday:'short', day, month in der OLED-Uhr
  static const char* WD[] = {"So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"};
  char b[24]; snprintf(b, sizeof b, "%s %02d.%02d.", WD[t.tm_wday % 7], t.tm_mday, t.tm_mon + 1); return b;
}

}  // namespace p4r
