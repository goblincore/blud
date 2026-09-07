#!/usr/bin/env bash
# M2 task-5 GPU boot check: starts its OWN vite + CDP Chrome on private ports
# (defaults 5340/9340) and boots sdf-game.html in BOTH render modes, asserting
# the task-5 wiring contract and saving labelled captures. Reuses servers
# already listening (lab-servers.sh ownership rules); stops only what it
# started.
#
#   LAB_VITE_PORT=5340 LAB_CDP_PORT=9340 scripts/deferred-game-boot-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5340}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9340}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/deferred-game-boot-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
