#!/usr/bin/env bash
# scripts/neural-upscale/runpod/pack.sh — one tarball with a dataset v2 and the trainer, for
# `runpodctl send`. It unpacks on the pod as /workspace/<dataset name>/ and /workspace/neural-upscale/.
# Usage: pack.sh <dataset dir> [out.tar]
set -euo pipefail
die() { echo "pack.sh: $*" >&2; exit 1; }

DATA=${1:-}
[ -n "$DATA" ] || die "usage: pack.sh <dataset dir> [out.tar]"
DATA=$(cd "$DATA" && pwd)
NAME=$(basename "$DATA")
OUT=${2:-$HOME/blud-upscale-data/upload/$NAME-upload.tar}
REPO=$(cd "$(dirname "$0")/../../.." && pwd)

python3 - "$DATA/manifest.json" <<'PY' || die "$DATA is not a blud-upscale-dataset/2 capture"
import json, sys
m = json.load(open(sys.argv[1]))
assert m.get("format") == "blud-upscale-dataset/2", m.get("format")
splits = [p["split"] for p in m["pairs"]]
print(f"dataset {sys.argv[1]}: {len(splits)} pairs ({splits.count('train')} train, {splits.count('val')} val)")
PY

mkdir -p "$(dirname "$OUT")"
# COPYFILE_DISABLE keeps macOS tar from adding ._ AppleDouble files.
COPYFILE_DISABLE=1 tar -cf "$OUT" --exclude '__pycache__' --exclude '.pytest_cache' --exclude '*.log' \
  -C "$(dirname "$DATA")" "$NAME" -C "$REPO/scripts" neural-upscale
echo "wrote $OUT ($(du -h "$OUT" | awk '{print $1}'))"
echo "next: runpodctl send \"$OUT\"   (then, in the pod's web terminal: cd /workspace && runpodctl receive <code>)"
