#!/bin/bash
# QMKRV vs TRIPLET A/B for the Hand-port stretch prompt — the original loop trigger.
#
# Usage: bash run-ab.sh <fsm-mode> <label>
#   fsm-mode: 1 = TRIPLET (relaxed 1-5 cap), 2 = QMKRV (telegram)
#   label: short string for the output dir
#
# Resets the worktree, restarts llama-server with LLAMA_FSM_THINK=$mode,
# runs the Hand-port stretch prompt against pi/lil with a 60-min timeout,
# captures stdout + final git status + tsc check + repetition signals.

set -euo pipefail

MODE="${1:?Usage: run-ab.sh <fsm-mode> <label>}"
LABEL="${2:?Specify label}"
OUT_DIR="$HOME/Projects/blud/docs/dev-notes/qmkrv-ab/$LABEL"
PROMPT_FILE="$HOME/Projects/blud/docs/dev-notes/qmkrv-ab/hand-port-prompt.txt"
WT="/tmp/blud-stretch-hand"
LLAMA_BIN="$HOME/Projects/TheTom-llama-cpp-turboquant/build/bin/llama-server"
MODEL="$HOME/models/qwen3.6-vl-reap-26b-text-Q4_K_M.gguf"

mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/run.log"
exec > >(tee -a "$LOG") 2>&1

echo "=== $(date) START [$LABEL] FSM=$MODE ==="

# 1. Reset worktree to clean state
cd "$WT"
git checkout -- . 2>/dev/null || true
git clean -fd 2>/dev/null || true
echo "worktree reset:"
git status --short

# 2. Stop any existing llama-server, start fresh
pkill -f "llama-server" 2>/dev/null || true
sleep 3
LLAMA_FSM_THINK="$MODE" nohup "$LLAMA_BIN" \
  -m "$MODEL" \
  --host 127.0.0.1 --port 8888 -ngl 99 -c 65536 -np 1 \
  -ctk q8_0 -ctv turbo3 -fa on --no-context-shift \
  --jinja --chat-template-kwargs '{"enable_thinking":true,"preserve_thinking":true}' \
  --reasoning auto --spec-type ngram-simple --draft-max 8 --draft-min 2 --draft-p-min 0.75 \
  > "$OUT_DIR/llama-server.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$OUT_DIR/server.pid"

# Wait for health
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8888/health > /dev/null 2>&1; then
    echo "server up after ${i}s, FSM=$MODE"
    break
  fi
  sleep 2
done
if ! curl -sf http://127.0.0.1:8888/health > /dev/null 2>&1; then
  echo "ERROR: server never came up"
  exit 1
fi

# 3. Run pi/lil against the prompt with 60-min timeout
START=$(date +%s)
echo "[$LABEL] starting lil at $(date)"

cd "$WT"
timeout 3600 lil --cwd "$WT" -p "$(cat "$PROMPT_FILE")" \
  > "$OUT_DIR/pi-stdout.log" 2> "$OUT_DIR/pi-stderr.log" \
  && EXIT=$? || EXIT=$?

END=$(date +%s)
DURATION=$((END - START))
echo "[$LABEL] done in ${DURATION}s, exit=${EXIT}"

# 4. Capture results
echo "--- final git status ---"
git status --short | tee "$OUT_DIR/final-status.txt"
echo "--- new files in src/game/enemy ---"
ls -la "$WT/src/game/enemy/hand"* 2>&1 || echo "(none)"

# 5. tsc check (best-effort)
echo "--- tsc ---"
(cd "$WT" && timeout 120 npx tsc --noEmit 2>&1 | tee "$OUT_DIR/tsc.log") || true

# 6. Loop / repetition signals
echo "--- repetition signals ---"
GOAL_COUNT=$(grep -c "GOAL:" "$OUT_DIR/pi-stdout.log" || echo 0)
QMKRV_COUNT=$(grep -cE "^Q=" "$OUT_DIR/pi-stdout.log" || echo 0)
THINK_OPENS=$(grep -c "<think>" "$OUT_DIR/pi-stdout.log" || echo 0)
TOOL_CALLS=$(grep -cE "\"name\":\"(read|write|edit|bash|grep)\"" "$OUT_DIR/pi-stdout.log" || echo 0)
echo "GOAL: count = $GOAL_COUNT"
echo "Q=    count = $QMKRV_COUNT"
echo "<think> opens = $THINK_OPENS"
echo "tool calls = $TOOL_CALLS"

cat > "$OUT_DIR/summary.json" <<JSON
{
  "label": "$LABEL",
  "fsm_mode": $MODE,
  "duration_sec": $DURATION,
  "exit_code": $EXIT,
  "goal_triplet_count": $GOAL_COUNT,
  "qmkrv_count": $QMKRV_COUNT,
  "think_opens": $THINK_OPENS,
  "tool_calls": $TOOL_CALLS
}
JSON

echo "=== $(date) DONE [$LABEL] — see $OUT_DIR ==="
