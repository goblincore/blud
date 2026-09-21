#!/usr/bin/env bash
# The FOV-narrowing capture set + view-model compensation gate. Owns its own
# vite + Chrome via the shared lifecycle, on a port pair of its own.
#
# NEVER kill a server you did not start (scripts/lab-servers.sh says why).
# If 5285/9285 are taken by another worktree, export a free pair:
#   LAB_VITE_PORT=5287 LAB_CDP_PORT=9287 scripts/sdf-game-fov-capture.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5285}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9285}"
export GAME_OUT="${GAME_OUT:-docs/dev-notes/2026-09-21-narrow-fov}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-fov-capture.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
