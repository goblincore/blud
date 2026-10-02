#!/usr/bin/env bash
# Owns its own vite + headless Chrome. Runs the post-hit noise split clean, then wounded.
# Env: PROBE_ROOM (1), PROBE_BLOCKS (3), PROBE_FRAMES (90), PROBE_OUT (this directory).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE" && git rev-parse --show-toplevel)"
cd "$ROOT"
export LAB_VITE_PORT="${LAB_VITE_PORT:-5397}" LAB_CDP_PORT="${LAB_CDP_PORT:-9397}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
for W in 0 1; do
  PROBE_WOUNDS=$W PROBE_OUT="${PROBE_OUT:-$HERE}" node "$HERE/posthit-split-probe.mjs" "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$ROOT"
done
