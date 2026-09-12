#!/usr/bin/env bash
# scripts/neural-upscale/runpod/pack-exports.sh — <run root>/exports.tar.gz with every run's exports
# (model.json + parity fixtures, no checkpoints) and the grid summaries. The dashboard server serves it,
# so pull.sh can fetch it over the pod's proxy URL.
# Usage: pack-exports.sh <run root>
set -euo pipefail
ROOT=${1:?usage: pack-exports.sh <run root>}
cd "$ROOT"
ITEMS=()
for d in */exports; do [ -d "$d" ] && ITEMS+=("$d"); done
# Checkpoints are tiny (12-33 kB each) and CANNOT be regenerated once the pod is deleted: without
# them there is no resuming a run and no exporting a different step. Always take them.
for f in */ckpt-best.pt */ckpt-latest.pt; do [ -e "$f" ] && ITEMS+=("$f"); done
# The dashboard, so it still opens locally after the pod is gone.
for f in dashboard.json index.html img GRID_DONE.json STOPPED_AT_CAP GRID_FAILED.txt PREFLIGHT.json; do [ -e "$f" ] && ITEMS+=("$f"); done
[ ${#ITEMS[@]} -gt 0 ] || { echo "pack-exports.sh: nothing to pack in $ROOT" >&2; exit 1; }
COPYFILE_DISABLE=1 tar -czf exports.tar.gz.tmp "${ITEMS[@]}"
mv exports.tar.gz.tmp exports.tar.gz
echo "wrote $ROOT/exports.tar.gz ($(du -h exports.tar.gz | awk '{print $1}')): ${ITEMS[*]}"
