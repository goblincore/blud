#!/usr/bin/env bash
# The raymarcher perf bench, headless. Starts a Vite dev server and a Chrome
# IF they are not already listening, runs scripts/sdf-bench.mjs, then stops
# only what it started — the shared lifecycle lives in scripts/lab-servers.sh
# (read that for the ports, the reuse rule and the WebGPU health probe).
#
# Usage:
#   LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 npm run bench:sdf -- A 0.7 15
#   scripts/sdf-bench.sh B 0.7 15            # scene, scale, seconds
#   scripts/sdf-bench.sh A 0.7 15 steps      # yaw-0 steps heatmap PNG
#   scripts/sdf-bench.sh A 0.7 15 prims      # yaw-0 prims  heatmap PNG
#
# Numbers quoted in any perf report come from THIS command (spec decision
# 4), never from the lab, and never while another dispatch or the owner's
# lab tab is active.
set -euo pipefail

SCENE="${1:?usage: sdf-bench <A|B> [scale] [seconds] [steps|prims]}"
# RUN_SECONDS, not SECONDS: SECONDS is a bash BUILTIN that counts up every
# second and silently rewrites any assignment made to it (the first run
# benched "17 seconds" after being handed 15).
RUN_SECONDS="${3:-15}"; DEBUG="${4:-}"; SCALE="${2:-0.7}"
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up

node scripts/sdf-bench.mjs \
  "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$SCENE" "$SCALE" "$RUN_SECONDS" "$DEBUG"
