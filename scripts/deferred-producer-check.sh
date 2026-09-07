#!/usr/bin/env bash
# The hybrid-deferred M2 task-2 GPU gate: starts its OWN vite + CDP Chrome on
# private ports (defaults 5324/9324) and runs the producer assertions against
# sdf-deferred-producers.html. Reuses servers already listening
# (lab-servers.sh ownership rules); stops only what it started.
#
#   LAB_VITE_PORT=5324 LAB_CDP_PORT=9324 scripts/deferred-producer-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5324}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9324}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/deferred-producer-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
