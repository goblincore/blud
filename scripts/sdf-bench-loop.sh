#!/usr/bin/env bash
# One-session bench loop: start servers ONCE, run scripts/sdf-bench.mjs
# N times per scene (repro protocol: 5 runs, take the min), then stop what
# we started. Same driver `npm run bench:sdf` uses underneath.
#
#   LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 scripts/sdf-bench-loop.sh 60 5
#
# SECONDS-per-run and RUNS are both parameters: on a slow scene (12 fps at
# the owner's window today), 15 s yields ~140 samples and the n>500 gate
# needs a longer window — same orbit, slower yaw.
set -euo pipefail

DUR="${1:?usage: sdf-bench-loop <seconds> <runs>}"; RUNS="${2:?usage: sdf-bench-loop <seconds> <runs>}"
cd "$(dirname "$0")/.."

. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up

for SCENE in A B; do
  for i in $(seq 1 "$RUNS"); do
    echo "=== scene $SCENE run $i/$RUNS ==="
    node scripts/sdf-bench.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$SCENE" 0.7 "$DUR" \
      | tee -a "/tmp/sdf-bench/${SCENE}-runs.jsonl"
    sleep 2
  done
done
