// Beleuchtung: Relais (nur An und Aus, auch mit LOW-Trigger) oder MOSFET-Modul (dimmbar per PWM). WS2812-Streifen werden nicht angesteuert.
#include "app.h"

namespace p4r {
static bool gOn = false, gDim = true, gInv = false, pwmOn = false;

// Pin in den Zustand "Licht aus" bringen. Beim Relais mit LOW-Trigger ist das HIGH. Deshalb liest main() zuerst die gespeicherten Einstellungen.
static void setMode(bool dimmable) {
  if (dimmable == pwmOn) return;
  if (dimmable) pwmOn = ledcAttach(PIN_LIGHT, 5000, 8); else { if (pwmOn) ledcDetach(PIN_LIGHT); pwmOn = false; pinMode(PIN_LIGHT, OUTPUT); }
}
void lightInit(bool dimmable, bool invert) { gDim = dimmable; gInv = invert; pinMode(PIN_LIGHT, OUTPUT); digitalWrite(PIN_LIGHT, invert && !dimmable ? HIGH : LOW); if (dimmable) setMode(true); }
void lightSet(bool on, int br, bool dimmable, bool invert) {
  gOn = on; gDim = dimmable; gInv = invert; br = br < 0 ? 0 : br > 100 ? 100 : br; setMode(dimmable);
  if (!dimmable) { digitalWrite(PIN_LIGHT, (on != invert) ? HIGH : LOW); return; }      // Relais: An bedeutet HIGH, mit LOW-Trigger umgekehrt
  int duty = 0;
  if (on) { if (br >= 100) duty = 255; else { double x = br / 100.0; duty = (int)(255 * x * x + .5); if (duty < 1 && br > 0) duty = 1; } }   // Gamma 2, so wirkt die Helligkeit gleichmäßiger
  ledcWrite(PIN_LIGHT, duty);
}
void lightState(bool& on, int& br) { on = gOn; br = 100; }
}  // namespace p4r
