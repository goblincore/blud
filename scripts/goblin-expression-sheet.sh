#!/usr/bin/env bash
# A contact sheet of the CINEMATIC goblin's expressions (goblin-cinematic: the goblin with the face rig, Task 13; the base goblin
# has no expressions): front and three-quarter, one blob:shot per expression, plus a blink frame, with its kit on. That kit has
# BARE EYES (no sunglasses), so the kit-on row already shows the painted eyes and brows; the kit-hidden row (NOKIT=1) only takes
# the armour collar out of the frame and is off by default (before Task 13 it was the only way to see the eyes).
#   scripts/goblin-expression-sheet.sh [outDir]
#   LAB_VITE_PORT=5291 LAB_CDP_PORT=9291 scripts/goblin-expression-sheet.sh
#   LAB_TMP=/some/scratch scripts/goblin-expression-sheet.sh      # Chrome profile and server logs elsewhere (sandboxes)
#   NOKIT=1 scripts/goblin-expression-sheet.sh                     # add the kit-hidden row (twice the time)
#   CHARACTER=goblin-home scripts/goblin-expression-sheet.sh       # another character with expressions (expression-library.ts)
# Frame 00 of each run is the front (yaw 0 is the face), frame 01 is 45 degrees. Writes <outDir>/index.html listing them.
# Framing defaults to a face close-up (the camera 0.3 m from the mouth line); override with BLOB_DIST / BLOB_TARGET_Y / BLOB_PITCH,
# e.g. BLOB_DIST=0.7 BLOB_TARGET_Y=1.2 for the whole head and shoulders.
# Each shot is its own blob:shot run (a Vite + Chrome boot each, about 20 s apiece); never point it at the owner's 5173.
set -euo pipefail
cd "$(dirname "$0")/.."
CHARACTER="${CHARACTER:-goblin-cinematic}"
OUT="${1:-docs/dev-notes/2026-10-13-goblin-expressions/frames}"
mkdir -p "$OUT"
export BLOB_DIST="${BLOB_DIST:-0.3}" BLOB_TARGET_Y="${BLOB_TARGET_Y:-1.14}" BLOB_PITCH="${BLOB_PITCH:-0.05}"
# The kit is the only skinned mesh group in the lab scene; hiding it is a capture-time probe, nothing in the lab changes.
HIDE_KIT='window.__sdfLab.scene.children.filter(c => { let sk = 0; c.traverse(o => { if (o.isSkinnedMesh) sk++; }); return sk > 0; }).map(c => (c.visible = false, c.children.length))'
# label:BLOB_EXPR (name[:t[:lid]]); blink is the neutral held fully formed with the lid shut.
SHOTS=("neutral:neutral" "grin:grin" "scowl:scowl" "shout:shout" "blink:neutral:10:1")
SUFFIXES=("")
if [ "${NOKIT:-0}" = 1 ]; then SUFFIXES+=("-nokit"); fi
shoot() { # <dir> <expr> [probe]
  if [ -n "${3:-}" ]; then BLOB_PROBE="$3" BLOB_EXPR="$2" scripts/blob-shot.sh "$CHARACTER" "$1" 8
  else BLOB_EXPR="$2" scripts/blob-shot.sh "$CHARACTER" "$1" 8; fi
  # keep only the front and the three-quarter
  find "$1" -type f ! -name 'frame-00.png' ! -name 'frame-01.png' -delete
}
for spec in "${SHOTS[@]}"; do
  label="${spec%%:*}"; expr="${spec#*:}"
  shoot "$OUT/$label" "$expr"
  if [ "${NOKIT:-0}" = 1 ]; then shoot "$OUT/$label-nokit" "$expr" "$HIDE_KIT"; fi
done
{
  echo '<!doctype html><meta charset="utf-8"><title>$CHARACTER expressions</title><body style="background:#111;color:#ddd;font:14px sans-serif">'
  echo "<p>BLOB_DIST=$BLOB_DIST BLOB_TARGET_Y=$BLOB_TARGET_Y BLOB_PITCH=$BLOB_PITCH; left: front, right: 45 degrees</p>"
  for spec in "${SHOTS[@]}"; do
    label="${spec%%:*}"
    for sfx in "${SUFFIXES[@]}"; do
      echo "<h3>$label$sfx</h3><img src=\"$label$sfx/frame-00.png\" width=480> <img src=\"$label$sfx/frame-01.png\" width=480>"
    done
  done
} > "$OUT/index.html"
echo "sheet: $OUT/index.html"
