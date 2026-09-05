#!/bin/bash
# Benchmark runner for olmx + Qwen3.6-35B-A3B-ConfigI-MLX
# Adapted from model-benchmark.sh for the oMLX server

set -euo pipefail

MODEL_NAME="${1:-ConfigI-MLX}"
OUT_DIR="${2:-docs/dev-notes/model-benchmarks}"
mkdir -p "$OUT_DIR"

PORT=8000
URL="http://127.0.0.1:$PORT/v1/chat/completions"
FULL_MODEL="Qwen3.6-35B-A3B-ConfigI-MLX"

if ! curl -sf "http://127.0.0.1:$PORT/v1/models" > /dev/null 2>&1; then
  echo "ERROR: olmx server not responding on port $PORT"
  exit 1
fi

run_task() {
  local task_num="$1"
  local task_name="$2"
  local prompt="$3"
  local outfile="$OUT_DIR/${MODEL_NAME}-task${task_num}.json"
  
  echo "=== Task $task_num: $task_name ==="
  echo -n "  Running... "
  
  # Build payload with chat_template_kwargs to disable thinking
  local payload
  payload=$(jq -n \
    --arg model "$FULL_MODEL" \
    --arg sys "You are a coding assistant. Be concise, produce clean working TypeScript. No explanations unless asked." \
    --arg prompt "$prompt" \
    '{
      model: $model,
      messages: [
        {role: "system", content: $sys},
        {role: "user", content: $prompt}
      ],
      max_tokens: 4000,
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      stream: false,
      chat_template_kwargs: {enable_thinking: true}
    }')
  
  local START END ELAPSED
  START=$(date +%s)
  local result
  result=$(curl -sf "$URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer Poepoe123" \
    -d "$payload" 2>&1)
  END=$(date +%s)
  ELAPSED=$((END - START))
  
  echo "$result" > "$outfile"
  
  local tokens speed content_len
  tokens=$(echo "$result" | jq -r '.usage.completion_tokens // "?"')
  # olmx may not have timings like llama.cpp, compute from elapsed
  speed="n/a"
  if [[ "$tokens" != "?" && "$tokens" -gt 0 && "$ELAPSED" -gt 0 ]]; then
    speed=$(awk "BEGIN {printf \"%.1f\", $tokens / $ELAPSED}")
  fi
  content=$(echo "$result" | jq -r '.choices[0].message.content // "ERROR"')
  content_len=${#content}
  
  echo "done (${ELAPSED}s, ${tokens} tokens, ${speed} tok/s, ${content_len} chars)"
  echo "$content" > "$OUT_DIR/${MODEL_NAME}-task${task_num}.md"
}

echo "Benchmarking: $MODEL_NAME ($FULL_MODEL)"
echo "Server: oMLX on port $PORT"
echo "Output: $OUT_DIR/"
echo ""

run_task 1 "SeededRng" "Write a TypeScript utility module that exports a SeededRng class with mulberry32 PRNG. Constructor takes seed number. Methods: next() returns float [0,1), nextInt(min,max) inclusive int, nextFloat(min,max), nextBool(p=0.5), pick(arr) random element, shuffle(arr) Fisher-Yates non-mutating, fork() returns new independent SeededRng from current state. Store state as class field. Use strict TypeScript, no deps. Also write vitest tests covering: same seed same sequence, different seeds different values, nextInt bounds, nextFloat bounds, nextBool p=0 always false p=1 always true, pick from array, shuffle same elements not mutated, fork independent instances."

run_task 2 "Vec2" "Write a TypeScript Vec2 class with immutable operations: constructor(x,y), add(v), sub(v), mul(s), len(), lenSq(), normalize(), dot(v), lerp(v,t), dist(v), angle(), rotate(rad), equals(v), clone(), static fromAngle(rad), static ZERO/ONE/UP/RIGHT constants. All methods return new Vec2. Then write comprehensive vitest tests."

run_task 3 "ObjectPool" "Write a TypeScript generic ObjectPool<T> class. Constructor takes a factory () => T and optional reset (t:T) => void and initialSize number. Methods: acquire(): T returns an object from the pool (creating new ones if empty), release(t: T): void returns object to pool (calling reset if provided), drain(): T[] removes all objects from pool and returns them, get size(): number returns available count. Write vitest tests covering: acquire creates when empty, release/recycle, reset callback, drain, initial size fill, type safety."

run_task 4 "CSV parser" "Write a TypeScript function parseCsv(input: string): string[][] that parses CSV text. Must handle: quoted fields (double quotes), escaped quotes (double-double-quote inside quoted fields), newlines inside quoted fields, empty fields, trailing newlines. Also write a serializeCsv(rows: string[][]): string function. Include comprehensive vitest tests with edge cases."

run_task 5 "LRU cache" "Write a TypeScript generic LRUCache<K,V> class. Constructor takes capacity number. Methods: get(key: K): V | undefined (moves to most recent), set(key: K, value: V): void (evicts LRU if over capacity), has(key: K): boolean, delete(key: K): boolean, get size(): number, entries(): IterableIterator<[K,V]> in MRU order. Must evict least-recently-used item when capacity exceeded. Write vitest tests covering: basic get/set, eviction order, update moves to recent, delete, capacity enforcement, entries iteration order."

echo ""
echo "=== Done. Files in $OUT_DIR/ ==="
ls -la "$OUT_DIR/${MODEL_NAME}"*
