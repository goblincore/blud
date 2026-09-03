#!/usr/bin/env bash
# Headless gate for the sawed-off view-model. Owns its own vite + Chrome via
# the shared lifecycle, on a port pair of its own so it can run while other
# dispatch chains hold servers on theirs.
#
# NEVER kill a server you did not start (scripts/lab-servers.sh says why).
# If 5281/9281 are taken by another worktree, export a free pair:
#   LAB_VITE_PORT=5283 LAB_CDP_PORT=9283 scripts/sdf-game-shorty-gate.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5281}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9281}"
export GAME_OUT="${GAME_OUT:-docs/dev-notes/2026-09-02-fpv-weapon-shorty}"
. "$(dirname "$0")/lab-servers.sh"
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-game-shorty-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"
