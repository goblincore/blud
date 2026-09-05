#!/bin/bash
# blud-specific lil bench — runs 3 realistic agent-loop tasks inside a
# git worktree of blud. Each task resets the worktree, runs lil, then
# captures: (a) files changed, (b) git diff, (c) test-run outcome.
#
# This tests lil's agent-loop value-add (Read/Grep/Edit/Bash cycles)
# against the curl baseline, which can't do any of these.
#
# Usage: ./model-benchmark-blud.sh <run-name> <output-dir>
#
# Assumes llama-serve-lil on :8888 and worktree at /tmp/blud-lil-bench.

set -euo pipefail

RUN_NAME="${1:?Usage: model-benchmark-blud.sh <run-name> <output-dir>}"
OUT_DIR="${2:?Specify output dir}"
WT="${BLUD_LIL_WT:-/tmp/blud-lil-bench}"
mkdir -p "$OUT_DIR"

if [ ! -d "$WT/.git" ] && [ ! -f "$WT/.git" ]; then
  echo "ERROR: worktree $WT not set up. Run: git worktree add $WT HEAD"
  exit 1
fi
if ! curl -sf "http://127.0.0.1:8888/health" > /dev/null 2>&1; then
  echo "ERROR: llama-server not responding on port 8888"
  exit 1
fi

reset_wt() {
  (cd "$WT" && git checkout -- . && git clean -fd) > /dev/null 2>&1
}

run_task() {
  local task_num="$1"
  local task_name="$2"
  local prompt="$3"
  local outprefix="$OUT_DIR/${RUN_NAME}-task${task_num}"

  echo "=== Task $task_num: $task_name ==="
  reset_wt
  echo -n "  Running... "

  local START END ELAPSED
  START=$(date +%s)
  timeout 1200 lil --cwd "$WT" -p "$prompt" \
    > "${outprefix}-stdout.log" 2> "${outprefix}-stderr.log" || true
  END=$(date +%s)
  ELAPSED=$((END - START))

  # Capture what changed
  (cd "$WT" && git status --short) > "${outprefix}-gitstatus.txt"
  (cd "$WT" && git diff) > "${outprefix}-diff.patch"
  (cd "$WT" && git diff --stat) > "${outprefix}-diffstat.txt"

  local changed stdout_bytes diff_lines
  changed=$(grep -cE "^ [MD]|^[?AM]" "${outprefix}-gitstatus.txt" || echo 0)
  stdout_bytes=$(wc -c < "${outprefix}-stdout.log" | tr -d ' ')
  diff_lines=$(wc -l < "${outprefix}-diff.patch" | tr -d ' ')

  echo "done (${ELAPSED}s, changed=${changed} files, diff=${diff_lines}L, stdout=${stdout_bytes}B)"

  # Run any tests affected
  local test_log="${outprefix}-test.log"
  (cd "$WT" && timeout 120 npx vitest run 2>&1 | tail -15) > "$test_log" || true
  local test_tail
  test_tail=$(grep -E "Test Files|Tests " "$test_log" | head -2 | tr '\n' ';')
  echo "  tests: ${test_tail}"
}

echo "Blud lil bench: $RUN_NAME (worktree: $WT)"
echo "Output: $OUT_DIR/"
echo ""

# Task 1 — Bash sanity: can the agent run a command and read output?
run_task 1 "tool-use sanity" "Run the test suite with 'npx vitest run' and tell me: (a) how many tests pass, (b) the 3 test files with the longest duration. Do not modify any code."

# Task 2 — Single-file feature add with test + verify loop
run_task 2 "SeededRng.nextGaussian" "Add a nextGaussian() method to the SeededRng class in src/engine/rng.ts using the Box-Muller transform. It should return a normally-distributed number with mean 0 and stddev 1. Add a test in src/engine/rng.test.ts that draws 10000 samples and asserts the sample mean is within 0.1 of 0 and the sample stddev is within 0.1 of 1. Then run 'npx vitest run src/engine/rng.test.ts' to confirm it passes; if it fails, fix it and re-run."

# Task 3 — Multi-file grep-and-edit
run_task 3 "post-fx name fields" "Find every post-fx Effect class in src/vfx/post-fx/ (the classes that extend Effect from postprocessing). For each one, add a 'readonly name: string' class field initialised to the class's own name (e.g. 'palette-dither' for PaletteDitherEffect, kebab-case). Then confirm the project still builds with 'npx tsc --noEmit'."

echo ""
echo "=== Done. Artefacts in $OUT_DIR/ ==="
reset_wt
ls "$OUT_DIR/${RUN_NAME}"*.txt 2>/dev/null | head
