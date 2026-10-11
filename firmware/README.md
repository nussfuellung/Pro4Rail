# Pro4Rail Firmware (ESP32-S3 und ESP32)

Eine Firmware für beide Chips. Sie koppelt sich mit der App, holt die Einstellungen alle 5 Sekunden und setzt sie um:
TFT-Anzeigen (ST7789, ILI9341, ST7735), OLED-Textanzeigen (SSD1306, SH1106), Licht (Relais oder PWM), MP3-Ansagen (MAX98357A).
Die Anschlussbelegung steht in `src/config.h` und muss mit `Pro4Rail/pins.js` übereinstimmen.

**Stand:** Sie kompiliert für beide Chips, die reine Logik und alle Bildschirm-Layouts sind auf dem Computer getestet.
Auf echter Hardware ist sie noch nicht gelaufen. Rechne mit Feinschliff bei Anzeigen (Ausrichtung, Farbreihenfolge) und Audio.

## Einrichten eines Geräts
1. Firmware über den Installer in der App aufspielen (oder `pio run -t upload`).
2. Das Gerät öffnet das WLAN **Pro4Rail-Setup-XXXX**. Damit verbinden, die Seite öffnet sich selbst (sonst `192.168.4.1`).
3. WLAN wählen, Passwort und den Kopplungscode aus der App eintragen (Geräte, Gerät hinzufügen).
4. Das Gerät koppelt sich, startet neu und lädt die Einstellungen.
BOOT-Taste beim Einschalten 5 Sekunden halten: löscht WLAN und Kopplung.

## Bauen
Voraussetzung: PlatformIO. Einmalig `./tools/fetch-libs.sh` (lädt die Bibliotheken in fester Version nach `libs/`).
- `pio run -e esp32s3` und `pio run -e esp32`
- Eine Datei zum Aufspielen ab Adresse 0 liefert jeweils `.pio/build/<env>/firmware.factory.bin`. Sie gehört nach `Pro4Rail/install/firmware.bin` (S3) beziehungsweise `firmware-esp32.bin`.
- Tests ohne Hardware: `./test/run.sh` (Logik), `./test/render.sh` (zeichnet alle Bildschirme in PNG-Dateien).

## Aufbau
`logic.h` (reine Logik) · `screens.cpp` (Layouts nach `tft.js`/`oled.js`) · `gfx.cpp` (Zeichenfläche, Schrift, Laufschrift) ·
`displays.cpp` (Treiber, Bilder, GIFs) · `departures.cpp` (Transitous) · `cloud.cpp` (Abfragen, Befehle, Regeln) ·
`portal.cpp` (Einrichtung) · `media.cpp` (Zwischenspeicher) · `audio.cpp` · `light.cpp`.

## Bekannte Grenzen
- Sprachausgabe fehlt: „Automatische Ansage“ spielt einen Gong statt gesprochenen Text. MP3-Ansagen funktionieren.
- Bilder: JPEG und GIF. GIFs mit Transparenz und „Hintergrund wiederherstellen“ können Reste zeigen. Ein normaler ESP32 hat im Flash nur etwa 1,5 MB für Bilder und MP3.
- Licht: Relais (An und Aus, auch mit LOW-Trigger) oder MOSFET (PWM). Kein WS2812.
- TFT: Ausrichtung und Farben hängen vom Modul ab. ST7735 ist für das häufige „Black Tab“-Modul eingestellt.
- Zwischenhalte im Zugzielanzeiger erscheinen nur, wenn Transitous sie liefert.
- Kein Update über WLAN, neue Firmware kommt über den Installer.
