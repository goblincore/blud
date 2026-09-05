#!/bin/bash
# Compare local vs cloud Tommy-cultist implementations.
# Runs the same QC against each worktree and dumps a summary.
#
# Usage: ./compare-tommy-impls.sh
#
# Reads from:
#   /tmp/blud-lil-bench                                   (local lil run)
#   ~/.claude/dispatch/worktrees/2026-04-26-blud-tommy-cultist-bench  (cloud)

set -uo pipefail

LOCAL_WT="/tmp/blud-lil-bench"
CLOUD_WT="$HOME/.claude/dispatch/worktrees/2026-04-26-blud-tommy-cultist-bench"

print_qc() {
  local label="$1"
  local wt="$2"

  echo "==========================="
  echo "  $label"
  echo "  $wt"
  echo "==========================="

  if [ ! -d "$wt" ]; then
    echo "  ✗ worktree does not exist"
    return
  fi

  pushd "$wt" > /dev/null

  # 1. tsc check
  if npx tsc --noEmit > /tmp/cmp-tsc.log 2>&1; then
    echo "  tsc:        ✓ pass"
  else
    echo "  tsc:        ✗ fail   (head of error: $(head -3 /tmp/cmp-tsc.log | tr '\n' ' '))"
  fi

  # 2. cultist tests pass
  if timeout 120 npx vitest run --test-timeout=30000 src/game/enemy/cultist-ai.test.ts > /tmp/cmp-vitest.log 2>&1; then
    pass_count=$(grep -oE "Tests +[0-9]+ passed" /tmp/cmp-vitest.log | grep -oE "[0-9]+" | head -1)
    echo "  vitest:     ✓ pass  ($pass_count tests)"
  else
    fail_count=$(grep -oE "Tests +[0-9]+ failed" /tmp/cmp-vitest.log | grep -oE "[0-9]+" | head -1)
    echo "  vitest:     ✗ fail  (failures: ${fail_count:-?})"
  fi

  # 3. Existing tests not destroyed — count pre-existing test names still present
  preserved=0
  for testname in "returns 0 for single pellet" "fans pellets evenly across" "true when self is within range" "Idle" "Chase" "Aim" "Fire" "Recoil" "Dead" "Burning"; do
    if grep -q "$testname" src/game/enemy/cultist-ai.test.ts 2>/dev/null; then
      preserved=$((preserved + 1))
    fi
  done
  echo "  preserved:  $preserved / 10 prior test markers"

  # 4. NotBlood values plumbed
  echo "  Tommy values found in source/tests:"
  for tag in "TOMMY_CULTIST" "fireMode\|FirePolicy\|TommyCultistBrain" "1200" "Random3" "tommy" "kVectorBullet\|7"; do
    found=$(grep -l "$tag" src/game/enemy/cultist-ai.ts src/game/enemy/cultist-ai.test.ts src/game/gibs/tuning.ts 2>/dev/null | wc -l | tr -d ' ')
    echo "    - $tag: in $found file(s)"
  done

  # 5. Files changed
  echo "  files changed:"
  git status --short 2>/dev/null | head -10 | sed 's/^/    /'

  popd > /dev/null
  echo ""
}

print_qc "LOCAL (lil + Qwen3.6-28B-REAP, FSM-think)" "$LOCAL_WT"
print_qc "CLOUD (deepseek-v4-pro via dispatch)"      "$CLOUD_WT"
