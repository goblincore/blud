#!/bin/bash
# Run TRIPLET then QMKRV sequentially, then restore the daily-driver server.
# Each run is up to 60 min, so total wall up to ~2 hours.
set -uo pipefail

cd "$HOME/Projects/blud/docs/dev-notes/qmkrv-ab"

echo "=== $(date) ORCHESTRATE START ==="

bash ./run-ab.sh 1 triplet || echo "triplet run errored, continuing"
bash ./run-ab.sh 2 qmkrv   || echo "qmkrv run errored, continuing"

# Restore the daily-driver server (FSM unset = OFF)
pkill -f "llama-server" 2>/dev/null || true
sleep 3
nohup "$HOME/Projects/TheTom-llama-cpp-turboquant/build/bin/llama-server" \
  -m "$HOME/models/qwen3.6-vl-reap-26b-text-Q4_K_M.gguf" \
  --host 127.0.0.1 --port 8888 -ngl 99 -c 65536 -np 1 \
  -ctk q8_0 -ctv turbo3 -fa on --no-context-shift \
  --jinja --chat-template-kwargs '{"enable_thinking":true,"preserve_thinking":true}' \
  --reasoning auto --spec-type ngram-simple --draft-max 8 --draft-min 2 --draft-p-min 0.75 \
  > /tmp/llama-server-restored.log 2>&1 &
echo "[orchestrate] daily-driver restored (pid $!)"

# Final summary
echo "=== $(date) ORCHESTRATE DONE ==="
for label in triplet qmkrv; do
  echo "--- $label ---"
  cat "$HOME/Projects/blud/docs/dev-notes/qmkrv-ab/$label/summary.json" 2>/dev/null || echo "(missing)"
done
