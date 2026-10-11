// HTTPS mit Prüfung des Zertifikats (eingebaute Stammzertifikate). Nie unsicher.
#include <WiFi.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <StreamString.h>
#include "app.h"

namespace p4r {

SemaphoreHandle_t g_httpMx = xSemaphoreCreateMutex();   // Es läuft immer nur eine TLS-Verbindung (Speicher)

bool netTimeValid() { return time(nullptr) > 1700000000; }   // Zertifikate lassen sich nur mit richtiger Uhrzeit prüfen

struct Lock { Lock() { xSemaphoreTake(g_httpMx, portMAX_DELAY); } ~Lock() { xSemaphoreGive(g_httpMx); } };

// onBody bekommt den Antwortstrom und die Länge (-1 wenn unbekannt).
// Small: kleine Antwort, wird komplett gelesen (auch bei Teilstücken/chunked). Stream10: große JSON-Antwort als Strom, dafür HTTP/1.0 (keine Teilstücke).
// Raw: Dateidownload als Strom mit fester Länge.
int httpGet(const String& url, const char* bearer, const std::function<bool(Stream&, int)>& onBody, HttpMode mode) {
  if (!url.startsWith("https://")) return -1;
  Lock l; NetworkClientSecure client; client.useBuiltinCACertBundle(); client.setTimeout(15);
  HTTPClient http; http.setTimeout(15000); http.setUserAgent(P4R_USER_AGENT); http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (mode == HttpMode::Stream10) http.useHTTP10(true);
  if (!http.begin(client, url)) return -2;
  if (bearer) http.addHeader("Authorization", String("Bearer ") + bearer);
  http.addHeader("Accept", "application/json, */*");
  int code = http.GET();
  if (code == 200 && onBody) {
    if (mode == HttpMode::Small) { StreamString body; body.print(http.getString()); if (!onBody(body, body.length())) code = -3; }
    else if (!onBody(http.getStream(), http.getSize())) code = -3;
  }
  http.end(); return code;
}

int httpPostJson(const String& url, const String& body, String& response) {
  if (!url.startsWith("https://")) return -1;
  Lock l; NetworkClientSecure client; client.useBuiltinCACertBundle(); client.setTimeout(15);
  HTTPClient http; http.setTimeout(15000); http.setUserAgent(P4R_USER_AGENT);
  if (!http.begin(client, url)) return -2;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body); response = code > 0 ? http.getString() : String();
  http.end(); return code;
}

}  // namespace p4r
