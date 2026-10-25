#!/usr/bin/env bash
# One leg (before | after) of the bent-prim Newton polish A/B: march-hash, turntables, scene B frame cost.
# The pipelines must be WARM in this Chrome's cache (one boot after the shader text change, waited out): a cold boot
# misses the 180 s background-compile budget on HEAD too, degrades to the per-body fallback, and benches that.
#   docs/dev-notes/2026-10-24-gpu-bake-parity/capture-leg.sh before
# Output under .lab-tmp/bend-polish/<leg>/ (gitignored). Run legs on a quiet machine, one at a time.
set -euo pipefail
LEG="${1:?leg name}"
cd "$(dirname "$0")/../../.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5371}" LAB_CDP_PORT="${LAB_CDP_PORT:-9371}" LAB_TMP="${LAB_TMP:-.lab-tmp}"
OUT=".lab-tmp/bend-polish/$LEG"; mkdir -p "$OUT"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/march-hash.mjs > "$OUT/march-hash.json" 2> "$OUT/march-hash.log" || echo "march-hash exit $?" >> "$OUT/march-hash.log"
# SKIP_SHOTS=1: the turntables are NOT byte-reproducible run to run (blob-turntable.mjs KNOWN LIMIT: wall-clock verlet
# settle, and the reference cube lands elsewhere), so they are review images, never an A/B instrument.
[ "${SKIP_SHOTS:-}" = 1 ] || for c in teratoma twinhead cyclops; do
  BLOB_CHARACTER="$c" node scripts/blob-turntable.mjs "$LAB_VITE_PORT" "$OUT/shot-$c" 8 "$LAB_CDP_PORT" > "$OUT/shot-$c.log" 2>&1 || echo "shot $c failed" >> "$OUT/shot-$c.log"
done
for i in 1 2 3; do
  node scripts/sdf-bench.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" B 0.7 15 > "$OUT/bench-B-$i.json" 2>&1 || echo "bench $i failed" >> "$OUT/bench-B-$i.json"
done
echo "leg $LEG done: $OUT"
