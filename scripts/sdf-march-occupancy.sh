#!/usr/bin/env bash
# Where the march's pixels go — owns its own vite + Chrome via the shared
# lifecycle. See scripts/sdf-march-occupancy.mjs for what it measures and the
# caveat the seam itself states (occupancy is a LOWER BOUND on the waste).
#
#   scripts/sdf-march-occupancy.sh
#   MARCH_OCC_ROOMS=1,3 MARCH_OCC_BURST=0 scripts/sdf-march-occupancy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5283}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9283}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-march-occupancy.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
