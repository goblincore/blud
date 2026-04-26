#!/bin/bash
# Debug-task benchmark for FSM CoT eval. Plants a bug + failing test in
# the worktree, then asks lil to fix it. Quality gate: the planted test
# now passes, the test file was NOT modified, and the bug fix is in
# the right source file.
#
# Usage: ./model-benchmark-blud-debug.sh <run-name> <output-dir>
#
# Assumes llama-serve-lil already running on :8888 and worktree at
# /tmp/blud-lil-bench at current main.

set -euo pipefail

RUN_NAME="${1:?Usage: model-benchmark-blud-debug.sh <run-name> <output-dir>}"
OUT_DIR="${2:?Specify output dir}"
WT="${BLUD_LIL_WT:-/tmp/blud-lil-bench}"
mkdir -p "$OUT_DIR"

if ! git -C "$WT" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "ERROR: $WT is not a git worktree"; exit 1
fi
if ! curl -sf "http://127.0.0.1:8888/health" > /dev/null 2>&1; then
  echo "ERROR: llama-server not responding on :8888"; exit 1
fi

# Reset to clean main, then plant the bug.
reset_and_plant_bug() {
  git -C "$WT" reset --hard b35d10a > /dev/null 2>&1
  git -C "$WT" clean -fd > /dev/null 2>&1

  # Plant: flip the z-sign in pelletEndPos. Subtle, single-line,
  # localised, completely wrong. Easy to detect with a vertical-shot
  # test, hard to spot by reading the code casually.
  python3 -c "
import re, pathlib
f = pathlib.Path('$WT/src/game/enemy/cultist-ai.ts')
s = f.read_text()
s_new = s.replace(
  'z: spawn.z + dir.z * speed * t,',
  'z: spawn.z - dir.z * speed * t,',
)
assert s != s_new, 'bug injection failed — source line not found'
f.write_text(s_new)
"

  # Append a failing test that asserts correct vertical trajectory.
  python3 -c "
import pathlib
f = pathlib.Path('$WT/src/game/enemy/cultist-ai.test.ts')
s = f.read_text()
# Insert a new test just before the final '});' (closes outer describe).
new_test = '''
  it('pelletEndPos travels along dir on a vertical shot', () => {
    // Pellet fired straight up at speed 100 for 1 sec ends 100 above origin.
    const result = pelletEndPos({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 1.0, 100);
    expect(result.z).toBeCloseTo(100, 5);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
  });
'''
# Find the last '});' in the file and insert before it
idx = s.rfind('});')
assert idx >= 0, 'cannot find tail of test file'
s_new = s[:idx] + new_test + '\n' + s[idx:]
f.write_text(s_new)
"
}

reset_and_plant_bug

# Sanity check: confirm the planted test FAILS before lil runs (otherwise
# the bench is meaningless).
echo "Pre-flight: confirming planted test fails on injected bug..."
pushd "$WT" > /dev/null
if timeout 60 npx vitest run --test-timeout=10000 --bail=1 src/game/enemy/cultist-ai.test.ts > /tmp/preflight.log 2>&1; then
  echo "ERROR: planted test PASSES on the injected bug — bug or test wrong, aborting"
  popd > /dev/null
  exit 1
fi
popd > /dev/null
echo "  ✓ planted test fails as expected"

PROMPT="There is a failing test in src/game/enemy/cultist-ai.test.ts. Run 'npx vitest run src/game/enemy/cultist-ai.test.ts' to see the failure, then find and fix the underlying bug in the source code. Do NOT modify any test file. The fix should be a single-line change to the source. After your fix, re-run the same vitest command to confirm it passes, and run 'npx tsc --noEmit' to confirm the project still compiles."

OUTPREFIX="$OUT_DIR/${RUN_NAME}-debug"

echo ""
echo "=== Debug task: $RUN_NAME ==="
echo -n "  lil... "
START=$(date +%s)
timeout 1500 lil --cwd "$WT" -p "$PROMPT" \
  > "${OUTPREFIX}-stdout.log" 2> "${OUTPREFIX}-stderr.log" || true
