#!/usr/bin/env bash
# The honest perf baseline for sdf-game.html. Owns its own vite + Chrome via
# the shared lifecycle (scripts/lab-servers.sh); override ports to coexist.
#
#   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 scripts/sdf-game-bench.sh
#
# BENCH_REPEATS (default 3) and BENCH_ROOMS (default 1,2,3,4) tune the matrix.
# Keep the machine QUIET while this runs — most deltas here are smaller than
# the noise a background build introduces.
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5277}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9277}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-bench.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
