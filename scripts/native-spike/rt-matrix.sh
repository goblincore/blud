#!/usr/bin/env bash
# The ray-tracing spike's scene matrix: one JSON line per scene.
#   scripts/native-spike/rt-matrix.sh [reps]
set -euo pipefail
cd "$(dirname "$0")/../.."
S=.scratch/native-spike
BIN=native/march-replay/target/release/rt_spike
REPS="${1:-5}"
for c in zombie schoolgirl; do
  [ -f "$S/$c.prims.json" ] || npx tsx scripts/native-spike/export-prims.ts "$c" >&2
done
"$BIN" "$S/zombie.prims.json" --scene closeup --reps "$REPS"
"$BIN" "$S/zombie.prims.json" --scene crowd --bodies 24 --reps "$REPS"
"$BIN" "$S/zombie.prims.json" --scene crowd --bodies 96 --reps "$REPS"
"$BIN" "$S/zombie.prims.json" --scene crowd --bodies 384 --reps "$REPS"
"$BIN" "$S/schoolgirl.prims.json" --scene closeup --reps "$REPS"
"$BIN" "$S/schoolgirl.prims.json" --scene crowd --bodies 24 --reps "$REPS"
"$BIN" "$S/zombie.prims.json" --scene crowd --bodies 24 --size 1600x1200 --repeat 3 --reps "$REPS"
