// Abfahrten von Transitous holen (wie Pro4Rail/transport.js). Die Antwort wird als Strom gelesen und gefiltert,
// damit sie auch auf einem normalen ESP32 in den Speicher passt.
#include "app.h"

namespace p4r {

struct Entry {
  std::string name, resolved; uint32_t lastTry = 0, wanted = 0, version = 0; int n = 15; bool ok = false, tried = false;
  std::shared_ptr<const DepList> deps;
};
static std::map<std::string, Entry> E;
static SemaphoreHandle_t mx = xSemaphoreCreateMutex();
static bool invalidated = false;
static const uint32_t REFRESH_MS = 30000, RETRY_MS = 15000, DROP_MS = 120000;

static String urlEnc(const std::string& s) {
  String o; char b[4];
  for (unsigned char c : s) { if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') o += (char)c; else { snprintf(b, sizeof b, "%%%02X", c); o += b; } }
  return o;
}

DepData getDepartures(const std::string& id) {
  DepData d; xSemaphoreTake(mx, portMAX_DELAY);
  auto it = E.find(id); if (it != E.end()) { d.deps = it->second.deps; d.version = it->second.version; d.ok = it->second.ok; }
  xSemaphoreGive(mx); return d;
}
void depRequest(const std::string& id, const std::string& name, int n) {
  if (id.empty()) return;
  xSemaphoreTake(mx, portMAX_DELAY); Entry& e = E[id]; if (!name.empty()) e.name = name; e.wanted = millis();
  if (n > e.n) { e.n = n; e.tried = false; }          // mehr Abfahrten gewünscht (Zugzielanzeiger): neu laden
  xSemaphoreGive(mx);
}
void depInvalidate() { invalidated = true; }

// Ältere Geräte haben noch Bahnhofsnummern wie 8000105 gespeichert: über den Namen neu auflösen.
static bool resolve(Entry& e, const std::string& id) {
  bool numeric = id.size() >= 5 && id.size() <= 8 && std::all_of(id.begin(), id.end(), ::isdigit);
  if (!numeric) { e.resolved = id; return true; }
  if (!e.resolved.empty()) return true;
  String url = String(P4R_TRANSITOUS) + "/api/v1/geocode?text=" + urlEnc(e.name) + "&type=STOP&language=de";
  JsonDocument doc;
  int code = httpGet(url, nullptr, [&](Stream& s, int) { return !deserializeJson(doc, s); });
  if (code != 200) return false;
  for (JsonVariant x : doc.as<JsonArray>()) { const char* t = x["type"] | "STOP"; if (x["id"].is<const char*>() && !strcmp(t, "STOP")) { e.resolved = x["id"].as<const char*>(); return true; } }
  return false;
}

static bool fetch(const std::string& stopId, int n, DepList& out) {
  String url = String(P4R_TRANSITOUS) + "/api/v6/stoptimes?stopId=" + urlEnc(stopId) + "&n=" + n;
  JsonDocument filter;
  JsonObject f = filter["stopTimes"][0].to<JsonObject>();
  f["place"]["scheduledDeparture"] = true; f["place"]["departure"] = true; f["place"]["track"] = true; f["place"]["scheduledTrack"] = true;
  f["displayName"] = true; f["routeShortName"] = true; f["tripShortName"] = true; f["headsign"] = true; f["tripTo"]["name"] = true;
  f["realTime"] = true; f["cancelled"] = true; f["tripCancelled"] = true;
  f["nextStops"][0]["name"] = true; f["nextStops"][0]["stop"]["name"] = true;       // Zwischenhalte, falls die Schnittstelle sie liefert
  JsonDocument doc;
  int code = httpGet(url, nullptr, [&](Stream& s, int) { return !deserializeJson(doc, s, DeserializationOption::Filter(filter)); }, HttpMode::Stream10);
  if (code != 200) { Serial.printf("[dep] %s: HTTP %d\n", stopId.c_str(), code); return false; }
  for (JsonVariant st : doc["stopTimes"].as<JsonArray>()) {
    const char* sp = st["place"]["scheduledDeparture"] | (const char*)nullptr; const char* ac = st["place"]["departure"] | (const char*)nullptr;
    const char* planned = sp ? sp : ac; if (!planned) continue;                   // nur Ankunft, keine Abfahrt
    Dep d; d.planned = parseIso(planned); d.when = parseIso(ac ? ac : planned);
    if (!d.planned) continue;
    d.hasDelay = st["realTime"].isNull() || st["realTime"].as<bool>();
    d.delay = d.hasDelay ? delayMinutes(d.when, d.planned) : 0;
    const char* line = st["displayName"] | (const char*)nullptr; if (!line) line = st["routeShortName"] | (const char*)nullptr; if (!line) line = st["tripShortName"] | "?";
    d.line = line;
    const char* dir = st["headsign"] | (const char*)nullptr; if (!dir) dir = st["tripTo"]["name"] | "";
    d.dir = dir;
    const char* tr = st["place"]["track"] | (const char*)nullptr; if (!tr) tr = st["place"]["scheduledTrack"] | "";
    d.platform = tr;
    d.cancelled = (st["cancelled"] | false) || (st["tripCancelled"] | false);
    for (JsonVariant n : st["nextStops"].as<JsonArray>()) { const char* nm = n["name"] | (const char*)nullptr; if (!nm) nm = n["stop"]["name"] | (const char*)nullptr; if (nm && d.via.size() < 6) d.via.push_back(nm); }
    out.push_back(std::move(d));
  }
  std::stable_sort(out.begin(), out.end(), [](const Dep& a, const Dep& b) { return a.when < b.when; });
  return true;
}

// Pro Aufruf höchstens eine Abfrage, damit der Netzwerk-Task zwischendurch Befehle abholen kann.
void depLoop() {
  uint32_t now = millis(); std::string pick; std::string name;
  xSemaphoreTake(mx, portMAX_DELAY);
  for (auto it = E.begin(); it != E.end();) { if (now - it->second.wanted > DROP_MS) it = E.erase(it); else ++it; }
  if (invalidated) { for (auto& kv : E) { kv.second.tried = false; kv.second.lastTry = 0; } invalidated = false; }
  for (auto& kv : E) {
    Entry& e = kv.second; uint32_t wait = e.ok ? REFRESH_MS : RETRY_MS;
    if (!e.tried || now - e.lastTry >= wait) { pick = kv.first; name = e.name; e.tried = true; e.lastTry = now; break; }
  }
  xSemaphoreGive(mx);
  if (pick.empty()) return;
  Entry tmp; xSemaphoreTake(mx, portMAX_DELAY); tmp = E[pick]; xSemaphoreGive(mx);
  DepList list; bool ok = resolve(tmp, pick) && fetch(tmp.resolved, tmp.n, list);
  xSemaphoreTake(mx, portMAX_DELAY);
  auto it = E.find(pick);
  if (it != E.end()) {
    it->second.resolved = tmp.resolved;
    if (ok) { it->second.deps = std::make_shared<const DepList>(std::move(list)); it->second.ok = true; it->second.version++; }
    else if (!it->second.ok) it->second.ok = false;       // alte Daten bleiben stehen, bis neue kommen
  }
  xSemaphoreGive(mx);
}

}  // namespace p4r
