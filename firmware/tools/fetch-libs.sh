#!/bin/sh
# Lädt die Bibliotheken in der festen Version nach firmware/libs (einmalig). PlatformIO findet sie dort.
# Grund: Der Bibliotheksverzeichnis-Dienst von PlatformIO ist nicht überall erreichbar, GitHub schon.
set -e
cd "$(dirname "$0")/.." && mkdir -p libs && cd libs
get() { [ -d "$1" ] || git clone -q --depth 1 --branch "$3" "https://github.com/$2.git" "$1"; }
get ArduinoJson               bblanchon/ArduinoJson               v7.4.3
get Adafruit_GFX              adafruit/Adafruit-GFX-Library       1.12.4
get Adafruit_BusIO            adafruit/Adafruit_BusIO             1.17.4
get Adafruit_ST7735_ST7789    adafruit/Adafruit-ST7735-Library    1.11.0
get Adafruit_ILI9341          adafruit/Adafruit_ILI9341           1.6.4
get U8g2_for_Adafruit_GFX     olikraus/U8g2_for_Adafruit_GFX      1.8.0
get ESP8266Audio              earlephilhower/ESP8266Audio         2.4.2
get JPEGDEC                   bitbank2/JPEGDEC                    1.8.4
get AnimatedGIF               bitbank2/AnimatedGIF                2.2.0
get Adafruit_SSD1306          adafruit/Adafruit_SSD1306           2.5.17
get Adafruit_SH110X           adafruit/Adafruit_SH110X            2.1.15
echo "Bibliotheken bereit."
