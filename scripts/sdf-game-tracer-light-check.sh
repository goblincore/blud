#!/usr/bin/env bash
# "Do the tracers light the room?" — owns its own vite + Chrome via the shared
# lifecycle (scripts/lab-servers.sh). See scripts/sdf-game-tracer-light-check.mjs
# for what it measures and the honest limits.
#
#   scripts/sdf-game-tracer-light-check.sh
#   TRACER_GAINS=0,0,2,8,20,60 TRACER_SLOTS=8 scripts/sdf-game-tracer-light-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5281}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9281}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-tracer-light-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
