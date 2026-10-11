// Minimale Nachbildung von Arduino.h, damit Adafruit_GFX und U8g2_for_Adafruit_GFX auf dem Computer übersetzt werden können.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <math.h>
#include <algorithm>
#define PROGMEM
#define PGM_P const char*
#define PSTR(s) (s)
#define pgm_read_byte(a) (*(const uint8_t*)(a))
#define pgm_read_word(a) (*(const uint16_t*)(a))
#define pgm_read_dword(a) (*(const uint32_t*)(a))
#define pgm_read_pointer(a) (*(void* const*)(a))
using std::min; using std::max;
typedef bool boolean; typedef uint8_t byte;
class __FlashStringHelper;
#include <string>
class String { std::string s_; public: String(const char* c = "") : s_(c) {} unsigned length() const { return (unsigned)s_.size(); } const char* c_str() const { return s_.c_str(); } };
#include "Print.h"
