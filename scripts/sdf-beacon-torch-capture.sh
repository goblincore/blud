#!/usr/bin/env bash
# Headless check for the Boiler Room disco ball (scripts/sdf-beacon-torch-capture.mjs). Owns its own vite +
# Chrome via the shared lifecycle, on its own port pair (not the light gate's 5297/9297).
#
# NEVER kill a server you did not start (scripts/lab-servers.sh says why).
# In a sandbox, export LAB_TMP=.lab-tmp or Chrome produces no frames.
#   DISCO_SHEET=docs/dev-notes/2026-09-27-disco-ball/disco.png scripts/sdf-beacon-torch-capture.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5371}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9371}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-beacon-torch-capture.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
