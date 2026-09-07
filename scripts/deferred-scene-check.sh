#!/usr/bin/env bash
# The hybrid-deferred M2 task-3 GPU gate: starts its OWN vite + CDP Chrome on
# private ports (defaults 5326/9326) and runs the scene-router + light-list
# assertions against sdf-deferred-scene.html. Reuses servers already listening
# (lab-servers.sh ownership rules); stops only what it started.
#
#   LAB_VITE_PORT=5326 LAB_CDP_PORT=9326 scripts/deferred-scene-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5326}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9326}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/deferred-scene-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
