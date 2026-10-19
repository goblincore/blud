#!/usr/bin/env bash
# Headless check for the egg emerging in the Flat (/sdf-game.html?level=flat-early&emergence=1, 320 x 240): ONE boot, one headless Chrome, no loops.
# Owns its own vite + Chrome on its own ports and stops only what it started. NEVER touches 5173 (the owner's dev server).
# Usage: bash scripts/flat-emergence-check.sh [OUT]       (OUT defaults to $LAB_TMP/flat-emergence)
#        LAB_VITE_PORT=5246 LAB_CDP_PORT=9246 LAB_TMP=.lab-tmp (the defaults)
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5246}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9246}"
export LAB_TMP="${LAB_TMP:-.lab-tmp}"
OUT="${1:-$LAB_TMP/flat-emergence}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/flat-emergence-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT"
