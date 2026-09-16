#!/usr/bin/env bash
# scripts/gib-assets-gate.sh — Task 3's visual + performance gate driver.
#
# Owns its vite + Chrome through scripts/lab-servers.sh (reuse-safe: a server
# the owner already has open is left running and only what STARTED here is
# stopped). NEVER kill a server you did not start.
#
#   scripts/gib-assets-gate.sh <outRoot> [group]
#
# Groups:
#   core      zombie + soldier A/B and the A/A noise floor, anatomy + normal
#   wound     partial-wound legs (stamped slug craters) A/B
#   multi     several simultaneous bodies A/B
#   budget    tight live-piece budget
#   reset     resetGibAssets -> re-arm
#   deferred  the optional deferred renderer path
#   perf      loader / explosion / moving-gib frame cost A/B
#   all       every group above
#
# Ports are overridable to coexist with the owner's own lab sessions:
#   LAB_VITE_PORT=5297 LAB_CDP_PORT=9297 scripts/gib-assets-gate.sh ...
set -euo pipefail
cd "$(dirname "$0")/.."
export LAB_VITE_PORT="${LAB_VITE_PORT:-5297}"
export LAB_CDP_PORT="${LAB_CDP_PORT:-9297}"
OUT="${1:-.lab-tmp/gib-assets-gate}"
GROUP="${2:-all}"
mkdir -p "$OUT"

# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up

FRAMES="${GA_FRAMES:-90}"
SETTLE="${GA_SETTLE_STEPS:-240}"
FAILED=()

run_look() {
  local name="$1" kind="$2" view="$3" qs="$4"; shift 4
  echo ""
  echo "=== $name  [$qs] ==="
  # A failed leg is RECORDED, not fatal: the visual and perf legs are
  # independent evidence, and aborting on the first one loses the rest of the
  # gate (which is what happened the first run). The script still exits non-zero
  # at the end so a caller cannot mistake a partial run for a pass.
  if ! env GA_KIND="$kind" GA_VIEW="$view" "$@" \
    node scripts/sdf-gib-assets-look.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT/$name" "$qs"; then
    echo "LEG FAILED: $name" >&2
    FAILED+=("$name")
  fi
}

diffpair() {
  local name="$1" a="$2" b="$3"
  if [ ! -d "$OUT/$a" ] || [ ! -d "$OUT/$b" ]; then
    echo "  diff $name: SKIPPED (a leg is missing)"
    return 0
  fi
  node scripts/gib-assets-diff.mjs "$OUT/$a" "$OUT/$b" "$OUT/diff-$name.json" >/dev/null
  node -e "
    const d = require('./$OUT/diff-$name.json');
    console.log('  diff $name: mean ' + (d.summary?.meanPctGt12 ?? '?') + '% px>12, max '
      + (d.summary?.maxPctGt12 ?? '?') + '%, meanAbs ' + (d.summary?.meanMeanAbs ?? '?') + '/255');
  "
}

group_core() {
  run_look zombie-march  zombie  threequarter 'gibrender=march'  GA_FRAMES="$FRAMES" GA_SETTLE="$SETTLE" GA_HIDE_FX=0
  run_look zombie-assets zombie  threequarter 'gibrender=assets' GA_FRAMES="$FRAMES" GA_SETTLE="$SETTLE" GA_HIDE_FX=0
  run_look zombie-march-aa zombie threequarter 'gibrender=march' GA_FRAMES="$FRAMES" GA_SETTLE="$SETTLE" GA_HIDE_FX=0
  # SOLDIERS ARE NOT IN THE ARENA. `game-level.ts` gives room 5 (the annex) five
  # zombies and three soldiers, so the soldier A/B is fought there at a shorter
  # standoff (the annex is a normal-sized room). The runs at the top of this file
  # are the arena.
  run_look soldier-march  soldier threequarter 'gibrender=march'  GA_ROOM=5 GA_DIST=3 GA_FRAMES="$FRAMES" GA_SETTLE="$SETTLE" GA_HIDE_FX=0
  run_look soldier-assets soldier threequarter 'gibrender=assets' GA_ROOM=5 GA_DIST=3 GA_FRAMES="$FRAMES" GA_SETTLE="$SETTLE" GA_HIDE_FX=0
  # ANATOMY-ONLY: every fire/smoke/ring layer killed so the released meshes are
  # the only moving thing in frame (the plan's diagnostic sheets).
  run_look anatomy-march  zombie  front 'gibrender=march'  GA_FRAMES=60 GA_SETTLE=0 GA_HIDE_FX=1
  run_look anatomy-assets zombie  front 'gibrender=assets' GA_FRAMES=60 GA_SETTLE=0 GA_HIDE_FX=1
  diffpair zombie-ab  zombie-march    zombie-assets
  diffpair zombie-aa  zombie-march    zombie-march-aa
  diffpair soldier-ab soldier-march   soldier-assets
  diffpair anatomy-ab anatomy-march   anatomy-assets
}

