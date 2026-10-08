#!/usr/bin/env bash
# Record one frame's march pass for the native-renderer spike. Owns the vite +
# Chrome lifecycle (scripts/lab-servers.sh); see capture.mjs for the knobs.
#
#   scripts/native-spike/capture.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5291}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9291}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/native-spike/capture.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "${1:-.scratch/native-spike/capture}"
