#include <math.h>
#include "screens.h"

namespace p4r {

static struct tm localTm(time_t t) { struct tm r; localtime_r(&t, &r); return r; }
static int rnd(double v) { return (int)lround(v); }

// ---------- Farben (TFT_COLORS und ZZA in tft.js) ----------
static const uint16_t C_BG = rgb(0x0b, 0x2a, 0x66), C_HEAD = rgb(0x08, 0x1f, 0x4d), C_TEXT = rgb(255, 255, 255), C_DIM = rgb(0xb9, 0xc6, 0xe0),
                      C_DELAY = rgb(0xff, 0xd2, 0x3f), C_CANCEL = rgb(0xff, 0x5a, 0x4f), C_LINE = rgb(72, 95, 140);
static const uint16_t Z_FRAME = rgb(0x14, 0x1a, 0x3a), Z_BG = rgb(0x0e, 0x4f, 0xd0), Z_SEAM = rgb(9, 42, 121), Z_TEXT = rgb(0xf7, 0xf4, 0xdc),
                      Z_STRIP = rgb(0xf1, 0xee, 0xcf), Z_STRIP_TEXT = rgb(0x0c, 0x2f, 0x8f), Z_DIM = rgb(177, 195, 216);

// ---------- Abfahrtstafel (departureScreen) ----------
Scene sceneDeparture(int w, int h, int rows, const std::string& station, const std::vector<const Dep*>& deps, bool loading, time_t now) {
  Scene sc; sc.w = w; sc.h = h; sc.bg = C_BG;
  const double s = std::max(.55, w / 320.0);
  const int hh = rnd(30 * s + 2), n = std::min(std::max(rows, 1), 4), rowH = std::min((h - hh) / n, rnd(68 * s + 4));
  auto f = [&](double v) { return std::max(9, rnd(v * s)); };
  // Spaltenbreiten: Vorgabe wie in der Vorschau, aber nie schmaler als der breiteste Text in der echten Schrift
  Style mt = styleSans(true, f(21), C_TEXT), mca = styleSans(false, f(12), C_DELAY), mtr = styleSans(true, f(15), C_TEXT), mpl = styleSans(true, f(21), C_TEXT);
  int wTime = textW(mt, "00:00"), wTrain = 0, wPlat = 0; bool anyLate = false;
  for (int i = 0; i < n && i < (int)deps.size(); i++) { wTrain = std::max(wTrain, textW(mtr, deps[i]->line)); wPlat = std::max(wPlat, textW(mpl, deps[i]->platform)); if (!deps[i]->cancelled && deps[i]->hasDelay && deps[i]->delay > 0) anyLate = true; }
  if (anyLate) wTime = std::max(wTime, textW(mca, "ca. 00:00"));
  const int cTime = std::max(rnd(60 * s), wTime + 10), cTrain = std::max(rnd(64 * s), std::min(wTrain + 8, w * 3 / 10)), cPlat = std::max(rnd(38 * s), std::min(wPlat + 6, w / 4));
  const std::string clock = hhmm(localTm(now));

  { // Kopfzeile: "Abfahrt", Haltestelle, Uhrzeit
    Item it; it.r = {0, 0, w, hh}; it.bg = C_HEAD;
    it.paint = [=](Cell& c) { c.fillRect(0, hh - 2, w, 2, C_TEXT); };
    Style sa = styleSans(true, f(15), C_TEXT), ss = styleSans(false, f(13), C_DIM);
    const int ty = (hh - 2 - lineH(sa)) / 2, wa = textW(sa, "Abfahrt"), wt = textW(sa, clock);
    it.marqs.push_back({{10, 0, wa, hh - 2}, "Abfahrt", sa, ty, 0, 0, C_HEAD, 0, 0});
    it.marqs.push_back({{w - 10 - wt, 0, wt, hh - 2}, clock, sa, ty, 0, 2, C_HEAD, 0, 0});
    const int sx = 10 + wa + 10, sw = w - 10 - wt - 10 - sx;
    if (sw > 8) it.marqs.push_back({{sx, 0, sw, hh - 2}, station, ss, (hh - 2 - lineH(ss)) / 2, 0, 1, C_HEAD, rnd(2.6 * ss.em), 3 * ss.em / 2});
    sc.items.push_back(std::move(it));
  }
  if (deps.empty()) {
    Item it; it.r = {0, hh, w, std::min(h - hh, 96)}; it.bg = C_BG;
    Style st = styleSans(false, f(15), C_DIM);
    it.marqs.push_back({{0, hh, w, it.r.h}, loading ? "Lade Abfahrten \xE2\x80\xA6" : "Keine Abfahrten", st, hh + rnd(40 * s), 0, 1, C_BG, 0, 0});
    sc.items.push_back(std::move(it));
    return sc;
  }
  for (int i = 0; i < n && i < (int)deps.size(); i++) {
    const Dep& d = *deps[i]; const int y0 = hh + i * rowH;
    const bool late = !d.cancelled && d.hasDelay && d.delay > 0;
    Item it; it.r = {0, y0, w, rowH}; it.bg = C_BG;
    const std::string planned = hhmm(localTm(d.planned ? d.planned : d.when)), caTxt = late ? "ca. " + hhmm(localTm(d.when)) : "";
    Style st = styleSans(true, f(21), d.cancelled ? C_DIM : C_TEXT), sca = styleSans(false, f(12), C_DELAY), strain = styleSans(true, f(15), C_TEXT);
    Style sdest = styleSans(true, f(16), C_TEXT), ssub = styleSans(false, f(12), C_CANCEL), splat = styleSans(true, f(21), C_TEXT);
    const int tH = lineH(st), caH = late ? lineH(sca) : 0, tTop = y0 + (rowH - 1 - (tH + caH)) / 2;
    const int dH = lineH(sdest), subH = d.cancelled ? lineH(ssub) : 0, dTop = y0 + (rowH - 1 - (dH + subH)) / 2;
    const int dx = 8 + cTime + cTrain, dw = w - 8 - cPlat - dx - 6, wp = textW(splat, d.platform);
    const int yTrain = y0 + (rowH - 1 - lineH(strain)) / 2;
    it.paint = [=](Cell& c) {
      c.fillRect(0, y0 + rowH - 1, w, 1, C_LINE);
      drawText(c, st, 8, tTop, planned);
      if (d.cancelled) c.fillRect(8, tTop + tH / 2, textW(st, planned), std::max(1, tH / 14), C_DIM);
      if (late) drawText(c, sca, 8, tTop + tH, caTxt);
      if (d.cancelled) drawText(c, ssub, dx, dTop + dH, "Zug f\xC3\xA4llt aus");
      drawText(c, splat, w - 8 - wp, y0 + (rowH - 1 - lineH(splat)) / 2, d.platform);
    };
    it.marqs.push_back({{8 + cTime, yTrain, cTrain - 6, lineH(strain)}, d.line, strain, yTrain, 0, 0, C_BG, rnd(2.6 * strain.em), strain.em});
    it.marqs.push_back({{dx, dTop, dw, dH}, d.dir, sdest, dTop, 0, 0, C_BG, rnd(2.6 * sdest.em), sdest.em});
    sc.items.push_back(std::move(it));
  }
  return sc;
}

// ---------- Zugzielanzeiger (zugzielScreen) ----------
Scene sceneZugziel(int w, int h, const std::string& platform, const Dep* dep, bool loading, time_t now) {
  (void)now; (void)loading;
  Scene sc; sc.w = w; sc.h = h; sc.bg = Z_FRAME;
  const int bh = std::min(h, rnd(w / 2.05)), top = rnd((h - bh) / 2.0), p = std::max(3, rnd(w / 64.0));
  const int rh = (bh - 3 * p) / 2, rw = w - 2 * p;
  auto fs = [&](double v) { return std::max(8, rnd(v * rh)); };
  const int A = rnd(rw * .2), B = rnd(rw * .48), C = rw - A - B;   // Zeit und Zug brauchen in 5x7-Punkten mehr Platz als in der Vorschau
  const std::string msg = zzaNotice(dep != nullptr, dep && dep->cancelled, dep && dep->hasDelay ? dep->delay : 0);
  const int stripH = rnd(rh * .3), viaFs = fs(.22);
  const std::vector<std::string> via = viaLines(dep ? dep->via : std::vector<std::string>{}, (size_t)(B / (viaFs * .55)));
  std::string gl = trim(platform);
  const std::string t = dep ? hhmm(localTm(dep->planned ? dep->planned : dep->when)) : "";
  const bool cancelled = dep && dep->cancelled;
  auto seams = [=](Cell& c, int ox, int oy) { for (int pct : {20, 40, 60, 80}) c.fillRect(ox + rnd(rw * pct / 100.0) - 1, oy, 2, rh, Z_SEAM); };

  { // obere Reihe: Gleis | Hinweis und Zwischenhalte | Zeit und Zug
    const int ox = p, oy = top + p;
    Item it; it.r = {ox, oy, rw, rh}; it.bg = Z_BG;
    Style sg = styleDot(fs(gl.size() > 1 ? .55 : .86), Z_TEXT), stime = styleDot(fs(.34), cancelled ? Z_DIM : Z_TEXT), strain = styleDot(fs(.2), Z_TEXT);
    const int right = ox + A + B + C - rnd(rw * .02), trainGap = rnd(.25 * fs(.2));
    const int blockH = lineH(stime) + (dep ? trainGap + lineH(strain) : 0), bTop = oy + (rh - blockH) / 2;
    const int gx = ox + rnd(rw * .03);
    const std::string line = dep ? dep->line : "";
    it.paint = [=](Cell& c) {
      seams(c, ox, oy);
      if (!gl.empty()) drawText(c, sg, gx, oy + (rh - lineH(sg)) / 2, gl);
      if (msg.size()) c.fillRect(ox + A, oy + rnd(rh * .04), B, stripH, Z_STRIP);
      if (dep) {
        const int wt = textW(stime, t); drawText(c, stime, right - wt, bTop, t);
        if (cancelled) c.fillRect(right - wt, bTop + lineH(stime) / 2, wt, std::max(1, stime.c / 2), Z_DIM);
        drawText(c, strain, right - textW(strain, line), bTop + lineH(stime) + trainGap, line);
      }
    };
    if (msg.size()) {
      Style sm = styleDot(fs(.2), Z_STRIP_TEXT); const int sy = oy + rnd(rh * .04);
      it.marqs.push_back({{ox + A + 4, sy, B - 8, stripH}, msg, sm, sy + (stripH - lineH(sm)) / 2, 0, 0, Z_STRIP, rnd(2.6 * sm.em), 3 * sm.em, false});
    }
    Style sv = styleDot(viaFs, Z_TEXT);
    for (size_t i = 0; i < via.size(); i++) {
      const int vy = oy + rnd(rh * .04) + stripH + rnd(rh * .06) + (int)i * rnd(viaFs * 1.3), vh = rnd(viaFs * 1.2);
      Marq m{{ox + A + 4, vy, B - 8, vh}, via[i], sv, vy + (vh - lineH(sv)) / 2, 0, 0, Z_BG, rnd(2.6 * sv.em), 3 * sv.em, true};
      it.marqs.push_back(m);
    }
    sc.items.push_back(std::move(it));
  }
  { // untere Reihe: Ziel in großer Schrift
    const int ox = p, oy = top + 2 * p + rh;
    Item it; it.r = {ox, oy, rw, rh}; it.bg = Z_BG;
    it.paint = [=](Cell& c) { seams(c, ox, oy); };
    if (dep) {
      Style sd = styleDot(fs(.5), Z_TEXT);
      it.marqs.push_back({{ox + A + 4, oy, rw - A - 8, rh}, dep->dir, sd, oy + (rh - lineH(sd)) / 2, 0, 0, Z_BG, rnd(2.6 * sd.em), 3 * sd.em, true});
    }
    sc.items.push_back(std::move(it));
  }
  return sc;
}

// ---------- Uhr (clockScreen) ----------
Scene sceneClock(int w, int h, time_t now) {
  Scene sc; sc.w = w; sc.h = h; sc.bg = C_BG;
  const double s = std::max(.55, std::min(w / 320.0, h / 240.0));
  const struct tm t = localTm(now); const std::string tm_ = hhmm(t), dt = dateLongDe(t);
  Style sT = styleClock(rnd(.72 * 78 * s), C_TEXT), sD = styleSans(false, rnd(18 * s), C_DIM);
  const int y1 = rnd(36 * s), th = lineH(sT), y2 = y1 + th + rnd(14 * s);
  Item a; a.r = {0, y1 - 4, w, th + 8}; a.bg = C_BG;
  a.paint = [=](Cell& c) { drawText(c, sT, (w - textW(sT, tm_)) / 2, y1, tm_); };
  Item b; b.r = {0, y2 - 2, w, lineH(sD) + 4}; b.bg = C_BG;
  b.marqs.push_back({{0, y2 - 2, w, lineH(sD) + 4}, dt, sD, y2, 0, 1, C_BG, rnd(2.6 * sD.em), sD.em});
  sc.items.push_back(std::move(a)); sc.items.push_back(std::move(b));
  return sc;
}

Scene sceneMessage(int w, int h, const std::string& l1, const std::string& l2) {
  Scene sc; sc.w = w; sc.h = h; sc.bg = C_BG;
  const double s = std::max(.55, w / 320.0);
  Style s1 = styleSans(true, rnd(21 * s), C_TEXT), s2 = styleSans(false, rnd(15 * s), C_DIM);
  const int y1 = h / 2 - lineH(s1) - 2, y2 = h / 2 + 4;
  Item a; a.r = {0, y1 - 2, w, lineH(s1) + 4}; a.bg = C_BG;
  a.marqs.push_back({{4, y1 - 2, w - 8, lineH(s1) + 4}, l1, s1, y1, 0, 1, C_BG, rnd(2.6 * s1.em), s1.em});
  Item b; b.r = {0, y2 - 2, w, lineH(s2) + 4}; b.bg = C_BG;
  b.marqs.push_back({{4, y2 - 2, w - 8, lineH(s2) + 4}, l2, s2, y2, 0, 1, C_BG, rnd(2.6 * s2.em), s2.em});
  sc.items.push_back(std::move(a)); sc.items.push_back(std::move(b));
  return sc;
}

// ---------- OLED ----------
static OledLine field(const std::string& text, int avail, const std::string& right) {
  OledLine l; l.right = right;
  if ((int)charLen(text) <= avail) l.left = text; else { l.left = clipText(text, avail); l.full = text; l.avail = avail; }
  return l;
}
std::vector<OledLine> oledLines(int w, int h, bool header, const std::string& rightMode, const std::string& station, const std::vector<const Dep*>& deps, time_t now) {
  const int cols = w / 6, lines = h / 8; std::vector<OledLine> out;
  if (header) out.push_back(field(station, cols - 6, hhmm(localTm(now))));
  const int n = lines - (int)out.size();
  for (int i = 0; i < n && i < (int)deps.size(); i++) {
    const Dep& d = *deps[i]; std::string right;
    if (d.cancelled) right = "Ausfall";
    else if (rightMode == "zeit") right = hhmm(localTm(d.planned ? d.planned : d.when)) + (d.hasDelay && d.delay > 0 ? "+" + std::to_string(d.delay) : "");
    else { int m = minutesUntil(d.when, now); right = m == 0 ? "jetzt" : std::to_string(m) + " min"; }
    out.push_back(field(d.line + " " + d.dir, cols - (int)charLen(right) - 1, right));
  }
  return out;
}
bool oledAnimated(const std::vector<OledLine>& lines) { for (auto& l : lines) if (!l.full.empty()) return true; return false; }

// Text im 5x7-Raster. Nur Pixel zwischen x0 und x1 werden gesetzt (für Laufschrift).
static int oledText(Adafruit_GFX& g, const std::string& t, int x, int y, int scale, int x0, int x1) {
  for (uint32_t cp : decodeUtf8(t)) {
    const uint8_t* gl = glyph5x7(cp);
    for (int c = 0; c < 5; c++) for (int r = 0; r < 7; r++) if (gl[c] >> r & 1)
      for (int dx = 0; dx < scale; dx++) for (int dy = 0; dy < scale; dy++) { int px = x + c * scale + dx; if (px >= x0 && px < x1) g.drawPixel(px, y + r * scale + dy, 1); }
    x += 6 * scale;
  }
  return x;
}
void oledDrawLines(Adafruit_GFX& g, int w, const std::vector<OledLine>& lines, uint32_t t) {
  for (size_t i = 0; i < lines.size(); i++) {
    const OledLine& l = lines[i]; const int y = (int)i * 8;
    if (!l.right.empty()) oledText(g, l.right, w - (int)charLen(l.right) * 6, y, 1, 0, w);
    if (l.full.empty()) { oledText(g, l.left, 0, y, 1, 0, w); continue; }
    const int gap = 3, unit = ((int)charLen(l.full) + gap) * 6, fw = l.avail * 6, off = marqueeOffset(t, unit, 25);
    const std::string two = l.full + std::string(gap, ' ') + l.full;
    oledText(g, two, -off, y, 1, 0, fw);
  }
}
void oledDrawClock(Adafruit_GFX& g, int w, int h, time_t now) {
  const struct tm t = localTm(now); const std::string s = hhmm(t);
  const int sc = std::max(1, std::min(w / ((int)s.size() * 6), ((h >= 64 ? h - 12 : h)) / 8));
  const int tw = (int)s.size() * 6 * sc - sc, th = 7 * sc, x0 = rnd((w - tw) / 2.0), y0 = h >= 64 ? rnd((h - 12 - th) / 2.0) : rnd((h - th) / 2.0);
  oledText(g, s, x0, y0, sc, 0, w);
  if (h >= 64) { const std::string d = dateShortDe(t); oledText(g, d, rnd((w - (int)d.size() * 6) / 2.0), h - 10, 1, 0, w); }
}
void oledDrawMessage(Adafruit_GFX& g, int w, const std::string& l1, const std::string& l2) {
  const int cols = w / 6;
  oledText(g, clipText(l1, cols), 0, 0, 1, 0, w); oledText(g, clipText(l2, cols), 0, 12, 1, 0, w);
}

}  // namespace p4r
