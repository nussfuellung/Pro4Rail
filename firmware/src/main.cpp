// Pro4Rail Firmware für ESP32-S3 und ESP32 (WROOM). Ablauf: Einrichtung beim ersten Start, danach Anzeigen, Licht und Ansagen
// nach den Einstellungen aus der App. Netzwerk und Ton laufen in eigenen Tasks, die Anzeigen in der Hauptschleife.
#include <Arduino.h>
#include <LittleFS.h>
#include "app.h"

namespace p4r { void configRestore(); }
using namespace p4r;

static bool bootHeld() {                       // BOOT-Taste beim Einschalten 5 Sekunden halten: Einstellungen löschen
  pinMode(P4R_BOOT_PIN, INPUT_PULLUP); if (digitalRead(P4R_BOOT_PIN) != LOW) return false;
  Serial.println("[start] BOOT gedrückt, 5 Sekunden halten zum Zurücksetzen ...");
  for (int i = 0; i < 50; i++) { delay(100); if (digitalRead(P4R_BOOT_PIN) != LOW) return false; }
  return true;
}

void setup() {
  Serial.begin(115200); delay(200);
  Serial.printf("\nPro4Rail Firmware %s, Gerät %s\n", P4R_VERSION, deviceUid().c_str());
  if (!LittleFS.begin(true)) Serial.println("[start] Dateispeicher nicht verfügbar");
  LittleFS.mkdir("/m");
  if (bootHeld()) { credsClear(); LittleFS.remove("/cfg.json"); Serial.println("[start] Zurückgesetzt"); }
  Creds c;
  if (!credsLoad(c)) { portalRun(c); delay(500); ESP.restart(); }
  configRestore();                          // zuerst die gespeicherten Einstellungen, damit ein Relais mit LOW-Trigger beim Start nicht kurz schaltet
  { ConfigPtr r = getConfig(); lightInit(r->dimmable, r->lightInvert); }
  displaysInit(); audioInit();
  xTaskCreatePinnedToCore(cloudTask, "cloud", 16384, nullptr, 1, nullptr, 0);
}

void loop() {
  static uint32_t seen = 0xFFFFFFFF;
  if (configVersion() != seen) {                       // Einstellungen haben sich geändert
    seen = configVersion(); ConfigPtr c = getConfig();
    lightSet(c->fLight && c->lightOn, c->brightness, c->dimmable, c->lightInvert); audioSetVolume(c->volume);
  }
  displaysLoop();
  delay(5);
}
