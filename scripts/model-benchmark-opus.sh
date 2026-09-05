#!/bin/bash
# Opus-Reasoning fine-tune bench — same 5 prompts as model-benchmark.sh,
# but tuned for rico03/Qwen3.6-35B-Opus-Reasoning-GGUF's behavior:
#   - always emits <|think|>...<|/think|> (ignores enable_thinking flag)
#   - llama.cpp --reasoning parser doesn't recognize <|think|>, so the
#     thinking block lands in `content` directly — we strip it here
#   - bumped max_tokens to 16000 because thinking burns a lot
#
# Usage: ./model-benchmark-opus.sh <model-name> <output-dir>

set -euo pipefail

MODEL_NAME="${1:?Usage: model-benchmark-opus.sh <model-name> <output-dir>}"
OUT_DIR="${2:?Specify output dir}"
mkdir -p "$OUT_DIR"

PORT=8888
URL="http://127.0.0.1:$PORT/v1/chat/completions"

if ! curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
  echo "ERROR: llama-server not responding on port $PORT"
  exit 1
fi

run_task() {
  local task_num="$1"
  local task_name="$2"
  local prompt="$3"
  local outfile="$OUT_DIR/${MODEL_NAME}-task${task_num}.json"

  echo "=== Task $task_num: $task_name ==="
  echo -n "  Running... "

  # Opus fine-tune always thinks; no /no_think, enable_thinking flag is
  # ignored by the fine-tune's template. Temp 0.6 / top_p 0.95 (Qwen3
  # thinking recommended values). max_tokens 16000 to accommodate thinking.
  local payload
  payload=$(jq -n --arg sys "You are a coding assistant. Be concise, produce clean working TypeScript. No explanations unless asked." --arg prompt "$prompt" '{model:"default",messages:[{role:"system",content:$sys},{role:"user",content:$prompt}],max_tokens:16000,temperature:0.6,top_p:0.95,top_k:20,stream:false,chat_template_kwargs:{enable_thinking:false,preserve_thinking:true}}')

  local START END ELAPSED
  START=$(date +%s)
  local result
  result=$(curl -sf "$URL" -H "Content-Type: application/json" -d "$payload" 2>&1)
  END=$(date +%s)
  ELAPSED=$((END - START))

  echo "$result" > "$outfile"

  local tokens speed raw_content thinking answer finish think_len answer_len
  tokens=$(echo "$result" | jq -r '.usage.completion_tokens // "?"')
  speed=$(echo "$result" | jq -r '.timings.predicted_per_second // "?"')
  finish=$(echo "$result" | jq -r '.choices[0].finish_reason // "?"')
  raw_content=$(echo "$result" | jq -r '.choices[0].message.content // ""')

  # Split thinking out of content. Two formats observed:
  #   rico03 fine-tune: <|think|>...<|/think|>
  #   mradermacher/Rubertigno fine-tune: <antThinking>...</antThinking>
  # Try both patterns so this works across Opus-distilled variants.
  thinking=$(printf '%s' "$raw_content" | perl -0777 -ne 'print $1 if /<\|think\|>(.*?)<\|\/think\|>/s or print $1 if /<antThinking>(.*?)<\/antThinking>/s')
  answer=$(printf '%s' "$raw_content" | perl -0777 -pe 's/<\|think\|>.*?<\|\/think\|>\s*//gs; s/<antThinking>.*?<\/antThinking>\s*//gs')
  think_len=${#thinking}
  answer_len=${#answer}

  echo "done (${ELAPSED}s, ${tokens} tok, ${speed} tok/s, finish=${finish}, think=${think_len}ch, answer=${answer_len}ch)"
  {
    echo "<!-- thinking (${think_len} chars) -->"
    echo "$thinking"
    echo ""
    echo "<!-- answer (${answer_len} chars) -->"
    echo "$answer"
  } > "$OUT_DIR/${MODEL_NAME}-task${task_num}.md"
}

echo "Benchmarking (Opus-Reasoning fine-tune): $MODEL_NAME"
echo "Server: $URL"
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
