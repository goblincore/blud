#!/usr/bin/env bash
# scripts/neural-upscale/runpod/bootstrap-pod.sh — runs ON the pod (OWNER starts it from the pod's
# web terminal). Serves the dashboard on :8080, runs the grid under the spend meter, packs the exports,
# waits a grace period for pull.sh, then stops the pod.
# Usage: bash /workspace/neural-upscale/runpod/bootstrap-pod.sh --data /workspace/<dataset> --hourly-usd <price>
#        [--cap-usd 10] [--root /workspace/runs/p3] [--grace-min 40] [--runs s16-rgbd,...] [--no-stop] [--dry-run]
# It re-launches itself under nohup, so closing the terminal does not stop training. Log: /workspace/bootstrap.log
set -euo pipefail

DATA=""
HOURLY=""
CAP="10"
ROOT="/workspace/runs/p3"
GRACE_MIN=40
RUNS=""
STOP=1
DRY=0
die() { echo "bootstrap-pod.sh: $*" >&2; exit 1; }

ARGS=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --data) DATA=${2:?}; shift 2 ;;
    --hourly-usd) HOURLY=${2:?}; shift 2 ;;
    --cap-usd) CAP=${2:?}; shift 2 ;;
    --root) ROOT=${2:?}; shift 2 ;;
    --grace-min) GRACE_MIN=${2:?}; shift 2 ;;
    --runs) RUNS=${2:?}; shift 2 ;;
    --no-stop) STOP=0; shift ;;
    --dry-run) DRY=1; shift ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$DATA" ] && [ -f "$DATA/manifest.json" ] || die "--data <dataset dir with manifest.json> is required"
[ -n "$HOURLY" ] || die "--hourly-usd <the pod's hourly price> is required (the spend meter uses it)"
HERE=$(cd "$(dirname "$0")/.." && pwd)
# RUNPOD_POD_ID is in the container's own environment, but an ssh session does NOT inherit it, and
# without it the stop at the end dies on set -u. PID 1 always has it; fall back to that, and let the
# caller override.
if [ -z "${RUNPOD_POD_ID:-}" ] && [ -r /proc/1/environ ]; then
  RUNPOD_POD_ID=$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^RUNPOD_POD_ID=//p' | head -1)
  export RUNPOD_POD_ID
fi

GRID=(python -m nupscale.grid --data "$DATA" --root "$ROOT" --hourly-usd "$HOURLY" --cap-usd "$CAP" --reserve-min "$GRACE_MIN")
[ -n "$RUNS" ] && GRID+=(--runs "$RUNS")
if [ "$DRY" -eq 1 ]; then
  printf 'would serve %s on :8080\nwould run (in %s):' "$ROOT" "$HERE"; printf ' %q' "${GRID[@]}" --started-at '<container start>'; printf '\n'
  echo "would pack exports, wait $GRACE_MIN min, then $([ "$STOP" -eq 1 ] && echo 'stop the pod' || echo 'leave the pod running')"
  exit 0
fi

if [ -z "${BLUD_BOOTSTRAP_CHILD:-}" ]; then
  BLUD_BOOTSTRAP_CHILD=1 nohup bash "$0" "${ARGS[@]}" > /workspace/bootstrap.log 2>&1 &
  echo "started in the background (pid $!). Follow it with: tail -f /workspace/bootstrap.log"
  echo "dashboard: https://${RUNPOD_POD_ID:-<pod id>}-8080.proxy.runpod.net"
  exit 0
fi

echo "== $(date -u +%FT%TZ) bootstrap on pod ${RUNPOD_POD_ID:-unknown}"
python -c 'import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available())'
# numpy<2 on purpose: the RunPod torch 2.1 image is compiled against numpy 1.x, and an unpinned
# "numpy>=1.24" happily installs numpy 2.x, after which every torch import fails. Only install what
# is missing, so a working image is left alone.
python -c "import numpy" 2>/dev/null || python -m pip install -q "numpy>=1.24,<2"
python -c "import PIL" 2>/dev/null || python -m pip install -q "pillow>=9.0"
python -c "import numpy, torch, PIL; print('deps ok: numpy', numpy.__version__, 'torch', torch.__version__, 'pillow', PIL.__version__)"
# Billing starts when the container starts; PID 1's start time is the closest thing the pod can see.
STARTED_AT=$(date -d "$(ps -o lstart= -p 1)" +%s)
mkdir -p "$ROOT"
nohup python -m http.server 8080 --directory "$ROOT" > /workspace/http.log 2>&1 &
HTTP_PID=$!

set +e
(cd "$HERE" && "${GRID[@]}" --started-at "$STARTED_AT") > /workspace/grid.log 2>&1
GRID_EXIT=$?
set -e
echo "== $(date -u +%FT%TZ) grid exited $GRID_EXIT (log /workspace/grid.log)"
bash "$HERE/runpod/pack-exports.sh" "$ROOT" || echo "no exports to pack"

if [ "$STOP" -eq 1 ]; then
  echo "== waiting $GRACE_MIN min so pull.sh can fetch https://${RUNPOD_POD_ID:-<pod id>}-8080.proxy.runpod.net/exports.tar.gz"
  sleep $(( GRACE_MIN * 60 ))
  kill "$HTTP_PID" 2>/dev/null || true
  echo "== $(date -u +%FT%TZ) stopping pod ${RUNPOD_POD_ID:-unknown}"
  runpodctl pod stop "${RUNPOD_POD_ID:?}" || runpodctl stop pod "${RUNPOD_POD_ID:?}" \
    || echo "COULD NOT STOP THE POD — stop it from the RunPod console now"
fi
