#!/usr/bin/env bash
# Is the frozen capture path still telling the truth about CHARACTERS?
# Boots its own vite + headless Chrome (or reuses ones already listening),
# runs the albedo canary, and exits non-zero if a character-only change stops
# showing up in the shot. See scripts/dungeon-look-canary.mjs for the why.
#
#   scripts/dungeon-look-canary.sh
#   LOOK_POSE="4.8,4.8,3.1415927,0" scripts/dungeon-look-canary.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/dungeon-look-canary.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
