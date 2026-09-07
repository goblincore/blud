#!/usr/bin/env bash
# The hybrid-deferred M1 GPU gate: starts its OWN vite + CDP Chrome on private
# ports (defaults 5306/9306) and runs the assertion-driven check against the
# sdf-deferred.html comparison fixture. Reuses servers already listening
# (lab-servers.sh ownership rules); stops only what it started.
#
#   LAB_VITE_PORT=5306 LAB_CDP_PORT=9306 scripts/deferred-check.sh
#   DEFERRED_SKIP_TIMING=1 scripts/deferred-check.sh   # functional only
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5306}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9306}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/deferred-check.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
