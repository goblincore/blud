#!/usr/bin/env bash
# Hold the spike's vite + Chrome up while a command runs (so a capture and the
# Chrome replays that follow it share one browser):
#
#   scripts/native-spike/servers.sh <command...>
set -euo pipefail
cd "$(dirname "$0")/../.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5291}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9291}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
"$@"
