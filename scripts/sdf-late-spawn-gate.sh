#!/usr/bin/env bash
# Where the march's pixels go — owns its own vite + Chrome via the shared
# lifecycle. See scripts/sdf-late-spawn-gate.mjs for what it measures and the
# caveat the seam itself states (occupancy is a LOWER BOUND on the waste).
#
#   scripts/sdf-late-spawn-gate.sh
#   MARCH_OCC_ROOMS=1,3 MARCH_OCC_BURST=0 scripts/sdf-late-spawn-gate.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5291}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9291}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-late-spawn-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
