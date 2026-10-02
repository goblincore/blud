#!/usr/bin/env bash
# scripts/earlyz-run.sh <smoke|parity> [args...] — owns its own vite + headless Chrome.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WHAT="${1:?usage: scripts/earlyz-run.sh <smoke|parity> [args]}"; shift
# Refuse a bad target BEFORE any server starts.
case "$WHAT" in
  smoke | parity) ;;
  *) echo "usage: scripts/earlyz-run.sh <smoke|parity> [args] (got '$WHAT')" >&2; exit 2 ;;
esac
SCRIPT="scripts/earlyz-$WHAT.mjs"
[ -f "$SCRIPT" ] || { echo "earlyz-run: $SCRIPT does not exist" >&2; exit 2; }
export LAB_VITE_PORT="${LAB_VITE_PORT:-5401}" LAB_CDP_PORT="${LAB_CDP_PORT:-9401}"
export LAB_TMP="${LAB_TMP:-.lab-tmp}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node "$SCRIPT" "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$@"
