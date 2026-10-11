// Bilder, GIFs und MP3 aus dem privaten Speicher holen und im Flash zwischenspeichern (Dateiname = Medien-ID).
// Die Adresse kommt von der Edge Function device-media und gilt nur 5 Minuten.
#include <WiFi.h>
#include <LittleFS.h>
#include "app.h"

namespace p4r {

static String pathFor(const std::string& id) { return "/m/" + String(id.c_str()); }
static bool validId(const std::string& id) { if (id.size() != 36) return false; for (char c : id) if (!(isxdigit((unsigned char)c) || c == '-')) return false; return true; }

bool mediaLocal(const std::string& id, std::string& out) {
  if (!validId(id)) return false;
  String p = pathFor(id); if (!LittleFS.exists(p)) return false;
  out = p.c_str(); return true;
}

// Älteste Dateien löschen, bis need Bytes frei sind. keep: Dateien, die gerade gebraucht werden.
static bool makeRoom(size_t need, const std::string& keepId) {
  auto free_ = [] { return LittleFS.totalBytes() - LittleFS.usedBytes(); };
  while (free_() < need + 8192) {
    File d = LittleFS.open("/m"); if (!d) return false;
    String victim; time_t oldest = 0x7fffffff;
    for (File f = d.openNextFile(); f; f = d.openNextFile()) {
      String n = f.name(); if (n == keepId.c_str()) continue;
      time_t t = f.getLastWrite(); if (victim.isEmpty() || t < oldest) { victim = n; oldest = t; }
    }
    d.close(); if (victim.isEmpty()) return false;
    LittleFS.remove("/m/" + victim); Serial.printf("[media] Platz geschaffen: %s gelöscht\n", victim.c_str());
  }
  return true;
}

bool mediaEnsure(const std::string& id, std::string& out) {
  if (mediaLocal(id, out)) return true;
  if (!validId(id) || WiFi.status() != WL_CONNECTED || !netTimeValid()) return false;
  Creds c; if (!credsLoad(c)) return false;
  String url = c.base + "/functions/v1/device-media?id=" + id.c_str();
  JsonDocument meta;
  int code = httpGet(url, c.token.c_str(), [&](Stream& s, int) { return !deserializeJson(meta, s); });
  if (code != 200) { Serial.printf("[media] %s: Adresse nicht erhalten (HTTP %d)\n", id.c_str(), code); return false; }
  String dl = meta["url"] | ""; size_t size = meta["size"] | 0;
  if (!dl.length()) return false;
  if (size > LittleFS.totalBytes() - 16384) { Serial.printf("[media] %s: %u Bytes passen nicht in den Speicher\n", id.c_str(), (unsigned)size); return false; }
  if (!makeRoom(size, id)) return false;
  String tmp = "/m/.tmp"; File f = LittleFS.open(tmp, "w"); if (!f) return false;
  size_t got = 0; bool full = false;
  code = httpGet(dl, nullptr, [&](Stream& s, int len) {
    uint8_t buf[1024]; uint32_t last = millis();
    while (millis() - last < 10000 && (len < 0 || got < (size_t)len)) {
      int n = s.readBytes(buf, sizeof buf); if (n <= 0) { if (len < 0) break; delay(5); continue; }
      if (f.write(buf, n) != (size_t)n) return false;
      got += n; last = millis(); if (len > 0 && got >= (size_t)len) break;
    }
    full = (len > 0) ? got == (size_t)len : got > 0; return full;
  }, HttpMode::Raw);
  f.close();
  if (code != 200 || !full || (size && got != size)) { LittleFS.remove(tmp); Serial.printf("[media] %s: Download unvollständig (%u von %u, HTTP %d)\n", id.c_str(), (unsigned)got, (unsigned)size, code); return false; }
  LittleFS.rename(tmp, pathFor(id)); out = pathFor(id).c_str();
  Serial.printf("[media] %s gespeichert (%u Bytes)\n", id.c_str(), (unsigned)got); return true;
}

void mediaCleanup(const std::vector<std::string>& keep) {
  File d = LittleFS.open("/m"); if (!d) return; std::vector<String> del;
  for (File f = d.openNextFile(); f; f = d.openNextFile()) {
    String n = f.name(); bool k = false; for (auto& id : keep) if (n == id.c_str()) k = true;
    if (!k) del.push_back(n);
  }
  d.close(); for (auto& n : del) { LittleFS.remove("/m/" + n); Serial.printf("[media] nicht mehr gebraucht: %s\n", n.c_str()); }
}

}  // namespace p4r
