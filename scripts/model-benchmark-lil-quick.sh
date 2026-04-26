#!/bin/bash
# Quick before/after bench for ngram speculative decoding on lil.
# Runs only tasks 1 (SeededRng) and 5 (LRUCache) to keep the comparison fast.
# Usage: ./model-benchmark-lil-quick.sh <label> <output-dir>
#
# Assumes llama-serve-lil already running on :8888 and writes a timing JSON
# alongside the per-task dirs so the after-run can be diffed cleanly.

set -euo pipefail

LABEL="${1:?Usage: model-benchmark-lil-quick.sh <label> <output-dir>}"
OUT_DIR="${2:?Specify output dir}"
mkdir -p "$OUT_DIR"

PORT=8888
if ! curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
  echo "ERROR: llama-server not responding on port $PORT"
  exit 1
fi

TIMINGS_JSON="$OUT_DIR/${LABEL}-timings.json"
echo "{" > "$TIMINGS_JSON"
echo "  \"label\": \"$LABEL\"," >> "$TIMINGS_JSON"
echo "  \"tasks\": {" >> "$TIMINGS_JSON"

run_task() {
  local task_num="$1"
  local task_name="$2"
  local prompt="$3"
  local trailing="$4"   # "," or "" for last entry
  local workdir="$OUT_DIR/${LABEL}-task${task_num}"
  rm -rf "$workdir"
  mkdir -p "$workdir"

  echo "=== Task $task_num: $task_name ==="
  echo -n "  Running in $workdir ... "

  local START END ELAPSED
  START=$(date +%s)
  timeout 1200 lil --cwd "$workdir" -p "$prompt" \
    > "$workdir/_lil-stdout.log" 2> "$workdir/_lil-stderr.log" || true
  END=$(date +%s)
  ELAPSED=$((END - START))

  local nfiles
  nfiles=$(find "$workdir" -maxdepth 2 -type f ! -name "_lil-*.log" | wc -l | tr -d ' ')
  local stdout_bytes
  stdout_bytes=$(wc -c < "$workdir/_lil-stdout.log" | tr -d ' ')

  echo "done (${ELAPSED}s, files=${nfiles}, stdout=${stdout_bytes}B)"
  printf '    "task%s": {"name": "%s", "elapsed_s": %s, "files": %s, "stdout_bytes": %s}%s\n' \
    "$task_num" "$task_name" "$ELAPSED" "$nfiles" "$stdout_bytes" "$trailing" \
    >> "$TIMINGS_JSON"
}

echo "Quick bench: $LABEL"
echo "Output: $OUT_DIR/"
echo ""

run_task 1 "SeededRng" "Write a TypeScript utility module that exports a SeededRng class with mulberry32 PRNG. Constructor takes seed number. Methods: next() returns float [0,1), nextInt(min,max) inclusive int, nextFloat(min,max), nextBool(p=0.5), pick(arr) random element, shuffle(arr) Fisher-Yates non-mutating, fork() returns new independent SeededRng from current state. Store state as class field. Use strict TypeScript, no deps. Also write vitest tests covering: same seed same sequence, different seeds different values, nextInt bounds, nextFloat bounds, nextBool p=0 always false p=1 always true, pick from array, shuffle same elements not mutated, fork independent instances." ","

run_task 5 "LRU cache" "Write a TypeScript generic LRUCache<K,V> class. Constructor takes capacity number. Methods: get(key: K): V | undefined (moves to most recent), set(key: K, value: V): void (evicts LRU if over capacity), has(key: K): boolean, delete(key: K): boolean, get size(): number, entries(): IterableIterator<[K,V]> in MRU order. Must evict least-recently-used item when capacity exceeded. Write vitest tests covering: basic get/set, eviction order, update moves to recent, delete, capacity enforcement, entries iteration order." ""

echo "  }" >> "$TIMINGS_JSON"
echo "}" >> "$TIMINGS_JSON"

echo ""
echo "=== Done. Timings: $TIMINGS_JSON ==="
cat "$TIMINGS_JSON"
