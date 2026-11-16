#!/usr/bin/env bash
# Rebuild public/assets/lab/skeleton-kit.glb from the zombie's rig as it now is, then hold it to the body.
# Needs Blender (BLENDER=/path/to/blender to say where). Run from the repository root.
set -euo pipefail
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
TMP="${TMPDIR:-/tmp}/skeleton-kit-rig.json"
npx tsx scripts/skeleton-kit/export-rig.ts zombie "$TMP"
"$BLENDER" -b --python scripts/skeleton-kit/build_kit.py -- "$TMP" public/assets/lab/skeleton-kit.glb | tee "$TMP.log" | grep -E '^\{|Error|error' || true
grep -q '^{' "$TMP.log" || { echo 'build_kit.py did not finish: no kit written' >&2; exit 1; }
npx tsx scripts/skeleton-kit/check-kit.ts zombie public/assets/lab/skeleton-kit.glb
