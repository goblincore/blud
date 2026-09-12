#!/usr/bin/env bash
# scripts/neural-upscale/runpod/launch.sh — create the P3 training pod (OWNER ONLY).
# Prints the GPU, price, volume and estimated total. DRY RUN unless --yes: without --yes it never
# calls runpodctl. Needs the RunPod API key already configured by the owner (runpodctl doctor).
# Runbook: docs/dev-notes/2026-09-11-neural-upscale/p3-runbook.md
set -euo pipefail

GPU_ID="NVIDIA GeForce RTX 4090"
CLOUD="COMMUNITY"
TEMPLATE="runpod-torch-v21"
NAME="blud-upscale-p3"
HOURLY=""
CAP="10"
DATA=""
RUNS=6
RUN_MIN=25
OVERHEAD=1.15
SETUP_MIN=20
GRACE_MIN=40
YES=0

usage() {
  cat <<EOF
usage: launch.sh --dataset <dir> --hourly-usd <price> [--gpu-id "<id>"] [--cloud-type COMMUNITY|SECURE]
                 [--template-id <id>] [--cap-usd 10] [--name <pod name>] [--yes]
  --hourly-usd  the pod's price per hour for --gpu-id, read from 'runpodctl gpu list' or the console
  --yes         actually create the pod (only after the owner has approved the printed estimate)
EOF
}
die() { echo "launch.sh: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dataset) DATA=${2:?}; shift 2 ;;
    --hourly-usd) HOURLY=${2:?}; shift 2 ;;
    --gpu-id) GPU_ID=${2:?}; shift 2 ;;
    --cloud-type) CLOUD=${2:?}; shift 2 ;;
    --template-id) TEMPLATE=${2:?}; shift 2 ;;
    --cap-usd) CAP=${2:?}; shift 2 ;;
    --name) NAME=${2:?}; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument $1" ;;
  esac
done

[ -n "$DATA" ] && [ -f "$DATA/manifest.json" ] || die "--dataset <dir with manifest.json> is required (it sizes the volume)"
[ -n "$HOURLY" ] || die "--hourly-usd is required: read the price for \"$GPU_ID\" from 'runpodctl gpu list' or the RunPod console"

DATA_KB=$(du -sk "$DATA" | awk '{print $1}')
VOLUME_GB=$(( DATA_KB / 1048576 * 3 + 10 ))
read -r HOURS EST OK < <(python3 - "$RUNS" "$RUN_MIN" "$OVERHEAD" "$SETUP_MIN" "$GRACE_MIN" "$HOURLY" "$CAP" <<'PY'
import sys
runs, run_min, overhead, setup_min, grace_min, hourly, cap = map(float, sys.argv[1:])
hours = (runs * run_min * overhead + setup_min + grace_min) / 60
est = hours * hourly
print(f"{hours:.2f} {est:.2f} {'yes' if est <= cap else 'no'}")
PY
)

cat <<EOF
Pod plan (P3 grid):
  GPU            $GPU_ID ($CLOUD cloud), template $TEMPLATE
  price          \$$HOURLY / hour
  volume         ${VOLUME_GB} GB at /workspace (dataset $((DATA_KB / 1024)) MB x3 + 10 GB); container disk 20 GB
  ports          8080/http (dashboard), 22/tcp
  estimate       $HOURS h = $RUNS runs x $RUN_MIN min x $OVERHEAD + $SETUP_MIN min setup + $GRACE_MIN min pull grace
  estimated cost \$$EST (cap \$$CAP; the grid's spend meter stops at the cap)
EOF
[ "$OK" = yes ] || die "the estimate \$$EST is over the \$$CAP cap — nothing created"

CMD=(runpodctl pod create --template-id "$TEMPLATE" --gpu-id "$GPU_ID" --cloud-type "$CLOUD"
     --container-disk-in-gb 20 --volume-in-gb "$VOLUME_GB" --ports "8080/http,22/tcp" --name "$NAME")
printf 'command:'; printf ' %q' "${CMD[@]}"; printf '\n'
if [ "$YES" -ne 1 ]; then
  echo "DRY RUN — nothing was created. Re-run with --yes once the owner approves this estimate."
  exit 0
fi

OUT=$("${CMD[@]}")
echo "$OUT"
POD_ID=$(printf '%s' "$OUT" | python3 -c 'import json, sys; d = json.load(sys.stdin); print(d.get("id") or d.get("podId") or "")' || true)
[ -n "$POD_ID" ] || die "could not read the pod id from runpodctl's output above; find it with: runpodctl pod list"
cat <<EOF
Created pod $POD_ID. Billing has started.
  dashboard (after bootstrap): https://$POD_ID-8080.proxy.runpod.net
  status:                      runpodctl pod get $POD_ID
  stop:                        scripts/neural-upscale/runpod/stop.sh $POD_ID
EOF
