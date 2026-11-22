#!/usr/bin/env bash
# Runs first-chunk-stall-probe.mjs on its own vite + Chrome (scripts/lab-servers.sh).
# Usage: LAB_TMP=.lab-tmp bash scripts/first-chunk-stall-probe.sh [--no-wait] [--out path]
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5484}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9484}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/first-chunk-stall-probe.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$@"
