// Verbindung zur Cloud: WLAN, Uhrzeit, Abfragen (device-poll), Befehle, Regeln für Ansagen, Medien vorladen.
#include <WiFi.h>
#include <LittleFS.h>
#include "app.h"

namespace p4r {

// ---------- Regeln ----------
static std::vector<std::pair<std::string, uint32_t>> fired;
static bool once(const std::string& key) {
  const uint32_t now = millis();
  fired.erase(std::remove_if(fired.begin(), fired.end(), [&](auto& f) { return now - f.second > 2 * 3600 * 1000UL; }), fired.end());
  for (auto& f : fired) if (f.first == key) return false;
  fired.push_back({key, now}); return true;
}
static void rulesTick() {
  if (!netTimeValid()) return;
  ConfigPtr c = getConfig(); if (!c->fAudio) return;
  const time_t now = time(nullptr); struct tm t; localtime_r(&now, &t);
  for (auto& r : c->rules) {
    if (!r.enabled || r.mediaId.empty()) continue;
    if (r.trigger == "zeit") {
      int h, m; if (!parseHHMM(r.time.c_str(), h, m) || !dayInList(r.days, t.tm_wday) || h != t.tm_hour || m != t.tm_min) continue;
      char k[40]; snprintf(k, sizeof k, "%s|%04d%02d%02d%02d%02d", r.id.c_str(), t.tm_year + 1900, t.tm_mon + 1, t.tm_mday, h, m);
      if (once(k)) audioPlayMedia(r.mediaId, c->volume);
    } else if (r.trigger == "abfahrt" || r.trigger == "verspaetung") {
      std::string id, filter; if (!displayStation(r.slot, id, filter)) continue;
      depRequest(id, "");
      DepData d = getDepartures(id); if (!d.deps) continue;
      for (auto& dep : *d.deps) {
        if (dep.cancelled || !lineMatches(dep.line, filter)) continue;
        const long sec = (long)(dep.when - now);
        const bool hit = r.trigger == "abfahrt" ? (sec <= r.minBefore * 60L && sec > r.minBefore * 60L - 60) : (dep.hasDelay && dep.delay >= r.minDelay && sec > -60);
        if (hit && once(r.id + "|" + std::to_string((long)dep.planned) + "|" + dep.line)) { Serial.printf("[regel] %s: %s\n", r.name.c_str(), dep.line.c_str()); audioPlayMedia(r.mediaId, c->volume); }
      }
    }
  }
}

// ---------- Befehle (siehe supabase/functions/README.md) ----------
static void handleCommand(JsonVariantConst cmd) {
  const char* type = cmd["type"] | ""; JsonVariantConst p = cmd["payload"];
  if (!strcmp(type, "light")) { bool on = p["on"] | false; int br = p["brightness"] | 100; ConfigPtr c = getConfig(); lightSet(on, br, c->dimmable, c->lightInvert); }
  else if (!strcmp(type, "volume")) audioSetVolume(p["volume"] | 60);
  else if (!strcmp(type, "announce")) { const char* m = p["rule"]["mediaId"] | ""; if (*m) audioPlayMedia(m, p["volume"] | -1); }
  else if (!strcmp(type, "refresh")) depInvalidate();
  else Serial.printf("[befehl] unbekannt: %s\n", type);
}

// ---------- Medien ----------
static void mediaPrefetch() {
  static uint32_t last = 0; if (millis() - last < 10000) return; last = millis();
  ConfigPtr c = getConfig(); std::vector<std::string> want;
  for (auto& d : c->displays) if (d.content == "bild") for (auto& id : d.imageIds) want.push_back(id);
  for (auto& r : c->rules) if (r.enabled && !r.mediaId.empty() && r.mediaId != "auto") want.push_back(r.mediaId);
  for (auto& id : want) { std::string p; if (!mediaLocal(id, p)) { mediaEnsure(id, p); break; } }     // eine Datei pro Durchgang
  static uint32_t lastVer = 0; if (lastVer != configVersion()) { lastVer = configVersion(); mediaCleanup(want); }
}

// ---------- WLAN und Uhrzeit ----------
static bool wifiUp(const Creds& c) {
  if (WiFi.status() == WL_CONNECTED) return true;
  static uint32_t lastTry = 0; if (lastTry && millis() - lastTry < 15000) return false; lastTry = millis();
  Serial.printf("[wlan] verbinde mit %s ...\n", c.ssid.c_str());
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(c.ssid.c_str(), c.pass.c_str());
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) vTaskDelay(pdMS_TO_TICKS(500));
  if (WiFi.status() == WL_CONNECTED) { Serial.printf("[wlan] verbunden, %s\n", WiFi.localIP().toString().c_str()); configTzTime(P4R_TZ, "pool.ntp.org", "time.cloudflare.com", "time.google.com"); return true; }
  return false;
}

void cloudTask(void*) {
  Creds c; if (!credsLoad(c)) { Serial.println("[cloud] keine Zugangsdaten"); vTaskDelete(nullptr); }
  uint32_t nextPoll = 0, nextTick = 0; int pollSec = 5, bad401 = 0;
  for (;;) {
    if (!wifiUp(c)) { vTaskDelay(pdMS_TO_TICKS(1000)); continue; }
    const uint32_t now = millis();
    if (netTimeValid() && (int32_t)(now - nextPoll) >= 0) {
      nextPoll = now + pollSec * 1000UL;
      JsonDocument doc;
      int code = httpGet(c.base + "/functions/v1/device-poll", c.token.c_str(), [&](Stream& s, int) { return !deserializeJson(doc, s); });
      if (code == 200) {
        bad401 = 0;
        const int ps = doc["poll_seconds"] | 5; pollSec = ps < 2 ? 2 : ps > 60 ? 60 : ps;
        if (doc["config"].is<JsonObject>()) setConfigFromJson(doc["config"]);
        for (JsonVariant cmd : doc["commands"].as<JsonArray>()) handleCommand(cmd);
      } else if (code == 401) {
        if (++bad401 >= 3) { Serial.println("[cloud] Token ungültig, Kopplung wird gelöscht"); credsClear(); delay(500); ESP.restart(); }
      } else Serial.printf("[cloud] device-poll: HTTP %d\n", code);
    }
    if (netTimeValid()) { depLoop(); mediaPrefetch(); }
    if ((int32_t)(now - nextTick) >= 0) { nextTick = now + 1000; rulesTick(); }
    vTaskDelay(pdMS_TO_TICKS(200));
  }
}

}  // namespace p4r
