#!/usr/bin/env bash
# Headless gates for sdf-game.html. Owns its own vite + Chrome via the shared
# lifecycle (scripts/lab-servers.sh); override ports to coexist with other
# dispatches (crowd-alive is perf-measuring next door — keep captures short).
#
#   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 scripts/sdf-game.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5277}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9277}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
