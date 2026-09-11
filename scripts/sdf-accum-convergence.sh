#!/usr/bin/env bash
# GATE 1 for the temporal accumulation: does a low-res march reconstruct?
# Owns its own vite + Chrome via the shared lifecycle.
#
#   scripts/sdf-accum-convergence.sh
#   ACCUM_SCALE=0.35 ACCUM_FRAMES=32 ACCUM_ALPHA=0.2 scripts/sdf-accum-convergence.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5289}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9289}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-accum-convergence.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
