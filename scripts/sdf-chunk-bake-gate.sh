#!/usr/bin/env bash
# Headless gates for the settled-chunk bake (close-up task 5).
#   scripts/sdf-chunk-bake-gate.sh            — self gates (no vs-main leg)
#   WITH_MAIN=1 scripts/sdf-chunk-bake-gate.sh — + vs-main parity leg
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5377}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9377}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
MAIN_ARG=""
if [ "${WITH_MAIN:-0}" = "1" ]; then
  MAIN_PORT=$((LAB_VITE_PORT + 1))
  MAIN_ARG="$MAIN_PORT"
fi
node scripts/sdf-chunk-bake-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" $MAIN_ARG
