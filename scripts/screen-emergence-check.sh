#!/usr/bin/env bash
# Headless check for the screen emergence lab (/sdf-screen-lab.html): the WGSL compile check (nothing in node compiles WGSL), one key frame
# per shot, a labelled sheet beside the old animatic's key frames, and the frame cost with the pass off / on / on with the goo shadow.
# Owns its own vite + Chrome on its own ports and stops only what it started. NEVER touches 5173 (the owner's dev server).
# Usage: bash scripts/screen-emergence-check.sh [OUT]       (OUT defaults to $LAB_TMP/screen-emergence)
#        LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 LAB_TMP=.lab-tmp (the defaults)
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5244}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9244}"
export LAB_TMP="${LAB_TMP:-.lab-tmp}"
OUT="${1:-$LAB_TMP/screen-emergence}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/screen-emergence-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT"
