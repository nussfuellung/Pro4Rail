// Anschlussbelegung und feste Werte. Muss mit Pro4Rail/pins.js übereinstimmen.
// Änderungen immer an beiden Stellen machen.
#pragma once
#include <Arduino.h>

#ifndef P4R_SUPABASE_URL
#define P4R_SUPABASE_URL "https://uzvhwhzrsaylblkavroe.supabase.co"   // Vorgabe im Einrichtungsfenster, dort änderbar
#endif
#define P4R_VERSION "0.1.3"
#define P4R_TRANSITOUS "https://api.transitous.org"
#define P4R_USER_AGENT "Pro4Rail-Display/" P4R_VERSION " (+https://github.com/nussfuellung/Pro4Rail)"
#define P4R_TZ "CET-1CEST,M3.5.0,M10.5.0/3"     // Mitteleuropäische Zeit mit Sommerzeit
#define P4R_MAX_DISPLAYS 8                      // mit Multiplexer bis zu acht OLEDs. Wie viele TFT möglich sind, ergibt sich aus den freien Pins
#define P4R_BOOT_PIN 0                          // BOOT-Taste: beim Einschalten 5 Sekunden halten löscht WLAN und Kopplung

#if defined(BOARD_S3)
static const int PIN_TFT_SCK = 12, PIN_TFT_MOSI = 11;
static const int TFT_POOL[] = {10, 9, 8, 4, 14, 18, 21, 38, 15, 39, 40, 41, 42, 47, 48};     // wie tftPool in pins.js
static const int PIN_SDA[2] = {1, 16}, PIN_SCL[2] = {2, 17};    // je OLED ein eigener I2C-Bus
static const int PIN_I2S_BCLK = 5, PIN_I2S_LRC = 6, PIN_I2S_DIN = 13;
static const int PIN_LIGHT = 7;
#elif defined(BOARD_ESP32)
static const int PIN_TFT_SCK = 18, PIN_TFT_MOSI = 23;
static const int TFT_POOL[] = {5, 19, 4, 32, 27, 14, 16, 17, 21, 22, 15};     // wie tftPool in pins.js
static const int PIN_SDA[2] = {21, 16}, PIN_SCL[2] = {22, 17};  // je OLED ein eigener I2C-Bus (GPIO16/17: nicht bei WROVER mit PSRAM)
static const int PIN_I2S_BCLK = 26, PIN_I2S_LRC = 25, PIN_I2S_DIN = 33;
static const int PIN_LIGHT = 13;
#else
#error "Board wählen: -DBOARD_S3 oder -DBOARD_ESP32 (siehe platformio.ini)"
#endif
static const uint8_t OLED_ADDR = 0x3C;     // beide OLEDs behalten die Werkseinstellung, jede hängt an einem eigenen Bus
static const int MUX_ADDR_DEFAULT = 0x70;     // TCA9548A, Werkseinstellung
