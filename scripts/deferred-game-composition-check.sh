#!/usr/bin/env bash
# M2 composition review fix — focused GPU checks (private ports, own servers):
#   LAB_VITE_PORT=5348 LAB_CDP_PORT=9348 scripts/deferred-game-composition-check.sh
# Owns/stops only what it starts (lab-servers.sh ownership rules).
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5348}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9348}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/deferred-game-composition-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
