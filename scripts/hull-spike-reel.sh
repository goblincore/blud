#!/usr/bin/env bash
# scripts/hull-spike-reel.sh — the owner's three-item A/B reel (spec §7).
# Each item: hull vs march on the SAME frozen scene, via perf-r2-parity.mjs.
# Usage: scripts/hull-spike-reel.sh <outDir> [cell band steps]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:?outDir}; CELL=${2:-0.02}; BAND=${3:-0.02}; STEPS=${4:-4}
export LAB_VITE_PORT=${LAB_VITE_PORT:-5340} LAB_CDP_PORT=${LAB_CDP_PORT:-9340}
source scripts/lab-servers.sh; lab_servers_up; trap lab_servers_down EXIT
KNOBS="__hullSpike.setKnobs({cell:$CELL,band:$BAND,steps:$STEPS})"
ON="$KNOBS; __hullSpike.setRenderer('hull')"
OFF="__hullSpike.setRenderer('march')"
COMMON=(--url /sdf-hull-spike.html --seam __hullSpike --on "$ON" --off "$OFF")
# 1. wounded close-up: a pellet and a slug at FPV range
node scripts/perf-r2-parity.mjs capture "$OUT/1-wounded" "${COMMON[@]}" \
  --pre "__hullSpike.firePellet(); __hullSpike.fireSlug()"
# 2. walk cycle: NOT frozen — capture pairs at four gait phases via freeze/unfreeze
for ph in 0 1 2 3; do
  node scripts/perf-r2-parity.mjs capture "$OUT/2-walk-$ph" "${COMMON[@]}" \
    --pre "__hullSpike.freeze(false); await new Promise(r=>setTimeout(r, ${ph}00 + 350)); __hullSpike.freeze(true)"
done
# 3. sever + gib
node scripts/perf-r2-parity.mjs capture "$OUT/3-gib" "${COMMON[@]}" \
  --pre "__hullSpike.gib(); await new Promise(r=>setTimeout(r, 400))"
echo "reel in $OUT — read each summary.json; pixel diffs are a SIGNAL only, the owner's eye is the gate"