group_wound() {
  run_look wounds-march  zombie front 'gibrender=march'  GA_FRAMES=80 GA_SETTLE=200 GA_HIDE_FX=1 GA_WOUNDS=4
  run_look wounds-assets zombie front 'gibrender=assets' GA_FRAMES=80 GA_SETTLE=200 GA_HIDE_FX=1 GA_WOUNDS=4
  diffpair wounds-ab wounds-march wounds-assets
}

group_multi() {
  run_look multi-march  zombie threequarter 'gibrender=march'  GA_FRAMES=90 GA_SETTLE=240 GA_HIDE_FX=1 GA_EXTRA=2
  run_look multi-assets zombie threequarter 'gibrender=assets' GA_FRAMES=90 GA_SETTLE=240 GA_HIDE_FX=1 GA_EXTRA=2
  diffpair multi-ab multi-march multi-assets
}

group_budget() {
  run_look tight-assets zombie threequarter 'gibrender=assets&maxchunks=24&gibspritelive=24&gibspriterest=8' GA_FRAMES=90 GA_SETTLE=200 GA_HIDE_FX=1 GA_EXTRA=2
}

group_reset() {
  run_look reset-assets zombie threequarter 'gibrender=assets' GA_FRAMES=30 GA_SETTLE=120 GA_HIDE_FX=1 GA_POST_RESET=1
}

group_deferred() {
  run_look deferred-march  zombie threequarter 'renderer=deferred&gibrender=march'  GA_FRAMES=60 GA_SETTLE=180 GA_HIDE_FX=1
  run_look deferred-assets zombie threequarter 'renderer=deferred&gibrender=assets' GA_FRAMES=60 GA_SETTLE=180 GA_HIDE_FX=1
  diffpair deferred-ab deferred-march deferred-assets
}

group_perf() {
  for leg in march march-aa assets; do
    echo ""
    echo "=== perf-$leg ==="
    node scripts/sdf-gib-assets-perf.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT/perf-$leg" "gibrender=$([ "$leg" = assets ] && echo assets || echo march)"
  done
}

run_head() {
  local name="$1" qs="$2"
  echo ""
  echo "=== $name  [$qs] ==="
  env HEAD_KIND=zombie HEAD_DIST=1.25 \
    node scripts/sdf-gib-assets-head.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT/$name" "$qs"
}

group_head() {
  run_head head-march  'gibrender=march'
  run_head head-assets 'gibrender=assets'
  diffpair head-ab head-march head-assets
}

case "$GROUP" in
  core) group_core ;;
  wound) group_wound ;;
  multi) group_multi ;;
  budget) group_budget ;;
  reset) group_reset ;;
  deferred) group_deferred ;;
  perf) group_perf ;;
  head) group_head ;;
  all)
    group_core
    group_wound
    group_multi
    group_budget
    group_reset
    group_deferred
    group_head
    group_perf
    ;;
  *) echo "unknown group '$GROUP'" >&2; exit 2 ;;
esac

echo ""
echo "gate group '$GROUP' complete -> $OUT"
if [ ${#FAILED[@]} -ne 0 ]; then
  echo "FAILED LEGS (${#FAILED[@]}): ${FAILED[*]}" >&2
  exit 1
fi
