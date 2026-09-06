#!/usr/bin/env bash
# Run the four sdf-game gates and print a one-line verdict each.
#
#   scripts/game-gate-baseline.sh [outdir]
#
# WHY THIS EXISTS. Every task in the character-view refactor says "the four
# game gates unmoved" — but "unmoved from what" was never recorded, and the
# first failure (the slug gate, 2026-09-06) was therefore unattributable: it
# cost a checkout of the previous commit and a full re-run to learn it had
# been red all along. This is that reference.
#
# THESE ARE THRESHOLD GATES, NOT HASH GATES. Unlike the lab captures, the game
# is not reproducible byte-for-byte across runs — bodies wander, so a target's
# position differs run to run (measured: -4.67,-4.85 vs -4.79,-4.81 on two runs
# of the same code). Compare the PASS/FAIL verdicts, never the numbers.
#
# THE BLEED GATE REWRITES TRACKED FILES. sdf-game-bleed-gate.mjs re-captures
# its own evidence PNGs into docs/dev-notes/2026-08-31-bleeding-wounds/ every
# run, so it always leaves ten modified files behind. This script restores them
# afterwards; if you run that gate by hand, `git checkout --` that directory or
# you will commit them by accident and they will look like intentional updates.
#
# Argument shapes differ per gate and are NOT interchangeable — bleed takes a
# MODE first (passing it a port yields "unknown mode: 5295").
set -uo pipefail
OUT="${1:-/tmp/game-gates}"
mkdir -p "$OUT"
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5303}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9283}"
. scripts/lab-servers.sh
trap 'lab_servers_down' EXIT
lab_servers_up

declare -a NAMES=(crowd bleed slug shorty)
fails=0
: > "$OUT/VERDICTS"
for g in "${NAMES[@]}"; do
  case "$g" in
    bleed) args=(parity "$LAB_VITE_PORT" "$LAB_CDP_PORT") ;;
    *)     args=("$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT/$g") ;;
  esac
  echo "[gate] $g"
  timeout 420 node "scripts/sdf-game-$g-gate.mjs" "${args[@]}" </dev/null > "$OUT/$g.log" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then v=PASS; else v="FAIL(rc=$rc)"; fails=$((fails+1)); fi
  echo "$g $v" >> "$OUT/VERDICTS"
  echo "[gate] $g -> $v"
done

git checkout -- docs/dev-notes/2026-08-31-bleeding-wounds/ 2>/dev/null || true
sort -o "$OUT/VERDICTS" "$OUT/VERDICTS"
echo "--- verdicts ---"; cat "$OUT/VERDICTS"
[ "$fails" -eq 0 ] && echo "[gate] ALL PASS" || echo "[gate] $fails FAILED"
