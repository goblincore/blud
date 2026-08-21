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

echo "wrote $OUT.gltf"
# A kit's skeleton is a TRANSCRIPTION of the character's .blob skeleton, in
# height fractions rather than metres and with the pitch sign flipped on every
# `down` bone. Nothing checks that the two are still in step — if the .blob
# skeleton moved, the plate now floats. See the header of the .wam.
echo "reminder: re-check $NAME-kit.wam's skeleton against $NAME.blob"
