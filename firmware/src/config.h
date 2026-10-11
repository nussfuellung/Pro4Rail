// Anschlussbelegung und feste Werte. Muss mit Pro4Rail/pins.js übereinstimmen.
// Änderungen immer an beiden Stellen machen.
#pragma once
#include <Arduino.h>

#ifndef P4R_SUPABASE_URL
#define P4R_SUPABASE_URL "https://uzvhwhzrsaylblkavroe.supabase.co"   // Vorgabe im Einrichtungsfenster, dort änderbar
#endif
#define P4R_VERSION "0.1.0"
#define P4R_TRANSITOUS "https://api.transitous.org"
#define P4R_USER_AGENT "Pro4Rail-Display/" P4R_VERSION " (+https://github.com/nussfuellung/Pro4Rail)"
#define P4R_TZ "CET-1CEST,M3.5.0,M10.5.0/3"     // Mitteleuropäische Zeit mit Sommerzeit
#define P4R_MAX_DISPLAYS 3
#define P4R_BOOT_PIN 0                          // BOOT-Taste: beim Einschalten 5 Sekunden halten löscht WLAN und Kopplung

#if defined(BOARD_S3)
static const int PIN_TFT_SCK = 12, PIN_TFT_MOSI = 11, PIN_TFT_DC = 9, PIN_TFT_RST = 8, PIN_TFT_BL = 4;
static const int PIN_TFT_CS[P4R_MAX_DISPLAYS] = {10, 14, 15};
static const int PIN_SDA = 1, PIN_SCL = 2;
static const int PIN_I2S_BCLK = 5, PIN_I2S_LRC = 6, PIN_I2S_DIN = 13;
static const int PIN_LIGHT = 7;
static const int MAX_DISPLAYS = 3;
#elif defined(BOARD_ESP32)
static const int PIN_TFT_SCK = 18, PIN_TFT_MOSI = 23, PIN_TFT_DC = 19, PIN_TFT_RST = 4, PIN_TFT_BL = 32;
static const int PIN_TFT_CS[P4R_MAX_DISPLAYS] = {5, 27, -1};
static const int PIN_SDA = 21, PIN_SCL = 22;
static const int PIN_I2S_BCLK = 26, PIN_I2S_LRC = 25, PIN_I2S_DIN = 33;
static const int PIN_LIGHT = 13;
static const int MAX_DISPLAYS = 2;
#else
#error "Board wählen: -DBOARD_S3 oder -DBOARD_ESP32 (siehe platformio.ini)"
#endif
static const uint8_t OLED_ADDR[2] = {0x3C, 0x3D};
