#!/usr/bin/env bash
# Scene B frame cost, coneBend at <rev> vs this tree, INTERLEAVED in one session (HEAD, polished, HEAD, polished):
# legs hours apart measured machine state, not the leaf (2026-10-24: XProtect scans moved scene B 41 -> 58 ms).
# Each leg swaps primitives.wgsl.ts, runs one discarded warm-up bench, then two measured ones.
#   docs/dev-notes/2026-10-24-gpu-bake-parity/bench-ab.sh [rev=HEAD]
set -euo pipefail
REV="${1:-HEAD}"
cd "$(dirname "$0")/../../.."
F=src/lab/sdf-zombie/webgpu/march/primitives.wgsl.ts
OUT=.lab-tmp/bend-polish/bench-ab; mkdir -p "$OUT"
cp "$F" "$OUT/primitives.polished.ts"; git show "$REV:$F" > "$OUT/primitives.before.ts"
export LAB_VITE_PORT="${LAB_VITE_PORT:-5371}" LAB_CDP_PORT="${LAB_CDP_PORT:-9371}" LAB_TMP="${LAB_TMP:-.lab-tmp}"
. scripts/lab-servers.sh
trap 'cp "$OUT/primitives.polished.ts" "$F"; lab_servers_down' EXIT
lab_servers_up
for round in 1 2; do
  for leg in before polished; do
    cp "$OUT/primitives.$leg.ts" "$F"; sleep 2
    node scripts/sdf-bench.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" B 0.7 15 > /dev/null 2>&1 || true
    for i in 1 2; do
      node scripts/sdf-bench.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" B 0.7 15 2>&1 | grep -o '"summary":{[^}]*}' | sed "s/^/$leg r$round.$i /" | tee -a "$OUT/results.txt"
    done
  done
done
