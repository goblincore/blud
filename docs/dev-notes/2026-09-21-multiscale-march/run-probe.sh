#!/usr/bin/env bash
# PROBE_SCRIPT picks the probe (default closeup-multiscale-probe.mjs).
# Owns its own vite + Chrome. Env: PROBE_ROOM (1), PROBE_WOUNDS (1), PROBE_BLOCKS (4),
# PROBE_FRAMES (90), PROBE_LADDER ('[1.6,...]'), PROBE_OUT (this directory).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE" && git rev-parse --show-toplevel)"
cd "$ROOT"
export LAB_VITE_PORT="${LAB_VITE_PORT:-5391}" LAB_CDP_PORT="${LAB_CDP_PORT:-9391}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
PROBE_OUT="${PROBE_OUT:-$HERE}" node "$HERE/${PROBE_SCRIPT:-closeup-multiscale-probe.mjs}" "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$ROOT"
