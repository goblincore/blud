#!/bin/bash
# lil-benchmark — same 5 tasks as model-benchmark.sh, but driven through
# the `lil` CLI (print mode) instead of raw curl. Compares agent-loop
# output (file writes + tool calls) against one-shot text completion.
#
# Usage: ./model-benchmark-lil.sh <model-name> <output-dir>
#
# Assumes llama-serve-lil is already running on :8888.

set -euo pipefail

MODEL_NAME="${1:?Usage: model-benchmark-lil.sh <model-name> <output-dir>}"
OUT_DIR="${2:?Specify output dir}"
mkdir -p "$OUT_DIR"

PORT=8888
if ! curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
  echo "ERROR: llama-server not responding on port $PORT"
  exit 1
fi

run_task() {
  local task_num="$1"
  local task_name="$2"
  local prompt="$3"
  local workdir="$OUT_DIR/${MODEL_NAME}-task${task_num}"
  rm -rf "$workdir"
  mkdir -p "$workdir"

  echo "=== Task $task_num: $task_name ==="
  echo -n "  Running in $workdir ... "

  local START END ELAPSED
  START=$(date +%s)
  # Capture both stdout and stderr; use the same one-shot phrasing as
  # the curl bench but let lil's tools actually write the files.
  timeout 1200 lil --cwd "$workdir" -p "$prompt" \
    > "$workdir/_lil-stdout.log" 2> "$workdir/_lil-stderr.log" || true
  END=$(date +%s)
  ELAPSED=$((END - START))

  local nfiles
  nfiles=$(find "$workdir" -maxdepth 2 -type f ! -name "_lil-*.log" | wc -l | tr -d ' ')
  local stdout_bytes
  stdout_bytes=$(wc -c < "$workdir/_lil-stdout.log" | tr -d ' ')

  echo "done (${ELAPSED}s, files=${nfiles}, stdout=${stdout_bytes}B)"
  find "$workdir" -maxdepth 2 -type f ! -name "_lil-*.log" -exec basename {} \;  | sed 's/^/    /'
}

echo "Benchmarking (via lil): $MODEL_NAME"
echo "Output: $OUT_DIR/"
echo ""

run_task 1 "SeededRng" "Write a TypeScript utility module that exports a SeededRng class with mulberry32 PRNG. Constructor takes seed number. Methods: next() returns float [0,1), nextInt(min,max) inclusive int, nextFloat(min,max), nextBool(p=0.5), pick(arr) random element, shuffle(arr) Fisher-Yates non-mutating, fork() returns new independent SeededRng from current state. Store state as class field. Use strict TypeScript, no deps. Also write vitest tests covering: same seed same sequence, different seeds different values, nextInt bounds, nextFloat bounds, nextBool p=0 always false p=1 always true, pick from array, shuffle same elements not mutated, fork independent instances."

run_task 2 "Vec2" "Write a TypeScript Vec2 class with immutable operations: constructor(x,y), add(v), sub(v), mul(s), len(), lenSq(), normalize(), dot(v), lerp(v,t), dist(v), angle(), rotate(rad), equals(v), clone(), static fromAngle(rad), static ZERO/ONE/UP/RIGHT constants. All methods return new Vec2. Then write comprehensive vitest tests."

run_task 3 "ObjectPool" "Write a TypeScript generic ObjectPool<T> class. Constructor takes a factory () => T and optional reset (t:T) => void and initialSize number. Methods: acquire(): T returns an object from the pool (creating new ones if empty), release(t: T): void returns object to pool (calling reset if provided), drain(): T[] removes all objects from pool and returns them, get size(): number returns available count. Write vitest tests covering: acquire creates when empty, release/recycle, reset callback, drain, initial size fill, type safety."

run_task 4 "CSV parser" "Write a TypeScript function parseCsv(input: string): string[][] that parses CSV text. Must handle: quoted fields (double quotes), escaped quotes (double-double-quote inside quoted fields), newlines inside quoted fields, empty fields, trailing newlines. Also write a serializeCsv(rows: string[][]): string function. Include comprehensive vitest tests with edge cases."

run_task 5 "LRU cache" "Write a TypeScript generic LRUCache<K,V> class. Constructor takes capacity number. Methods: get(key: K): V | undefined (moves to most recent), set(key: K, value: V): void (evicts LRU if over capacity), has(key: K): boolean, delete(key: K): boolean, get size(): number, entries(): IterableIterator<[K,V]> in MRU order. Must evict least-recently-used item when capacity exceeded. Write vitest tests covering: basic get/set, eviction order, update moves to recent, delete, capacity enforcement, entries iteration order."

echo ""
echo "=== Done. Directories in $OUT_DIR/ ==="
ls -d "$OUT_DIR/${MODEL_NAME}"-task*/
