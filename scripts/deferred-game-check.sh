#!/usr/bin/env bash
# M2 task 6 — real-game producer/lifecycle GPU regression gate (private
# ports, own servers):
#   LAB_VITE_PORT=5326 LAB_CDP_PORT=9326 scripts/deferred-game-check.sh
# Owns/stops only what it starts (lab-servers.sh ownership rules).
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5326}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9326}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/deferred-game-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
