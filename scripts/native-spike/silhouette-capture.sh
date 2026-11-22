#!/usr/bin/env bash
# THE SILHOUETTE SPIKE'S CAPTURES (docs/dev-notes/2026-11-10-silhouette-spike/NOTES.md): one frozen frame, its
# `sdf:march` pass captured from ONE boot at several march scales, the light and probe clocks pinned:
#
#   -s100   the march at output resolution (800 x 600): the ground truth
#   -e100   the same with the flat-albedo seam on (the walk without the post-hit chain): the edge rays' program
#   -s50    the shipped scale (400 x 300)
#   -s375, -s25   lower scales (300 x 225, 200 x 150)
#   -s100b  output resolution again, last: what two captures of one scale differ by
#
#   scripts/native-spike/silhouette-capture.sh [outDir] [scenes]     (default .scratch/sil, "closeup mob")
#
# Take the GPU lock first; LAB_VITE_PORT / LAB_CDP_PORT pick the servers (default 5391 / 9391).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-.scratch/sil}"
SCENES="${2:-closeup mob}"
NOTE=docs/dev-notes/2026-11-10-compute-march-spike
export LAB_TMP="${LAB_TMP:-.lab-tmp}" LAB_VITE_PORT="${LAB_VITE_PORT:-5391}" LAB_CDP_PORT="${LAB_CDP_PORT:-9391}"
export SPIKE_QUERY="${SPIKE_QUERY:-frozen=1}"
# Any scale but the shipped one drops the upscale stage, and dropping it turns the interlaced fields on (half the
# rows a frame). So each variant sets its scale, turns the fields off, and sets the scale AGAIN: setSdfScale sizes the
# one-pixel hit tolerance (aaCfg.x) from the target's height at that moment, and the first call saw half the rows
# (bodies a few pixels fat). The other order does not work: the first scale change turns the fields back on.
sc() { echo "(__sdfGame.setSdfScale($1), __sdfGame.setFieldMode(false), __sdfGame.setSdfScale($1))"; }
export SPIKE_VARIANTS="s100=$(sc 1);e100=__sdfGame.setFlatAlbedo(true);s50=(__sdfGame.setFlatAlbedo(false), $(sc 0.5));s375=$(sc 0.375);s25=$(sc 0.25);s100b=$(sc 1)"
PIN='(() => { __sdfGame.setLightClockFrozen(true); __sdfGame.setLightTime(0); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); })();'
cap() { scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT/$1"; }
for s in $SCENES; do
  case "$s" in
    closeup) SPIKE_SCENE=closeup SPIKE_PRELUDE="$PIN $(cat "$NOTE/prelude-closeup.js")" cap closeup ;;
    mob) SPIKE_SCENE=asis SPIKE_PRELUDE="$PIN $(cat "$NOTE/prelude-mob.js")" cap mob ;;
    mobw) SPIKE_SCENE=asis SPIKE_PRELUDE="$PIN $(cat "$NOTE/prelude-mob-wounded.js")" cap mobw ;;
    *) echo "silhouette-capture: unknown scene $s" >&2; exit 2 ;;
  esac
done
