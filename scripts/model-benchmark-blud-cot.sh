#!/bin/bash
# CoT-experiment blud bench. Runs 2 reasoning-heavy tasks (RNG + cultist
# port) inside a worktree of blud, scores correctness via tsc + vitest +
# task-specific gate, and dumps a JSON summary.
#
# Tasks deliberately need real reasoning so we can tell the difference
# between thinking modes:
#   2. nextGaussian via Box-Muller (math + test)
#   4. cultist hitscan jitter port (read tuning doc, unit conversion,
#                                  trig, write tested function)
#
# Usage: ./model-benchmark-blud-cot.sh <run-name> <output-dir>
#
# Assumes llama-serve-lil running on :8888 with the desired thinking +
# grammar config, and worktree at /tmp/blud-lil-bench at current main.

set -euo pipefail

RUN_NAME="${1:?Usage: model-benchmark-blud-cot.sh <run-name> <output-dir>}"
OUT_DIR="${2:?Specify output dir}"
WT="${BLUD_LIL_WT:-/tmp/blud-lil-bench}"
mkdir -p "$OUT_DIR"

if ! git -C "$WT" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "ERROR: $WT is not a git worktree"; exit 1
fi
if ! curl -sf "http://127.0.0.1:8888/health" > /dev/null 2>&1; then
  echo "ERROR: llama-server not responding on :8888"; exit 1
fi

reset_wt() {
  git -C "$WT" reset --hard b35d10a > /dev/null 2>&1
  git -C "$WT" clean -fd > /dev/null 2>&1
}

SUMMARY="$OUT_DIR/${RUN_NAME}-summary.json"
echo "{" > "$SUMMARY"
echo "  \"label\": \"$RUN_NAME\"," >> "$SUMMARY"
echo "  \"tasks\": [" >> "$SUMMARY"

# ---------------- task runner ----------------

run_task() {
  local task_num="$1"
  local task_name="$2"
  local prompt="$3"
  local quality_check="$4"   # bash snippet; runs in $WT, sets $task_pass=true|false and writes $task_notes
  local trailing="$5"        # "," or ""
  local outprefix="$OUT_DIR/${RUN_NAME}-task${task_num}"

  echo "=== Task $task_num: $task_name ==="
  reset_wt
  echo -n "  lil... "

  local START END ELAPSED
  START=$(date +%s)
  timeout 1500 lil --cwd "$WT" -p "$prompt" \
    > "${outprefix}-stdout.log" 2> "${outprefix}-stderr.log" || true
  END=$(date +%s)
  ELAPSED=$((END - START))

  git -C "$WT" status --short > "${outprefix}-gitstatus.txt"
  git -C "$WT" diff > "${outprefix}-diff.patch"
  local diff_lines stdout_bytes
  diff_lines=$(wc -l < "${outprefix}-diff.patch" | tr -d ' ')
  stdout_bytes=$(wc -c < "${outprefix}-stdout.log" | tr -d ' ')

  echo "done (${ELAPSED}s, diff=${diff_lines}L)"

  # Quality gate
  echo -n "  quality... "
  local task_pass=false
  local task_notes=""
  pushd "$WT" > /dev/null
  eval "$quality_check"
  popd > /dev/null
  echo "$task_pass ($task_notes)"

  printf '    {"task": %s, "name": "%s", "elapsed_s": %s, "diff_lines": %s, "stdout_bytes": %s, "pass": %s, "notes": "%s"}%s\n' \
    "$task_num" "$task_name" "$ELAPSED" "$diff_lines" "$stdout_bytes" "$task_pass" "${task_notes//\"/\\\"}" "$trailing" \
    >> "$SUMMARY"
}

# ---------------- task 2: nextGaussian ----------------

PROMPT_2="Add a nextGaussian() method to the SeededRng class in src/engine/rng.ts using the Box-Muller transform (return one normally-distributed number with mean 0 and stddev 1). Add a test in src/engine/rng.test.ts that draws 10000 samples and asserts (a) the sample mean is within 0.1 of 0, and (b) the sample stddev is within 0.1 of 1. Then run 'npx vitest run src/engine/rng.test.ts' to confirm; if it fails, fix it and re-run. Then run 'npx tsc --noEmit' to verify the project still compiles."

