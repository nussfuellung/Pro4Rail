// Konfiguration lesen und zwischenspeichern, Zugangsdaten im Flash (NVS).
#include <Preferences.h>
#include <LittleFS.h>
#include "app.h"

namespace p4r {

static SemaphoreHandle_t mx = xSemaphoreCreateMutex();
static ConfigPtr cur = std::make_shared<Config>();
static uint32_t version = 0;

ConfigPtr getConfig() { xSemaphoreTake(mx, portMAX_DELAY); ConfigPtr c = cur; xSemaphoreGive(mx); return c; }
uint32_t configVersion() { return version; }

static std::string str(JsonVariantConst v, const char* d = "") { return v.is<const char*>() ? std::string(v.as<const char*>()) : std::string(d); }
static int clampInt(JsonVariantConst v, int lo, int hi, int d) { if (!v.is<int>() && !v.is<float>()) return d; int x = v.as<int>(); return x < lo ? lo : x > hi ? hi : x; }

// Entspricht normConfig in Pro4Rail/app.js: fehlende Teile werden ergänzt, Werte begrenzt.
static std::shared_ptr<Config> parse(JsonVariantConst j) {
  auto c = std::make_shared<Config>();
  JsonVariantConst f = j["features"];
  c->fDisplays = f["displays"] | true; c->fLight = f["light"] | true; c->fAudio = f["audio"] | true;
  c->lightOn = j["light"]["on"] | false; c->brightness = clampInt(j["light"]["brightness"], 0, 100, 100); c->dimmable = j["light"]["dimmable"] | true; c->lightInvert = j["light"]["invert"] | false;
  c->volume = clampInt(j["audio"]["volume"], 0, 100, 60);
  for (JsonVariantConst d : j["displays"].as<JsonArrayConst>()) {
    DisplayCfg x; x.slot = clampInt(d["slot"], 1, P4R_MAX_DISPLAYS, 1);
    std::string type = str(d["type"], "tft"); x.oled = (type == "oled" || type == "seg");   // "seg" war die frühere Segmentanzeige
    x.tftModel = str(d["tft"]["model"], "ST7789"); x.landscape = !(d["tft"]["landscape"].is<bool>() && d["tft"]["landscape"].as<bool>() == false);   // wie screenSize in tft.js: nur ein ausdrückliches false ist Hochformat
    x.oledModel = str(d["oled"]["model"], "SSD1306_32"); x.oledRight = str(d["oled"]["right"], "min"); x.oledHeader = d["oled"]["header"] | true;
    x.content = str(d["content"], "abfahrt");
    if (x.oled && x.content != "uhr") x.content = "abfahrt";          // OLED kennt nur Abfahrten und Uhr
    if (!x.oled && x.content != "abfahrt" && x.content != "zugziel" && x.content != "uhr" && x.content != "bild") x.content = "abfahrt";
    x.stationId = str(d["station"]["id"]); x.stationName = str(d["station"]["name"]);
    x.filter = str(d["filter"]); x.platform = str(d["platform"]);
    x.rows = clampInt(d["rows"], 1, 4, 2); x.interval = clampInt(d["interval"], 2, 3600, 10);
    if (d["imageIds"].is<JsonArrayConst>()) for (JsonVariantConst id : d["imageIds"].as<JsonArrayConst>()) if (id.is<const char*>()) x.imageIds.push_back(id.as<const char*>());
    if (x.imageIds.empty() && d["imageId"].is<const char*>()) x.imageIds.push_back(d["imageId"].as<const char*>());   // früher nur ein Bild
    c->displays.push_back(x);
  }
  std::sort(c->displays.begin(), c->displays.end(), [](const DisplayCfg& a, const DisplayCfg& b) { return a.slot < b.slot; });
  for (JsonVariantConst r : j["audio"]["rules"].as<JsonArrayConst>()) {
    Rule x; x.id = str(r["id"]); x.name = str(r["name"]); x.trigger = str(r["trigger"]); x.mediaId = str(r["mediaId"]); x.time = str(r["time"]);
    x.enabled = r["enabled"] | true; x.slot = r["slot"] | 0; x.minBefore = clampInt(r["minBefore"], 0, 30, 2); x.minDelay = clampInt(r["minDelay"], 1, 120, 5);
    for (JsonVariantConst d : r["days"].as<JsonArrayConst>()) x.days.push_back(d.as<int>());
    if (!x.id.empty()) c->rules.push_back(x);
  }
  return c;
}

void setConfigFromJson(JsonVariantConst cfg) {
  std::string raw; serializeJson(cfg, raw);
  if (raw == cur->raw) return;
  auto c = parse(cfg); c->raw = raw;
  xSemaphoreTake(mx, portMAX_DELAY); cur = c; version++; xSemaphoreGive(mx);
  File f = LittleFS.open("/cfg.json", "w"); if (f) { f.write((const uint8_t*)raw.data(), raw.size()); f.close(); }   // für den Start ohne Netz
}

// Beim Start die zuletzt gültige Konfiguration laden (Anzeigen laufen auch ohne Netz weiter)
void configRestore() {
  File f = LittleFS.open("/cfg.json", "r"); if (!f) return;
  JsonDocument d; if (!deserializeJson(d, f)) setConfigFromJson(d.as<JsonVariantConst>());
}

// ---------- Zugangsdaten ----------
bool credsLoad(Creds& c) {
  Preferences p; if (!p.begin("p4r", true)) return false;
  c.ssid = p.getString("ssid", ""); c.pass = p.getString("pass", ""); c.token = p.getString("token", ""); c.base = p.getString("base", P4R_SUPABASE_URL);
  p.end(); return c.ssid.length() > 0 && c.token.length() > 0;
}
void credsSave(const Creds& c) {
  Preferences p; p.begin("p4r", false);
  p.putString("ssid", c.ssid); p.putString("pass", c.pass); p.putString("token", c.token); p.putString("base", c.base); p.end();
}
void credsClear() { Preferences p; p.begin("p4r", false); p.clear(); p.end(); }
String deviceUid() {
  uint64_t m = ESP.getEfuseMac(); char b[24]; snprintf(b, sizeof b, "ESP-%02X%02X%02X%02X%02X%02X", (uint8_t)(m), (uint8_t)(m >> 8), (uint8_t)(m >> 16), (uint8_t)(m >> 24), (uint8_t)(m >> 32), (uint8_t)(m >> 40));
  return String(b);
}

}  // namespace p4r
