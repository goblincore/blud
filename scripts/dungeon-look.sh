#!/usr/bin/env bash
# One command to SEE the dungeon. Boots a Vite dev server and a WebGPU-enabled
# headless Chrome if they are not already listening, captures sdf-game.html at
# a named pose, and stops only what it started.
#
#   scripts/dungeon-look.sh corridor            # -> /tmp/dungeon-look/corridor.png
#   scripts/dungeon-look.sh wall                # wall close-up, for specular
#   scripts/dungeon-look.sh beam                # a figure in the beam, for shadows
#   LOOK_POSE="1,2,0.5,0" scripts/dungeon-look.sh custom
#
# WHY THIS EXISTS: a dispatch agent with vision can verify a LOOK change by
# reading the PNG this writes — but only if getting a shot is one command and
# not "stand up a dev server and a headless Chrome by hand". Same lifecycle and
# the same shared scripts/lab-servers.sh as blob-shot.sh and sdf-bench.sh.
set -euo pipefail

NAME="${1:?usage: dungeon-look <corridor|wall|beam|room|custom> [outDir]}"
OUT="${2:-/tmp/dungeon-look}"
cd "$(dirname "$0")/.."

# Named poses: "x,z,yaw,pitch". Chosen to frame the three things this relight
# has to get right, so two runs of the same name are comparable A/B frames.
case "$NAME" in
  corridor) POSE="${LOOK_POSE:--7.4,-4.8,1.5707963,0}" ;;   # down a tunnel: falloff + fog
  wall)     POSE="${LOOK_POSE:--7.9,-5.5,3.1415927,0}" ;;   # close on stone: normal-map specular
  beam)     POSE="${LOOK_POSE:--7.4,-7.4,2.3561945,0}" ;;   # room1 spawn: figure lit by the beam
  room)     POSE="${LOOK_POSE:-4.8,4.8,3.1415927,0}" ;;     # room3 zombies (the gallery default)
  *)        POSE="${LOOK_POSE:?custom needs LOOK_POSE=\"x,z,yaw,pitch\"}" ;;
esac

# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up

LOOK_OUT="$OUT" LOOK_POSE="$POSE" \
  node scripts/gallery-look.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$NAME"
echo "shot: $OUT/$NAME.png  (pose $POSE)"
