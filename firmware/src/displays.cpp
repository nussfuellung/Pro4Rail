// Anzeigen ansteuern: TFT (ST7789, ILI9341, ST7735 am gemeinsamen SPI-Bus) und OLED (SSD1306, SH1106 am I2C-Bus).
// Was gezeichnet wird, steht in screens.cpp. Hier nur: Treiber anlegen, Daten holen, Bildausschnitte senden, Laufschrift takten.
#include <SPI.h>
#include <Wire.h>
#include <LittleFS.h>
#include <Adafruit_ST7789.h>
#include <Adafruit_ST7735.h>
#include <Adafruit_ILI9341.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_SH110X.h>
#include <JPEGDEC.h>
#include <AnimatedGIF.h>
#include "app.h"
#include "screens.h"

namespace p4r {

#if defined(BOARD_S3)
static SPIClass tftSpi(FSPI);
#else
static SPIClass tftSpi(VSPI);
#endif

struct Panel {
  DisplayCfg cfg; int w = 0, h = 0; bool ok = false, isOled = false;
  Adafruit_SPITFT* tft = nullptr;
  Adafruit_GFX* og = nullptr; Adafruit_SSD1306* ssd = nullptr; Adafruit_SH1106G* sh = nullptr;
  Scene scene; std::string layout, key; std::vector<std::pair<int, int>> anims; uint32_t lastAnim = 0;
  std::vector<OledLine> oledLn; bool oledAnim = false;
  // Bilder
  std::vector<std::string> paths; size_t idx = 0; uint32_t slideEnd = 0; std::string shown;
  AnimatedGIF* gif = nullptr; uint32_t gifNext = 0; bool imgPainted = false;
};
static std::vector<Panel*> P;
static Cell cell; static bool cellOk = false;
static uint32_t builtVer = 0xFFFFFFFF; static std::string hwSig;

static const int CELL_W = 320, CELL_H = 96;      // größtes Teilfenster, das auf einmal gezeichnet wird

// ---------- Anlegen ----------
static void tftBegin() {
  static bool done = false; if (done) return; done = true;
  tftSpi.begin(PIN_TFT_SCK, -1, PIN_TFT_MOSI, -1);
  pinMode(PIN_TFT_RST, OUTPUT); digitalWrite(PIN_TFT_RST, HIGH); delay(10); digitalWrite(PIN_TFT_RST, LOW); delay(20); digitalWrite(PIN_TFT_RST, HIGH); delay(120);   // Reset gemeinsam für alle
  pinMode(PIN_TFT_BL, OUTPUT); digitalWrite(PIN_TFT_BL, HIGH);
}
static bool makeTft(Panel& p) {
  const int cs = PIN_TFT_CS[p.cfg.slot - 1]; if (cs < 0) return false;
  tftBegin(); pinMode(cs, OUTPUT); digitalWrite(cs, HIGH);
  int nw = 240, nh = 320;
  if (p.cfg.tftModel == "ST7735") { auto* t = new Adafruit_ST7735(&tftSpi, cs, PIN_TFT_DC, -1); t->initR(INITR_BLACKTAB); nw = 128; nh = 160; p.tft = t; }
  else if (p.cfg.tftModel == "ILI9341") { auto* t = new Adafruit_ILI9341(&tftSpi, PIN_TFT_DC, cs, -1); t->begin(40000000); p.tft = t; }
  else { auto* t = new Adafruit_ST7789(&tftSpi, cs, PIN_TFT_DC, -1); t->init(240, 320); t->setSPISpeed(40000000); p.tft = t; }
  p.tft->setRotation(p.cfg.landscape ? 1 : 0);
  p.w = p.cfg.landscape ? nh : nw; p.h = p.cfg.landscape ? nw : nh;
  p.tft->fillScreen(0); return true;
}
static bool makeOled(Panel& p, int idx) {
  static bool wire = false; if (!wire) { Wire.begin(PIN_SDA, PIN_SCL); Wire.setClock(400000); wire = true; }
  if (idx > 1) return false;
  const bool sh = p.cfg.oledModel.rfind("SH1106", 0) == 0; p.w = 128; p.h = p.cfg.oledModel.find("_32") != std::string::npos ? 32 : 64;
  if (sh) { p.sh = new Adafruit_SH1106G(p.w, p.h, &Wire, -1); if (!p.sh->begin(OLED_ADDR[idx], true)) return false; p.og = p.sh; }
  else { p.ssd = new Adafruit_SSD1306(p.w, p.h, &Wire, -1); if (!p.ssd->begin(SSD1306_SWITCHCAPVCC, OLED_ADDR[idx])) return false; p.og = p.ssd; }
  p.og->cp437(false); p.isOled = true; return true;
}
static void freePanel(Panel* p) {
  if (p->gif) { p->gif->close(); delete p->gif; }
  delete p->tft; delete p->ssd; delete p->sh; delete p;
}

// Nur wenn sich Bauart, Modell oder Ausrichtung ändern, müssen die Treiber neu angelegt werden.
static std::string hwSignature(const Config& c) {
  std::string s; if (!c.fDisplays) return s;
  for (auto& d : c.displays) if (d.slot <= MAX_DISPLAYS) s += std::to_string(d.slot) + (d.oled ? "o" + d.oledModel : "t" + d.tftModel + (d.landscape ? "L" : "P")) + ";";
  return s;
}
static void rebuild(const Config& c) {
  const std::string sig = hwSignature(c);
  if (sig != hwSig) {
    for (auto* p : P) freePanel(p); P.clear(); hwSig = sig; int oledN = 0;
    if (c.fDisplays) for (auto& d : c.displays) {
      if (d.slot > MAX_DISPLAYS) continue;
      auto* p = new Panel; p->cfg = d;
      p->ok = d.oled ? makeOled(*p, oledN++) : makeTft(*p);
      Serial.printf("[anzeige] Platz %d (%s): %s\n", d.slot, d.oled ? d.oledModel.c_str() : d.tftModel.c_str(), p->ok ? "bereit" : "nicht gefunden");
      P.push_back(p);
    }
  } else {   // gleiche Hardware: nur die Einstellungen übernehmen
    for (auto* p : P) for (auto& d : c.displays) if (d.slot == p->cfg.slot) { p->cfg = d; p->key.clear(); p->shown.clear(); p->paths.clear(); }
  }
  for (auto* p : P) { p->key.clear(); p->idx = 0; p->slideEnd = 0; p->shown.clear(); }
}

void displaysInit() {
  cellOk = cell.alloc((size_t)CELL_W * CELL_H); cell.setScreen(CELL_W, 480);
  if (!cellOk) Serial.println("[anzeige] Kein Speicher für den Zeichenpuffer");
}

// ---------- Zeichnen (TFT) ----------
static void blit(Panel& p) { Rect r = cell.window(); p.tft->drawRGBBitmap(r.x, r.y, (uint16_t*)cell.data(), r.w, r.h); }
static std::string layoutSig(const Scene& s) { std::string o = std::to_string(s.w) + "x" + std::to_string(s.h); for (auto& i : s.items) o += "|" + std::to_string(i.r.x) + "," + std::to_string(i.r.y) + "," + std::to_string(i.r.w) + "," + std::to_string(i.r.h); return o; }
static void paintScene(Panel& p, uint32_t ms) {
  const std::string sig = layoutSig(p.scene);
  if (sig != p.layout) { p.tft->fillScreen(p.scene.bg); p.layout = sig; }     // nur wenn sich die Aufteilung ändert, sonst flackert es
  p.anims.clear();
  for (size_t i = 0; i < p.scene.items.size(); i++) {
    const Item& it = p.scene.items[i]; paintItem(cell, it, ms); blit(p);
    for (size_t k = 0; k < it.marqs.size(); k++) if (it.marqs[k].overflows() && it.marqs[k].speed > 0) p.anims.push_back({(int)i, (int)k});
  }
}
static void animate(Panel& p, uint32_t ms) {
  if (p.anims.empty() || ms - p.lastAnim < 40) return; p.lastAnim = ms;
  for (auto& a : p.anims) { const Item& it = p.scene.items[a.first]; paintMarqFrame(cell, it, it.marqs[a.second], ms); blit(p); }
}

// ---------- Bilder und GIFs ----------
static Panel* curImg = nullptr; static int imgW, imgH, imgOx, imgOy, imgRw, imgRh;
static void* fOpen(const char* name, int32_t* size) { File* f = new File(LittleFS.open(name, "r")); if (!*f) { delete f; return nullptr; } *size = f->size(); return f; }
static void fClose(void* h) { File* f = (File*)h; if (f) { f->close(); delete f; } }
static int32_t jRead(JPEGFILE* f, uint8_t* b, int32_t n) { File* fh = (File*)f->fHandle; int32_t r = fh->read(b, n); f->iPos = fh->position(); return r; }
static int32_t jSeek(JPEGFILE* f, int32_t pos) { File* fh = (File*)f->fHandle; fh->seek(pos); f->iPos = pos; return pos; }
static int32_t gRead(GIFFILE* f, uint8_t* b, int32_t n) { File* fh = (File*)f->fHandle; int32_t r = fh->read(b, n); f->iPos = fh->position(); return r; }
static int32_t gSeek(GIFFILE* f, int32_t pos) { File* fh = (File*)f->fHandle; fh->seek(pos); f->iPos = pos; return pos; }
static inline int ceilDiv(int a, int b) { return (a * 1 + b - 1) / b; }

// Bild einpassen (ganz sichtbar, Ränder schwarz): Zielfläche ausrechnen
static void fit(Panel& p, int sw, int sh) {
  imgW = sw; imgH = sh; double s = std::min((double)p.w / sw, (double)p.h / sh);
  imgRw = std::max(1, (int)(sw * s)); imgRh = std::max(1, (int)(sh * s)); imgOx = (p.w - imgRw) / 2; imgOy = (p.h - imgRh) / 2;
}
// JPEG-Block (Quellkoordinaten) auf die Zielfläche abbilden, Nächster-Nachbar
static int jDraw(JPEGDRAW* d) {
  Panel* p = curImg; static uint16_t row[512];
  const int x0 = imgOx + ceilDiv(d->x * imgRw, imgW), x1 = imgOx + ceilDiv((d->x + d->iWidth) * imgRw, imgW);
  const int y0 = imgOy + ceilDiv(d->y * imgRh, imgH), y1 = imgOy + ceilDiv((d->y + d->iHeight) * imgRh, imgH);
  const int cw = std::min(x1, imgOx + imgRw) - x0; if (cw <= 0 || cw > 512) return 1;
  for (int Y = y0; Y < std::min(y1, imgOy + imgRh); Y++) {
    const int sy = std::min(imgH - 1, (Y - imgOy) * imgH / imgRh) - d->y; if (sy < 0 || sy >= d->iHeight) continue;
    for (int X = 0; X < cw; X++) { int sx = std::min(imgW - 1, (x0 + X - imgOx) * imgW / imgRw) - d->x; if (sx < 0) sx = 0; if (sx >= d->iWidth) sx = d->iWidth - 1; row[X] = d->pPixels[sy * d->iWidth + sx]; }
    p->tft->drawRGBBitmap(x0, Y, row, cw, 1);
  }
  return 1;
}
// GIF-Zeile (eine Quellzeile) auf die Zielfläche abbilden. Transparente Punkte bleiben unverändert.
static void gDraw(GIFDRAW* d) {
  Panel* p = curImg; static uint16_t row[512];
  const int sy = d->iY + d->y; if (sy >= imgH) return;
  const int Y0 = imgOy + ceilDiv(sy * imgRh, imgH), Y1 = std::min(imgOy + imgRh, imgOy + ceilDiv((sy + 1) * imgRh, imgH));
  if (Y0 >= Y1) return;
  const int X0 = imgOx + ceilDiv(d->iX * imgRw, imgW), X1 = std::min(imgOx + imgRw, imgOx + ceilDiv((d->iX + d->iWidth) * imgRw, imgW));
  for (int Y = Y0; Y < Y1; Y++) {
    int run = 0, rx = X0;
    for (int X = X0; X <= X1; X++) {
      bool opaque = false; uint16_t col = 0;
      if (X < X1) { int sx = std::min(imgW - 1, (X - imgOx) * imgW / imgRw) - d->iX; if (sx < 0) sx = 0; if (sx >= d->iWidth) sx = d->iWidth - 1; uint8_t idx = d->pPixels[sx]; opaque = !(d->ucHasTransparency && idx == d->ucTransparent); col = d->pPalette[idx]; }
      if (opaque && run < 512) { if (!run) rx = X; row[run++] = col; }
      else if (run) { p->tft->drawRGBBitmap(rx, Y, row, run, 1); run = 0; if (opaque) { rx = X; row[run++] = col; } }
    }
  }
}

static bool isGif(File& f) { uint8_t b[4] = {0}; f.read(b, 4); f.seek(0); return b[0] == 'G' && b[1] == 'I' && b[2] == 'F'; }
static void closeGif(Panel& p) { if (p.gif) { p.gif->close(); delete p.gif; p.gif = nullptr; } }

static void showMessage(Panel& p, const std::string& a, const std::string& b, uint32_t ms) {
  const std::string k = "m|" + a + "|" + b; if (k == p.key) return; p.key = k;
  p.scene = sceneMessage(p.w, p.h, a, b); paintScene(p, ms);
}
static void serviceImages(Panel& p, uint32_t ms) {
  if (p.cfg.imageIds.empty()) { closeGif(p); showMessage(p, "Kein Bild gew\xC3\xA4hlt", "In der App Bilder ankreuzen", ms); return; }
  // Welche Dateien sind schon da?
  std::vector<std::string> have;
  for (auto& id : p.cfg.imageIds) { std::string path; if (mediaLocal(id, path)) have.push_back(path); }
  if (have.empty()) { closeGif(p); showMessage(p, "Bild wird geladen", "Einen Moment bitte \xE2\x80\xA6", ms); return; }
  if (have != p.paths) { p.paths = have; p.idx = 0; p.slideEnd = 0; p.shown.clear(); }
  const bool due = p.shown.empty() || (p.paths.size() > 1 && (int32_t)(ms - p.slideEnd) >= 0);
  if (due) {
    if (!p.shown.empty() && p.paths.size() > 1) p.idx = (p.idx + 1) % p.paths.size();
    const std::string path = p.paths[p.idx]; closeGif(p);
    File f = LittleFS.open(path.c_str(), "r"); if (!f) { p.shown.clear(); return; }
    const bool gif = isGif(f); f.close();
    p.slideEnd = ms + (uint32_t)p.cfg.interval * 1000; p.shown = path; p.key.clear(); p.imgPainted = false;
    curImg = &p; p.tft->fillScreen(0);
    if (gif) {
      p.gif = new AnimatedGIF; p.gif->begin(LITTLE_ENDIAN_PIXELS);
      if (!p.gif->open(path.c_str(), fOpen, fClose, gRead, gSeek, gDraw)) { delete p.gif; p.gif = nullptr; p.shown.clear(); showMessage(p, "GIF nicht lesbar", "", ms); return; }
      fit(p, p.gif->getCanvasWidth(), p.gif->getCanvasHeight()); p.gifNext = ms;
    } else {
      JPEGDEC* j = new JPEGDEC; j->setPixelType(RGB565_LITTLE_ENDIAN);
      if (j->open(path.c_str(), fOpen, fClose, jRead, jSeek, jDraw)) { fit(p, j->getWidth(), j->getHeight()); j->decode(0, 0, 0); j->close(); p.imgPainted = true; }
      else { p.shown.clear(); showMessage(p, "Bild nicht lesbar", "Nur JPEG und GIF", ms); }
      delete j;
    }
  }
  if (p.gif && (int32_t)(ms - p.gifNext) >= 0) {   // nächstes Bild der Animation
    int delayMs = 0; curImg = &p; int r = p.gif->playFrame(false, &delayMs);
    if (r <= 0) { p.gif->reset(); delayMs = std::max(delayMs, 20); }
    p.gifNext = ms + (uint32_t)(delayMs < 20 ? 100 : delayMs);       // sehr kurze Angaben wie im Browser auf 100 ms setzen
  }
}

// ---------- Zeichnen (OLED) ----------
static void oledShow(Panel& p) { if (p.ssd) p.ssd->display(); else p.sh->display(); }
static void oledClear(Panel& p) { if (p.ssd) p.ssd->clearDisplay(); else p.sh->clearDisplay(); }

static std::vector<const Dep*> pick(const DisplayCfg& c, const DepData& d, time_t now, bool platformOnly) {
  std::vector<const Dep*> out; if (!d.deps) return out;
  for (auto& x : *d.deps) {
    if (x.when < now - 30 || !lineMatches(x.line, c.filter)) continue;       // schon abgefahrene Züge nicht mehr zeigen
    if (platformOnly && !platformMatches(x.platform, c.platform)) continue;
    out.push_back(&x);
  }
  return out;
}

static void serviceOled(Panel& p, uint32_t ms, time_t now) {
  const DisplayCfg& c = p.cfg;
  if (!netTimeValid()) { if (p.key != "t") { p.key = "t"; oledClear(p); oledDrawMessage(*p.og, p.w, "Uhrzeit wird", "geholt ..."); oledShow(p); } return; }
  if (c.content == "uhr") {
    const std::string k = "u|" + std::to_string(now / 60); if (k == p.key) return; p.key = k;
    oledClear(p); oledDrawClock(*p.og, p.w, p.h, now); oledShow(p); return;
  }
  if (c.stationId.empty()) { if (p.key != "s") { p.key = "s"; oledClear(p); oledDrawMessage(*p.og, p.w, "Kein Bahnhof", "in der App w\xC3\xA4hlen"); oledShow(p); } return; }
  DepData d = getDepartures(c.stationId); auto deps = pick(c, d, now, false);
  const std::string k = "a|" + std::to_string(d.version) + "|" + std::to_string(now / 60);
  if (k != p.key) { p.key = k; p.oledLn = oledLines(p.w, p.h, c.oledHeader, c.oledRight, c.stationName, deps, now); p.oledAnim = oledAnimated(p.oledLn); if (!d.ok && !d.deps) { p.oledLn.clear(); } p.lastAnim = 0; if (!p.oledAnim) { oledClear(p); if (p.oledLn.empty()) oledDrawMessage(*p.og, p.w, d.ok ? "Keine Abfahrten" : "Lade Daten ...", ""); else oledDrawLines(*p.og, p.w, p.oledLn, 0); oledShow(p); return; } }
  if (p.oledAnim && ms - p.lastAnim >= 50) { p.lastAnim = ms; oledClear(p); oledDrawLines(*p.og, p.w, p.oledLn, ms); oledShow(p); }
}

// ---------- Schleife ----------
static void serviceTft(Panel& p, uint32_t ms, time_t now) {
  const DisplayCfg& c = p.cfg;
  if (c.content == "bild") { serviceImages(p, ms); return; }
  closeGif(p); p.paths.clear(); p.shown.clear();
  if (!netTimeValid()) { showMessage(p, "Uhrzeit wird geholt", "", ms); return; }
  std::string key;
  if (c.content == "uhr") {
    key = "u|" + std::to_string(now / 60);
    if (key != p.key) { p.key = key; p.scene = sceneClock(p.w, p.h, now); paintScene(p, ms); }
  } else if (c.stationId.empty()) {
    showMessage(p, "Kein Bahnhof gew\xC3\xA4hlt", "In der App einstellen", ms);
  } else if (c.content == "zugziel" && trim(c.platform).empty()) {
    showMessage(p, "Kein Gleis eingestellt", "In der App eintragen", ms);
  } else {
    DepData d = getDepartures(c.stationId); const bool zz = c.content == "zugziel"; auto deps = pick(c, d, now, zz);
    key = std::string(zz ? "z|" : "a|") + std::to_string(d.version) + "|" + std::to_string(now / 60) + (d.ok ? "1" : "0");
    if (key != p.key) {
      p.key = key; const bool loading = !d.ok && !d.deps;
      p.scene = zz ? sceneZugziel(p.w, p.h, c.platform, deps.empty() ? nullptr : deps[0], loading, now) : sceneDeparture(p.w, p.h, c.rows, c.stationName, deps, loading, now);
      paintScene(p, ms);
    }
  }
  animate(p, ms);
}

void displaysLoop() {
  const uint32_t ms = millis(); ConfigPtr cfg = getConfig();
  if (configVersion() != builtVer) { builtVer = configVersion(); rebuild(*cfg); }
  if (!cellOk) return;
  static uint32_t lastReq = 0; const bool req = ms - lastReq > 1000; if (req) lastReq = ms;
  const time_t now = time(nullptr);
  for (auto* p : P) {
    if (!p->ok) continue;
    if (req && !p->cfg.stationId.empty() && (p->cfg.content == "abfahrt" || p->cfg.content == "zugziel")) depRequest(p->cfg.stationId, p->cfg.stationName, p->cfg.content == "zugziel" ? 60 : 15);
    if (p->isOled) serviceOled(*p, ms, now); else serviceTft(*p, ms, now);
  }
}

// Für die Regeln: Station und Linienfilter eines Platzes
bool displayStation(int slot, std::string& id, std::string& filter) {
  ConfigPtr c = getConfig();
  for (auto& d : c->displays) if (d.slot == slot && !d.stationId.empty()) { id = d.stationId; filter = d.filter; return true; }
  return false;
}

}  // namespace p4r
