#!/usr/bin/env bash
# Wound pass r2 task 8 gate: the wound tuning panel drives the shader and
# COPY round-trips. See scripts/wound-panel-verify.mjs for what is asserted.
set -euo pipefail
OUT="${1:-/tmp/wound-panel-verify}"
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
LOOK_OUT="$OUT" node scripts/wound-panel-verify.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
echo "shots: $OUT/panel-open.png $OUT/wound-fat-default.png $OUT/wound-fat-deep.png $OUT/after-rebuild.png"
