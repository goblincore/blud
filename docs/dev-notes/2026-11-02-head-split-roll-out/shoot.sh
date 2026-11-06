#!/usr/bin/env bash
# The head split on one arena enemy, before/after style: bash docs/dev-notes/2026-11-02-head-split-roll-out/shoot.sh <tag> [character] [outDir]
# Brings up vite + headless WebGPU Chrome (scripts/lab-servers.sh; LAB_VITE_PORT / LAB_CDP_PORT override) and writes
# <outDir>/<tag>-<character>-<n>-<view>.png. The in-app browser pane does not capture the WebGPU canvas; this does.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node "$HERE/split-shot.mjs" "$LAB_VITE_PORT" "$LAB_CDP_PORT" "${3:-.lab-tmp/split-shots}" "$1" "${2:-soldier}"
