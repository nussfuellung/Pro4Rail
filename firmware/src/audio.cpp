// MP3-Ansagen über einen MAX98357A (I2S). Die Datei wird zuerst im Flash zwischengespeichert, dann abgespielt.
#include <LittleFS.h>
#include <AudioFileSourceFS.h>
#include <AudioGeneratorMP3.h>
#include <AudioOutputI2S.h>
#include "app.h"

namespace p4r {

struct Job { char id[40]; int vol; };
static QueueHandle_t q; static volatile bool busy = false; static volatile int volume = 60;

void audioSetVolume(int v) { volume = v < 0 ? 0 : v > 100 ? 100 : v; }
bool audioBusy() { return busy; }
void audioPlayMedia(const std::string& id, int vol) {
  if (!q) return; Job j{}; strncpy(j.id, id.c_str(), sizeof j.id - 1); j.vol = vol;
  if (xQueueSend(q, &j, 0) != pdTRUE) Serial.println("[audio] Warteschlange voll, Ansage verworfen");
}

// Zwei Töne als Gong, wenn "automatische Ansage" gewählt ist (Sprachausgabe gibt es in dieser Version nicht).
static void chime(AudioOutputI2S& out, float gain) {
  out.SetGain(gain); out.SetRate(22050); out.SetChannels(1); out.begin();
  const float notes[2] = {880.f, 659.f}; const int len[2] = {5500, 9000};
  for (int n = 0; n < 2; n++) for (int i = 0; i < len[n]; i++) {
    float env = expf(-3.5f * i / len[n]); int16_t v = (int16_t)(12000 * env * sinf(2 * PI * notes[n] * i / 22050.f)); int16_t s[2] = {v, v};
    while (!out.ConsumeSample(s)) vTaskDelay(1);
  }
  out.stop();
}

static void audioTask(void*) {
  AudioOutputI2S out; out.SetPinout(PIN_I2S_BCLK, PIN_I2S_LRC, PIN_I2S_DIN); out.SetOutputModeMono(true);
  for (;;) {
    Job j; if (xQueueReceive(q, &j, portMAX_DELAY) != pdTRUE) continue;
    busy = true; const float gain = (j.vol >= 0 ? j.vol : volume) / 100.f * 0.9f;
    std::string id = j.id, path;
    if (id == "auto") chime(out, gain);
    else if (mediaEnsure(id, path)) {
      out.SetGain(gain);
      AudioFileSourceFS src(LittleFS, path.c_str()); AudioGeneratorMP3 mp3;
      if (mp3.begin(&src, &out)) { while (mp3.isRunning()) { if (!mp3.loop()) { mp3.stop(); break; } vTaskDelay(0); } }
      else Serial.printf("[audio] %s lässt sich nicht abspielen\n", id.c_str());
      out.stop();
    } else Serial.printf("[audio] %s nicht verfügbar\n", id.c_str());
    busy = false;
  }
}
void audioInit() { q = xQueueCreate(4, sizeof(Job)); xTaskCreatePinnedToCore(audioTask, "audio", 8192, nullptr, 3, nullptr, 0); }

}  // namespace p4r
