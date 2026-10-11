// Gemeinsame Typen und Funktionen der Pro4Rail-Firmware.
#pragma once
#include <Arduino.h>
#include <memory>
#include <string>
#include <vector>
#include <map>
#include <functional>
#include <ArduinoJson.h>
#include "config.h"
#include "logic.h"

namespace p4r {

// ---------- Konfiguration (so wie sie die App speichert, siehe Pro4Rail/store.js defaultConfig) ----------
struct DisplayCfg {
  int slot = 1; bool oled = false;
  std::string tftModel = "ST7789"; bool landscape = true;
  std::string oledModel = "SSD1306_32", oledRight = "min"; bool oledHeader = true;
  std::string content = "abfahrt";                    // abfahrt, zugziel, uhr, bild
  std::string stationId, stationName, filter, platform;
  int rows = 2, interval = 10;
  std::vector<std::string> imageIds;
};
struct Rule {
  std::string id, name, trigger, mediaId, time;       // trigger: zeit, abfahrt, verspaetung
  bool enabled = true; int slot = 0, minBefore = 2, minDelay = 5; std::vector<int> days;
};
struct Config {
  bool fDisplays = true, fLight = true, fAudio = true;
  std::vector<DisplayCfg> displays;
  bool lightOn = false, dimmable = true, lightInvert = false; int brightness = 100;
  int volume = 60; std::vector<Rule> rules;
  std::string raw;                                    // zum Erkennen von Änderungen
};
typedef std::shared_ptr<const Config> ConfigPtr;
ConfigPtr getConfig();
void setConfigFromJson(JsonVariantConst cfg);         // übernimmt nur bei Änderung
uint32_t configVersion();

// ---------- Fahrplandaten ----------
typedef std::vector<Dep> DepList;
struct DepData { std::shared_ptr<const DepList> deps; uint32_t version = 0; bool ok = false; };
DepData getDepartures(const std::string& stationId);  // letzter Stand, leer wenn noch nichts da
void depRequest(const std::string& stationId, const std::string& stationName, int n = 15);   // n: wie viele Abfahrten (Zugzielanzeiger: 60)   // Station regelmäßig laden
void depInvalidate();                                  // alles neu laden (Befehl "refresh")
void depLoop();                                        // vom Netzwerk-Task aufgerufen

// ---------- Netz ----------
bool netTimeValid();
enum class HttpMode { Small, Stream10, Raw };
int httpGet(const String& url, const char* bearer, const std::function<bool(Stream&, int)>& onBody, HttpMode mode = HttpMode::Small);
int httpPostJson(const String& url, const String& body, String& response);
extern SemaphoreHandle_t g_httpMx;

// ---------- Medien ----------
bool mediaEnsure(const std::string& id, std::string& pathOut);   // lädt bei Bedarf in den Speicher, true wenn lokal vorhanden
bool mediaLocal(const std::string& id, std::string& pathOut);    // nur nachsehen
void mediaCleanup(const std::vector<std::string>& keep);

// ---------- Ausgabe ----------
void lightInit(bool dimmable, bool invert); void lightSet(bool on, int brightness, bool dimmable, bool invert); void lightState(bool& on, int& brightness);
void audioInit(); void audioPlayMedia(const std::string& mediaId, int volume); void audioSetVolume(int v); bool audioBusy();
void displaysInit(); void displaysLoop(); bool displayStation(int slot, std::string& id, std::string& filter);

// ---------- Cloud ----------
struct Creds { String ssid, pass, token, base; };
bool credsLoad(Creds& c); void credsSave(const Creds& c); void credsClear();
String deviceUid();
void cloudTask(void*);                                // Netzwerk-Task: Verbindung, Abfragen, Befehle, Regeln
bool portalRun(Creds& c);                             // Einrichtung über WLAN-Netz des Geräts, blockiert bis gekoppelt
String claimDevice(const String& base, const String& code, String& tokenOut);   // "" bei Erfolg, sonst Fehlertext

}  // namespace p4r