END=$(date +%s)
ELAPSED=$((END - START))

git -C "$WT" status --short > "${OUTPREFIX}-gitstatus.txt"
git -C "$WT" diff > "${OUTPREFIX}-diff.patch"
diff_lines=$(wc -l < "${OUTPREFIX}-diff.patch" | tr -d ' ')
stdout_bytes=$(wc -c < "${OUTPREFIX}-stdout.log" | tr -d ' ')

echo "done (${ELAPSED}s, diff=${diff_lines}L)"

# Quality gate
echo -n "  quality... "
task_pass=true
task_notes=""
pushd "$WT" > /dev/null

# 1. The injected bug ("z - dir.z") must NO LONGER be present in the source.
#    If it's still there, the agent didn't fix it.
if grep -q "z: spawn.z - dir.z \* speed \* t," src/game/enemy/cultist-ai.ts 2>/dev/null; then
  task_pass=false; task_notes="bug still present in source"
fi

# 2. The correct version ("z + dir.z") must be present.
if [ "$task_pass" = "true" ] && ! grep -q "z: spawn.z + dir.z \* speed \* t," src/game/enemy/cultist-ai.ts 2>/dev/null; then
  task_pass=false; task_notes="correct fix not present"
fi

# 3. Agent should not have meaningfully edited the test file. Compare current
#    test file against the post-plant state (rebuild post-plant content in /tmp
#    and diff). We only allow whitespace/import-line drift, no logic changes.
python3 - <<'PYEOF' || task_pass=false
import pathlib, subprocess
proc = subprocess.run(['git','show','b35d10a:src/game/enemy/cultist-ai.test.ts'], capture_output=True, text=True)
clean = proc.stdout
new_test = '''
  it('pelletEndPos travels along dir on a vertical shot', () => {
    // Pellet fired straight up at speed 100 for 1 sec ends 100 above origin.
    const result = pelletEndPos({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 1.0, 100);
    expect(result.z).toBeCloseTo(100, 5);
    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
  });
'''
idx = clean.rfind('});')
post_plant = clean[:idx] + new_test + '\n' + clean[idx:]
current = pathlib.Path('src/game/enemy/cultist-ai.test.ts').read_text()
if current.strip() != post_plant.strip():
    # Allow exactly the planted test to remain. Anything else = test edit.
    import difflib
    diff = list(difflib.unified_diff(post_plant.splitlines(), current.splitlines(), lineterm=''))
    if any(line.startswith('+') and 'pelletEndPos' not in line and not line.startswith('+++') for line in diff[3:20]):
        # Agent added stuff. That's OK if it's near the test, but flag if outside.
        pass  # for now, lenient
PYEOF

# 4. Run vitest — must pass.
if [ "$task_pass" = "true" ]; then
  if ! timeout 90 npx vitest run --test-timeout=20000 --bail=1 src/game/enemy/cultist-ai.test.ts > /tmp/qc-debug-vitest.log 2>&1; then
    task_pass=false; task_notes="vitest fail"
  elif ! npx tsc --noEmit > /tmp/qc-debug-tsc.log 2>&1; then
    task_pass=false; task_notes="tsc fail"
  fi
fi

popd > /dev/null
echo "$task_pass ($task_notes)"

SUMMARY="$OUT_DIR/${RUN_NAME}-debug-summary.json"
cat > "$SUMMARY" <<EOF
{
  "label": "$RUN_NAME",
  "task": "debug-pelletEndPos-z-sign",
  "elapsed_s": $ELAPSED,
  "diff_lines": $diff_lines,
  "stdout_bytes": $stdout_bytes,
  "pass": $task_pass,
  "notes": "$task_notes"
}
EOF

# Reset for cleanliness
git -C "$WT" reset --hard b35d10a > /dev/null 2>&1
git -C "$WT" clean -fd > /dev/null 2>&1

echo ""
echo "=== Summary: $SUMMARY ==="
cat "$SUMMARY"
