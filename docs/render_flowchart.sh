#!/usr/bin/env bash
# Renders site/flowchart/phone-line-flowchart.svg to a PNG (3840x2160, crisp on a projector) with headless Chrome.
# Chrome writes the PNG and then hangs instead of exiting, so this waits for the file and kills Chrome.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$HERE/../site/flowchart"
SVG="$(cd "$OUT_DIR" && pwd)/phone-line-flowchart.svg"
PNG="${1:-$(cd "$OUT_DIR" && pwd)/phone-line-flowchart.png}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$(mktemp -d)"
rm -f "$PNG"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$PROFILE" \
  --window-size=1920,1080 --force-device-scale-factor=2 --screenshot="$PNG" "file://$SVG" >/dev/null 2>&1 &
PID=$!
for _ in $(seq 1 60); do
  if [ -f "$PNG" ] && [ "$(stat -f%z "$PNG")" -gt 30000 ]; then sleep 0.6; break; fi
  sleep 0.5
done
pkill -9 -P "$PID" 2>/dev/null; kill -9 "$PID" 2>/dev/null
rm -rf "$PROFILE"
[ -f "$PNG" ] && echo "wrote $PNG ($(( $(stat -f%z "$PNG") / 1024 )) KB)" || { echo "render failed"; exit 1; }
