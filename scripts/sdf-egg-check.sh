#!/usr/bin/env bash
# Headless check for the control room's egg (scripts/sdf-egg-check.mjs). Owns its own vite + Chrome
# via the shared lifecycle, on its own port pair (not the disco check's 5367/9367).
#
# NEVER kill a server you did not start (scripts/lab-servers.sh says why).
# In a sandbox, export LAB_TMP=.lab-tmp or Chrome produces no frames.
#   EGG_SHEET=docs/dev-notes/2026-09-30-egg-ending/egg-pass.png scripts/sdf-egg-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5373}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9373}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-egg-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
