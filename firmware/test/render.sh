#!/bin/sh
# Übersetzt die Bildschirm-Painter für den Computer und schreibt PNG-Dateien (braucht g++ und Python mit Pillow).
set -e
D="$(cd "$(dirname "$0")" && pwd)"; L="$D/../libs"; O="${1:-/tmp/p4r-render}"; mkdir -p "$O"
g++ -std=c++17 -O1 -DARDUINO=100 -I"$D/shim" -I"$L/Adafruit_GFX" -I"$L/U8g2_for_Adafruit_GFX/src" \
  "$D/render.cpp" "$D/../src/screens.cpp" "$D/../src/gfx.cpp" "$L/Adafruit_GFX/Adafruit_GFX.cpp" "$L/U8g2_for_Adafruit_GFX/src/U8g2_for_Adafruit_GFX.cpp" \
  -x c "$L/U8g2_for_Adafruit_GFX/src/u8g2_fonts.c" -o "$O/render" 2>&1 | grep -E "error" || true
"$O/render" "$O"
python3 -I - "$O" <<'PY'
import sys, glob
from PIL import Image
for p in glob.glob(sys.argv[1] + '/*.ppm'): Image.open(p).save(p[:-4] + '.png')
PY
