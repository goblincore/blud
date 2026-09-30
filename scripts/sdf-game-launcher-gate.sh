#!/usr/bin/env bash
set -euo pipefail
export LAB_VITE_PORT="${LAB_VITE_PORT:-5294}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9294}"
export GAME_OUT="${GAME_OUT:-docs/dev-notes/2026-09-29-grenade-launcher/runtime}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-launcher-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
