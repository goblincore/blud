#!/usr/bin/env bash
# The hybrid-deferred M2 task-4 GPU gate: starts its OWN vite + CDP Chrome on
# private ports (defaults 5330/9330) and runs the flashlight-shadow assertions
# against sdf-deferred-shadows.html. Reuses servers already listening
# (lab-servers.sh ownership rules); stops only what it started.
#
#   LAB_VITE_PORT=5330 LAB_CDP_PORT=9330 scripts/deferred-shadow-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5330}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9330}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/deferred-shadow-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
