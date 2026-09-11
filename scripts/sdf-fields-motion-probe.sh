#!/usr/bin/env bash
# Is the deeper-field artifact CAMERA motion or BODY motion? Owns its own vite +
# Chrome via the shared lifecycle. See scripts/sdf-fields-motion-probe.mjs.
#
#   scripts/sdf-fields-motion-probe.sh
#   FIELDS_PROBE_ROOM=2 FIELDS_PROBE_FIELDS=2,3,4 scripts/sdf-fields-motion-probe.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5285}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9285}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-fields-motion-probe.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
