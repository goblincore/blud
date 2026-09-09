#!/usr/bin/env bash
# One command to get turntable frames of a .blob character.
#   npm run blob:shot -- mouse                 # -> /tmp/blob-shot/mouse/index.html
#   npm run blob:shot -- mouse /some/out/dir 12
#   BLOB_DIST=2.0 npm run blob:shot -- goblin
#   LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 npm run blob:shot -- mouse   # alongside another run
#   LAB_TMP=.lab-tmp npm run blob:shot -- mouse   # everything inside the worktree
#
# The default output dir FOLLOWS $LAB_TMP (see lab-servers.sh), so under a
# sandbox that only permits writes inside the worktree, setting LAB_TMP alone
# moves the Chrome profile, the server logs AND the frames somewhere writable.
# With LAB_TMP unset this resolves to /tmp/blob-shot/<name> exactly as before.
#
# Starts a Vite dev server and a Chrome IF they are not already listening, runs
# scripts/blob-turntable.mjs, then stops only what it started — all of which
# lives in scripts/lab-servers.sh, shared with blob-render-check.sh. Read that
# file for the ports, the reuse rule, the headless decision and the WebGPU
# health probe.
set -euo pipefail

NAME="${1:?usage: blob-shot <character> [outDir] [frames]}"
# Captured, not resolved: the default depends on $LAB_TMP, which lab-servers.sh
# defines when it is sourced below.
OUT_ARG="${2:-}"; FRAMES="${3:-8}"
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
OUT="${OUT_ARG:-$LAB_TMP/blob-shot/$NAME}"
trap lab_servers_down EXIT
lab_servers_up

BLOB_CHARACTER="$NAME" node scripts/blob-turntable.mjs \
  "$LAB_VITE_PORT" "$OUT" "$FRAMES" "$LAB_CDP_PORT"
echo "frames: $OUT/index.html"