QC_2='
  task_pass=true; task_notes=""
  if ! grep -q "nextGaussian" src/engine/rng.ts 2>/dev/null; then
    task_pass=false; task_notes="no nextGaussian in rng.ts"
  elif ! grep -q "nextGaussian" src/engine/rng.test.ts 2>/dev/null; then
    task_pass=false; task_notes="no nextGaussian test"
  else
    if ! timeout 90 npx vitest run --test-timeout=20000 --bail=1 src/engine/rng.test.ts > /tmp/qc-vitest.log 2>&1; then
      task_pass=false; task_notes="vitest fail"
    elif ! npx tsc --noEmit > /tmp/qc-tsc.log 2>&1; then
      task_pass=false; task_notes="tsc fail"
    fi
  fi'

run_task 2 "nextGaussian" "$PROMPT_2" "$QC_2" ","

# ---------------- task 4: cultist jitter port ----------------

PROMPT_4="Port NotBlood'\''s difficulty-scaled hitscan jitter for the shotgun cultist into blud'\''s cultist AI.

NotBlood reference (from aicult.cpp:108-110, also in docs/tuning-sources.md): the shotgun cultist adds positional jitter to its hitscan target proportional to (5 - nDifficulty) * 1000 Build-engine units, where nDifficulty is 0..4 (0=easiest, 4=hardest).

Map this into a degree-based cone-jitter for blud'\''s pellet spread system in src/game/enemy/cultist-ai.ts. NotBlood'\''s Build units are 1024 per grid square; assume the cultist fires at ~5 grid squares (5120 units) to the player. Compute the half-angle degrees corresponding to (5 - difficulty) * 1000 lateral jitter at 5120 units distance — that is atan(jitter / 5120) * 180 / Math.PI degrees.

Add a pure exported function cultistJitterDegrees(difficulty: number): number to src/game/enemy/cultist-ai.ts. Add tests in src/game/enemy/cultist-ai.test.ts verifying values for difficulty 0..4 (use toBeCloseTo with 1 decimal precision). Then run 'npx vitest run src/game/enemy/cultist-ai.test.ts' to confirm pass; if it fails, fix it and re-run. Finally run 'npx tsc --noEmit' to verify the project compiles."

# Expected: D=0 ≈ 44.32°, D=1 ≈ 38.0°, D=2 ≈ 30.36°, D=3 ≈ 21.32°, D=4 ≈ 11.04°
# Quality check verifies the function exports + computes correctly via a probe script.
QC_4='
  task_pass=true; task_notes=""
  if ! grep -q "cultistJitterDegrees" src/game/enemy/cultist-ai.ts 2>/dev/null; then
    task_pass=false; task_notes="function missing"
  elif ! grep -q "cultistJitterDegrees" src/game/enemy/cultist-ai.test.ts 2>/dev/null; then
    task_pass=false; task_notes="test missing"
  else
    if ! timeout 90 npx vitest run --test-timeout=20000 --bail=1 src/game/enemy/cultist-ai.test.ts > /tmp/qc-vitest4.log 2>&1; then
      task_pass=false; task_notes="vitest fail"
    elif ! npx tsc --noEmit > /tmp/qc-tsc4.log 2>&1; then
      task_pass=false; task_notes="tsc fail"
    else
      # Numeric correctness probe — write a tiny script that imports and evaluates
      cat > /tmp/qc-probe.mts <<EOF
import { cultistJitterDegrees } from "./src/game/enemy/cultist-ai.ts";
const expected: Array<[number, number]> = [[0, 44.32], [1, 38.00], [2, 30.36], [3, 21.32], [4, 11.04]];
for (const [d, want] of expected) {
  const got = cultistJitterDegrees(d);
  if (Math.abs(got - want) > 0.5) {
    console.error("FAIL difficulty=" + d + " expected≈" + want + " got=" + got);
    process.exit(1);
  }
}
console.log("ok");
EOF
      cp /tmp/qc-probe.mts ./qc-probe.mts
      if ! npx tsx ./qc-probe.mts > /tmp/qc-probe.log 2>&1; then
        task_pass=false; task_notes="numeric values wrong: $(tail -3 /tmp/qc-probe.log | tr "\n" "|")"
      fi
      rm -f ./qc-probe.mts
    fi
  fi'

run_task 4 "cultist-jitter-port" "$PROMPT_4" "$QC_4" ""

echo "  ]" >> "$SUMMARY"
echo "}" >> "$SUMMARY"

reset_wt
echo ""
echo "=== Summary: $SUMMARY ==="
cat "$SUMMARY"
