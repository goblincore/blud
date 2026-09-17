#!/usr/bin/env bash
# Temporal-start A/B (scripts/tmp/tstart-ab.mjs) with the shared server
# lifecycle. Fresh ports so this never collides with the owner's lab.
set -euo pipefail
cd "$(dirname "$0")/../.."

LAB_VITE_PORT="${LAB_VITE_PORT:-5299}"
LAB_CDP_PORT="${LAB_CDP_PORT:-9299}"
LAB_TMP="${LAB_TMP:-/tmp}"
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up

node scripts/tmp/tstart-ab.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "${1:-4}"
