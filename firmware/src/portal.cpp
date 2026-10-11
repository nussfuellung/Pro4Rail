// Einrichtung: Das Gerät öffnet ein eigenes WLAN-Netz mit einer Webseite. Dort trägt man das Heim-WLAN und den
// Kopplungscode aus der App ein. Das Gerät verbindet sich, koppelt sich und startet neu.
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "app.h"

namespace p4r {

static String esc(const String& s) { String o; for (char c : s) { if (c == '&') o += "&amp;"; else if (c == '<') o += "&lt;"; else if (c == '>') o += "&gt;"; else if (c == '"') o += "&quot;"; else if (c == '\'') o += "&#39;"; else o += c; } return o; }

String claimDevice(const String& base, const String& code, String& tokenOut) {
  JsonDocument b; b["device_uid"] = deviceUid(); b["code"] = code; String body, resp; serializeJson(b, body);
  int status = httpPostJson(base + "/functions/v1/claim-device", body, resp);
  if (status <= 0) return "Keine Verbindung zum Server (" + String(status) + "). Prüfe die Adresse und das WLAN.";
  JsonDocument r; deserializeJson(r, resp);
  if (status == 200 && r["token"].is<const char*>()) { tokenOut = r["token"].as<const char*>(); return ""; }
  const char* e = r["error"] | (const char*)nullptr; return e ? String(e) : "Der Server antwortet mit " + String(status) + ".";
}

static const char PAGE_HEAD[] = R"(<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pro4Rail einrichten</title>
<style>:root{--a:#07727a}body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f4f6f8;color:#14181f}main{max-width:440px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}p{margin:8px 0}.muted{color:#5b6573;font-size:14px}label{display:block;margin:14px 0 4px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #b8c0cc;border-radius:8px;background:#fff}
button{margin-top:20px;width:100%;padding:13px;font-size:16px;font-weight:700;color:#fff;background:var(--a);border:0;border-radius:8px}
.err{background:#fde8e6;color:#8a1c12;padding:10px 12px;border-radius:8px;margin:14px 0}.ok{background:#e3f4ee;color:#0b5a3e;padding:10px 12px;border-radius:8px;margin:14px 0}
details{margin-top:18px}summary{cursor:pointer;color:var(--a)}footer{margin-top:28px;font-size:13px;color:#5b6573}</style><main>)";
static const char PAGE_FOOT[] = R"(<footer>&copy; H-IT Solutions &middot; Pro4Rail Firmware )" P4R_VERSION R"(</footer></main></html>)";

static String formPage(const String& err, const String& ssid, const String& base, const String& datalist) {
  String s = PAGE_HEAD;
  s += "<h1>Pro4Rail einrichten</h1><p class='muted'>Gerät " + deviceUid() + "</p>";
  s += "<p>Wähle dein WLAN und gib den Kopplungscode ein. Den Code erzeugst du in der App unter <b>Geräte</b>, <b>Gerät hinzufügen</b>. Er gilt 15 Minuten.</p>";
  if (err.length()) s += "<div class='err'>" + esc(err) + "</div>";
  s += "<form method='post' action='/save' autocomplete='off'><label for='s'>WLAN</label><input id='s' name='ssid' list='nets' value='" + esc(ssid) + "' required maxlength='32' autocapitalize='none'><datalist id='nets'>" + datalist + "</datalist>";
  s += "<label for='p'>WLAN-Passwort</label><input id='p' name='pass' type='password' maxlength='63'>";
  s += "<label for='c'>Kopplungscode (8 Ziffern)</label><input id='c' name='code' inputmode='numeric' pattern='[0-9]{8}' maxlength='8' required>";
  s += "<details><summary>Erweitert</summary><label for='b'>Adresse des Supabase-Projekts</label><input id='b' name='base' value='" + esc(base) + "' maxlength='100' autocapitalize='none'></details>";
  s += "<button>Verbinden und koppeln</button></form>";
  return s + PAGE_FOOT;
}

bool portalRun(Creds& out) {
  WiFi.mode(WIFI_AP_STA); WiFi.disconnect(true, false);
  const String uid = deviceUid(), apName = "Pro4Rail-Setup-" + uid.substring(uid.length() - 4);
  WiFi.softAP(apName.c_str()); delay(300);
  Serial.printf("[einrichtung] WLAN \"%s\" geöffnet, Seite auf http://%s\n", apName.c_str(), WiFi.softAPIP().toString().c_str());
  String datalist; int n = WiFi.scanNetworks();
  for (int i = 0; i < n && i < 20; i++) datalist += "<option value='" + esc(WiFi.SSID(i)) + "'>";
  DNSServer dns; dns.start(53, "*", WiFi.softAPIP());
  WebServer web(80); bool done = false; String lastErr, lastSsid, base = P4R_SUPABASE_URL;
  auto form = [&] { web.send(200, "text/html; charset=utf-8", formPage(lastErr, lastSsid, base, datalist)); };
  web.on("/", HTTP_GET, form);
  web.on("/save", HTTP_POST, [&] {
    String ssid = web.arg("ssid"), pass = web.arg("pass"), code = web.arg("code"), b = web.arg("base"); b.trim(); ssid.trim(); code.trim();
    if (b.endsWith("/")) b.remove(b.length() - 1);
    lastSsid = ssid; if (b.length()) base = b;
    if (!ssid.length() || ssid.length() > 32) { lastErr = "Bitte ein WLAN angeben."; return form(); }
    bool digits = code.length() == 8; for (char ch : code) if (!isdigit((unsigned char)ch)) digits = false;
    if (!digits) { lastErr = "Der Kopplungscode besteht aus 8 Ziffern."; return form(); }
    if (!base.startsWith("https://") || base.length() > 100) { lastErr = "Die Projektadresse muss mit https:// beginnen."; return form(); }
    WiFi.begin(ssid.c_str(), pass.c_str());
    for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) { delay(500); dns.processNextRequest(); }
    if (WiFi.status() != WL_CONNECTED) { lastErr = "Mit diesem WLAN konnte keine Verbindung hergestellt werden. Prüfe Name und Passwort."; return form(); }
    configTzTime(P4R_TZ, "pool.ntp.org", "time.cloudflare.com");
    for (int i = 0; i < 40 && !netTimeValid(); i++) delay(250);            // Zertifikate lassen sich nur mit richtiger Uhrzeit prüfen
    String token, err = netTimeValid() ? claimDevice(base, code, token) : String("Die Uhrzeit konnte nicht geholt werden. Prüfe die Internetverbindung des WLANs.");
    if (err.length()) { lastErr = err; WiFi.disconnect(false, false); return form(); }
    out.ssid = ssid; out.pass = pass; out.token = token; out.base = base; credsSave(out); done = true;
    web.send(200, "text/html; charset=utf-8", String(PAGE_HEAD) + "<h1>Fertig</h1><div class='ok'>Das Gerät ist gekoppelt und startet jetzt neu. Du kannst es in der App einrichten.</div>" + PAGE_FOOT);
  });
  web.onNotFound([&] { web.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/", true); web.send(302, "text/plain", ""); });   // Anmeldeseite des Telefons öffnet die Einrichtung
  web.begin();
  while (!done) { dns.processNextRequest(); web.handleClient(); delay(2); }
  delay(1500); web.stop(); dns.stop(); WiFi.softAPdisconnect(true); return true;
}

}  // namespace p4r
