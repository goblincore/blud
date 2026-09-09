#!/usr/bin/env bash
# Look capture for the shot tracers on sdf-game.html — owns its own vite +
# Chrome via the shared lifecycle. See scripts/sdf-game-tracer-look.mjs.
#
#   LAB_TMP=.lab-tmp scripts/sdf-game-tracer-look.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5279}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9279}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-tracer-look.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
