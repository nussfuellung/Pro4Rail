#!/bin/sh
# Übersetzt und startet die Logik-Tests auf dem Computer (braucht nur g++).
cd "$(dirname "$0")" && g++ -std=c++17 -Wall -Wextra -o /tmp/p4r_logic_test logic_test.cpp && /tmp/p4r_logic_test
