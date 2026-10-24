#!/usr/bin/env bash
# Compile a character's POLYGON kit from its .wam source into public/assets/lab/.
#
#   scripts/build-wam-kit.sh goblin
#
# WAM (https://github.com/elliottdehn/wam) is a text→glTF mesh compiler and
# lives OUTSIDE this repo, so it is not a build dependency: the compiled
# .gltf is committed and this script exists to regenerate it when the .wam
# changes. That is the same bargain the Blood sprite extractor makes — an
# external tool, a committed result, and a script recording exactly how one
# became the other — except the output here DOES ship, because it is authored
# art rather than an extracted placeholder.
#
# Set WAM_DIR if your checkout is elsewhere.
#
# POST-WAM MERGES. A kit may carry meshes WAM cannot author, merged into the
# compiled glTF after WAM by a deterministic script (both sources committed):
#
#   goblin-cinematic  the TEETH (goblin expressions Task 17): sculpted in
#                     Blender by assets-source/goblin-teeth/goblin_teeth.py ->
#                     goblin-teeth.glb, added by scripts/merge-kit-teeth.mjs as
#                     one skinned primitive (upper row on `skull`, lower on
#                     `jaw`) with its own `tooth` material and vertex colours.
#                     The .wam has no teeth; without this step the kit has none.
#   goblin, goblin-cinematic
#                     the BONY HANDS (2026-10-24): the FPV arm's own hand_L/R
#                     meshes from public/assets/lab/goblin-arm.glb, re-posed
#                     onto hand.l/hand.r by scripts/merge-kit-hands.ts as one
#                     `goblinskin` primitive. The .blob keeps a wrist knob.
set -euo pipefail

NAME="${1:?usage: build-wam-kit.sh <character>}"
WAM_DIR="${WAM_DIR:-$HOME/Projects/2026/wam}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/src/lab/sdf-zombie/characters/$NAME-kit.wam"
OUT="$REPO/public/assets/lab/$NAME-kit"

[ -f "$SRC" ] || { echo "no such kit source: $SRC" >&2; exit 1; }
[ -d "$WAM_DIR" ] || { echo "WAM not found at $WAM_DIR — set WAM_DIR" >&2; exit 1; }

# WAM writes <out>.gltf plus render sheets and a viewer JSON alongside. Only
# the .gltf ships; it is self-contained (buffer AND texture atlas are base64
# data URIs inside the JSON), so there are no sidecar files to keep in step.
( cd "$WAM_DIR" && python3 -m wam.cli "$SRC" -o "$OUT" )

# The sheets are review material, not assets — they would otherwise sit in
# public/ and get served.
rm -f "$OUT"_sheet.png "$OUT"_tex.png "$OUT"_viewer.json "$OUT"_bones.png

# Order matters: each merge strips only its OWN trailing block, so on a fresh WAM build the teeth go first and the hands
# last (re-running the teeth merge alone on a kit that already has hands refuses rather than guess).
case "$NAME" in
  goblin)
    npx tsx "$REPO/scripts/merge-kit-hands.ts" goblin "$OUT.gltf" ;;
  goblin-cinematic)
    node "$REPO/scripts/merge-kit-teeth.mjs" "$OUT.gltf" "$REPO/assets-source/goblin-teeth/goblin-teeth.glb"
    npx tsx "$REPO/scripts/merge-kit-hands.ts" goblin-cinematic "$OUT.gltf" ;;
esac

echo "wrote $OUT.gltf"
# A kit's skeleton is a TRANSCRIPTION of the character's .blob skeleton, in
# height fractions rather than metres and with the pitch sign flipped on every
# `down` bone. Nothing checks that the two are still in step — if the .blob
# skeleton moved, the plate now floats. See the header of the .wam.
echo "reminder: re-check $NAME-kit.wam's skeleton against $NAME.blob"
