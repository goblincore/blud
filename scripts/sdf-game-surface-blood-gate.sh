#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5368}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9368}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-surface-blood-gate.mjs
