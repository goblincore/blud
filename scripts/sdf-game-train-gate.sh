#!/usr/bin/env bash
# Headless gate for the train carriage kit. Owns its own vite + Chrome via the
# shared lifecycle, on its own port pair.
#
# NEVER kill a server you did not start (scripts/lab-servers.sh says why).
# In a sandbox, export LAB_TMP=.lab-tmp or Chrome produces no frames.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5295}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9295}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-train-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
