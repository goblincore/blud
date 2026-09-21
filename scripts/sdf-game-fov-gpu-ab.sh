#!/usr/bin/env bash
# What the FOV narrowing costs on the GPU. Owns its own vite + Chrome, on its
# own port pair. NEVER kill a server you did not start.
#   LAB_VITE_PORT=5291 LAB_CDP_PORT=9291 scripts/sdf-game-fov-gpu-ab.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5289}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9289}"
export GAME_OUT="${GAME_OUT:-docs/dev-notes/2026-09-21-narrow-fov}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-fov-gpu-ab.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
