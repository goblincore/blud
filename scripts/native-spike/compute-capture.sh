#!/usr/bin/env bash
# THE COMPUTE-MARCH SPIKE'S CAPTURES (docs/dev-notes/2026-11-10-compute-march-spike/NOTES.md): the shipped page
# (lean walk and tile reference list on, hull exit bound on), three frozen scenes, each captured as shipped (-ship)
# and with the flat-albedo seam on (-flat: the walk without the post-hit chain) from one boot.
#
#   scripts/native-spike/compute-capture.sh [outDir] [scenes]     (default .scratch/compute, "closeup crowd mob")
#
# Take the GPU lock first; LAB_VITE_PORT / LAB_CDP_PORT pick the servers (default 5391 / 9391).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-.scratch/compute}"
SCENES="${2:-closeup crowd mob}"
NOTE=docs/dev-notes/2026-11-10-compute-march-spike
export LAB_TMP="${LAB_TMP:-.lab-tmp}" LAB_VITE_PORT="${LAB_VITE_PORT:-5391}" LAB_CDP_PORT="${LAB_CDP_PORT:-9391}"
export SPIKE_QUERY="${SPIKE_QUERY:-frozen=1}"
export SPIKE_VARIANTS='ship=0;flat=__sdfGame.setFlatAlbedo(true)'
cap() { scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$OUT/$1"; }
for s in $SCENES; do
  case "$s" in
    closeup) SPIKE_SCENE=closeup SPIKE_PRELUDE="$(cat "$NOTE/prelude-closeup.js")" cap closeup ;;
    crowd) SPIKE_SCENE=crowd SPIKE_CROWD=12 SPIKE_PRELUDE='__sdfGame.setHullExitBound(true); __sdfGame.step(4);' cap crowd ;;
    mob) SPIKE_SCENE=asis SPIKE_PRELUDE="$(cat "$NOTE/prelude-mob.js")" cap mob ;;
    *) echo "compute-capture: unknown scene $s" >&2; exit 2 ;;
  esac
done
