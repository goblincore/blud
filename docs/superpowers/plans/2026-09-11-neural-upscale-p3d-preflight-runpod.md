# Neural Upscale P3d — Pre-flight and RunPod Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two things:
- write the RunPod scripts, syntax- and dry-run-checked but never executed against RunPod;
- prove the whole pipeline locally on the 60 P2 smoke pairs (spec §6 pre-flight): train → export → G3 parity → pull round trip → dashboard → in-game smoke.

Then write the owner's runbook.

**Architecture:**
- `nupscale/preflight.py` runs a short local training and checks it.
- `scripts/neural-upscale/runpod/` holds six bash scripts:
  - `pack.sh` — dataset plus trainer into one tarball;
  - `launch.sh` — estimate, then create the pod, only with `--yes`;
  - `bootstrap-pod.sh` — on the pod: dashboard server, grid, pack exports, grace period, stop;
  - `pack-exports.sh`;
  - `pull.sh` — fetch exports, install them in `.upscale-models/`, run G3 on each;
  - `stop.sh`.
- The pre-flight exercises `pack-exports.sh` and `pull.sh` against a local `http.server`, exactly as they will run against the pod's proxy.

**Tech Stack:** bash, Python + PyTorch via `uv`, tsx, Node CDP scripts.

**Depends on:** P3b (trainer) and P3c (in-game loader, `scripts/upscale-trained-parity.ts`, `scripts/upscale-trained-smoke.mjs`) merged into this branch. P3a is not needed.

**Read first:** `docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md` §0 and §3. Spec: `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md` §4 and §6.

**Harness:** Task 1 runs anywhere. Task 2 needs Chrome and the GPU, so run it on `pi`. Task 3 runs anywhere.

**Money rule (contracts §0.7).** No task runs `launch.sh --yes`, `bootstrap-pod.sh` without `--dry-run`, `stop.sh`, or any `runpodctl` command. Task 1 proves the dry run never reaches `runpodctl`. Agents never read, print or set API keys.

**Python command used below.** Run from the repo root, with `<args>` replaced:

```bash
(cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt --with pytest python <args>)
```

**Verified while writing this plan:**
- Every script passes `bash -n`, and the dry run never called a fake `runpodctl`.
- `pack.sh` packed the 60-pair pre-flight dataset (225 MB) without `__pycache__` or `._` files.
- `pull.sh --url` against a local server installed `s8-rgb-best` and `s8-rgb-final`, both G3 PASS (2.4e-7).
- The pre-flight passed in 24 s on MPS.
- The in-game smoke passed on the pulled `s8-rgb-best`.

---

### Task 1: RunPod scripts (written and dry-run only)

**Files:**
- Create: `scripts/neural-upscale/runpod/launch.sh`, `pack.sh`, `pack-exports.sh`, `bootstrap-pod.sh`, `pull.sh`, `stop.sh`

- [ ] **Step 1: `launch.sh`**

`scripts/neural-upscale/runpod/launch.sh`:

```bash
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
```

- [ ] **Step 2: `pack.sh` and `pack-exports.sh`**

`scripts/neural-upscale/runpod/pack.sh`:

```bash
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
```

`scripts/neural-upscale/runpod/pack-exports.sh`:

```bash
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
for f in dashboard.json GRID_DONE.json STOPPED_AT_CAP GRID_FAILED.txt PREFLIGHT.json; do [ -e "$f" ] && ITEMS+=("$f"); done
[ ${#ITEMS[@]} -gt 0 ] || { echo "pack-exports.sh: nothing to pack in $ROOT" >&2; exit 1; }
COPYFILE_DISABLE=1 tar -czf exports.tar.gz.tmp "${ITEMS[@]}"
mv exports.tar.gz.tmp exports.tar.gz
echo "wrote $ROOT/exports.tar.gz ($(du -h exports.tar.gz | awk '{print $1}')): ${ITEMS[*]}"
```

- [ ] **Step 3: `bootstrap-pod.sh`**

This runs on the pod, which is Linux. It uses GNU `date -d`, so it won't run on macOS except with `--dry-run`, which returns before that line.

`scripts/neural-upscale/runpod/bootstrap-pod.sh`:

```bash
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
python -m pip install -q "numpy>=1.24" "pillow>=9.0"
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
```

- [ ] **Step 4: `pull.sh` and `stop.sh`**

`scripts/neural-upscale/runpod/pull.sh`:

```bash
#!/usr/bin/env bash
# scripts/neural-upscale/runpod/pull.sh — fetch exports.tar.gz from a run root's web server, install
# every export into the dev model store, and run G3 parity on each.
# Usage: pull.sh <pod id>            (fetches https://<pod id>-8080.proxy.runpod.net/exports.tar.gz)
#        pull.sh --url <base url>     (any server; the pre-flight uses a local http.server)
# Store: $UPSCALE_MODELS_DIR or <repo>/.upscale-models; an existing model of the same name is replaced.
set -euo pipefail
die() { echo "pull.sh: $*" >&2; exit 1; }

case "${1:-}" in
  --url) BASE=${2:?usage: pull.sh --url <base url>}; TAG=local ;;
  ""|-h|--help) die "usage: pull.sh <pod id> | pull.sh --url <base url>" ;;
  *) BASE="https://$1-8080.proxy.runpod.net"; TAG=$1 ;;
esac
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
DEST=${UPSCALE_MODELS_DIR:-$REPO/.upscale-models}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fsSL "$BASE/exports.tar.gz" -o "$WORK/exports.tar.gz" || die "could not fetch $BASE/exports.tar.gz"
tar -xzf "$WORK/exports.tar.gz" -C "$WORK"
mkdir -p "$DEST/_pulled/$TAG"
for f in dashboard.json GRID_DONE.json STOPPED_AT_CAP GRID_FAILED.txt PREFLIGHT.json; do
  [ -e "$WORK/$f" ] && cp "$WORK/$f" "$DEST/_pulled/$TAG/"
done

INSTALLED=()
FAILED=()
for dir in "$WORK"/*/exports/*/; do
  [ -f "$dir/model.json" ] || continue
  name=$(basename "$dir")
  rm -rf "${DEST:?}/$name"
  cp -R "$dir" "$DEST/$name"
  if (cd "$REPO" && npx tsx scripts/upscale-trained-parity.ts "$DEST/$name"); then INSTALLED+=("$name"); else FAILED+=("$name"); fi
done
[ ${#INSTALLED[@]} -gt 0 ] || [ ${#FAILED[@]} -gt 0 ] || die "no exports in $BASE/exports.tar.gz"
echo "installed into $DEST: ${INSTALLED[*]:-none}"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "G3 PARITY FAILED (do not load these in-game): ${FAILED[*]}"
  exit 1
fi
echo "summaries kept in $DEST/_pulled/$TAG/. In-game: /sdf-game.html?upscale=trained&upscalemodel=<name>"
```

`scripts/neural-upscale/runpod/stop.sh`:

```bash
#!/usr/bin/env bash
# scripts/neural-upscale/runpod/stop.sh — stop the training pod and show its state (OWNER ONLY; uses the API key).
# Usage: stop.sh <pod id>
set -euo pipefail
POD_ID=${1:?usage: stop.sh <pod id>}
runpodctl pod stop "$POD_ID"
runpodctl pod get "$POD_ID"
cat <<EOF
Stopped. A stopped pod still bills for its volume disk.
  once the exports are pulled and checked: runpodctl pod delete $POD_ID
  check actual spend:                     runpodctl billing
EOF
```

- [ ] **Step 5: Syntax**

```bash
chmod +x scripts/neural-upscale/runpod/*.sh
for f in scripts/neural-upscale/runpod/*.sh; do bash -n "$f" && echo "syntax ok $f"; done
command -v shellcheck && shellcheck scripts/neural-upscale/runpod/*.sh || echo "shellcheck not installed (optional)"
```

Expected: six `syntax ok` lines. If shellcheck is installed, fix its errors; its style notes are optional.

- [ ] **Step 6: Dry runs prove `runpodctl` is never called**

```bash
(cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt python -c "from tests.helpers import write_v2_dataset; write_v2_dataset('/tmp/p3d-synth-ds', pairs=6)") 2>/dev/null || test -f /tmp/p3d-synth-ds/manifest.json
rm -rf /tmp/p3d-fakebin && mkdir -p /tmp/p3d-fakebin
printf '#!/bin/sh\necho CALLED >> /tmp/p3d-fakebin/called\nexit 99\n' > /tmp/p3d-fakebin/runpodctl && chmod +x /tmp/p3d-fakebin/runpodctl
R=scripts/neural-upscale/runpod
$R/launch.sh --help
PATH=/tmp/p3d-fakebin:$PATH $R/launch.sh --dataset /tmp/p3d-synth-ds --hourly-usd 0.69; echo "exit $?"
PATH=/tmp/p3d-fakebin:$PATH $R/launch.sh --dataset /tmp/p3d-synth-ds --hourly-usd 0.69 --cap-usd 1; echo "exit $?"
test ! -e /tmp/p3d-fakebin/called && echo "runpodctl never called"
PATH=/tmp/p3d-fakebin:$PATH bash $R/bootstrap-pod.sh --data /tmp/p3d-synth-ds --hourly-usd 0.69 --dry-run
test ! -e /tmp/p3d-fakebin/called && echo "runpodctl still never called"
```

Expected:
- The first launch prints the plan (`estimate 3.88 h …`, `estimated cost $2.67`), the command, and `DRY RUN — nothing was created`, then `exit 0`.
- The second prints `… over the $1 cap — nothing created`, then `exit 1`.
- Both `never called` lines appear.
- The bootstrap dry run prints `would run … python -m nupscale.grid …`.

If a `never called` line is missing, the script reached `runpodctl`: fix it before anything else.

- [ ] **Step 7: Pack**

```bash
scripts/neural-upscale/runpod/pack.sh /tmp/p3d-synth-ds /tmp/p3d-pack/up.tar
tar -tf /tmp/p3d-pack/up.tar | awk -F/ '{print $1"/"$2}' | sort -u
tar -tf /tmp/p3d-pack/up.tar | grep -c '__pycache__\|/\._' || true
```

Expected:
- `dataset …: 6 pairs (4 train, 2 val)`;
- a listing that includes `p3d-synth-ds/manifest.json`, `neural-upscale/nupscale` and `neural-upscale/runpod`;
- a count of `0`.

- [ ] **Step 8: Commit**

```bash
git add scripts/neural-upscale/runpod
git commit -m "feat(upscale P3d): RunPod pack/launch/bootstrap/pull/stop scripts (dry-run by default, never run by agents)"
```

---

### Task 2: Local pre-flight

**Files:**
- Create: `scripts/neural-upscale/nupscale/preflight.py`, `scripts/neural-upscale/tests/test_preflight.py`
- Create: `docs/dev-notes/2026-09-11-neural-upscale/p3-preflight.md`
- Modify: `TASKS.md`

Harness: `pi` (Step 7 needs Chrome and the GPU).

- [ ] **Step 1: Write the failing test**

`scripts/neural-upscale/tests/test_preflight.py`:

```python
import json

from nupscale.preflight import run_preflight
from tests.helpers import write_v2_dataset


def test_preflight_report(tmp_path):
    root = tmp_path / "pre"
    report = run_preflight(write_v2_dataset(tmp_path / "ds", pairs=6), root, steps=20, batch=4, val_every=10,
                           budget_s=600, device="cpu")
    assert set(report["checks"]) == {"trainingFinished", "lossFell", "beatsNearestOnTrain", "exportsWritten", "withinBudget"}
    assert report["checks"]["trainingFinished"] and report["checks"]["exportsWritten"] and report["checks"]["withinBudget"]
    assert json.loads((root / "PREFLIGHT.json").read_text()) == report
    assert (root / "index.html").exists() and (root / "dashboard.json").exists()
```

Run the Python command with `-m pytest -q -p no:cacheprovider tests/test_preflight.py`. Expected: `ModuleNotFoundError: No module named 'nupscale.preflight'`.

- [ ] **Step 2: Implement**

`scripts/neural-upscale/nupscale/preflight.py`:

```python
"""Pre-flight (spec §6): a local smoke training that must pass before any pod launch.

Usage: python -m nupscale.preflight --data /tmp/blud-upscale-data/preflight-v2 --root /tmp/blud-upscale-runs/preflight
Checks: training loss falls; the model beats nearest on its own training pairs (an overfit sanity
check, not a quality result); best and final exports exist; the run fits in the time budget.
Writes <root>/PREFLIGHT.json and exits 1 when a check fails.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import torch

from .dashboard import Dashboard
from .data import load_dataset
from .evaluate import evaluate, predict_model, predict_nearest
from .model import Upscaler
from .train import RunConfig, pick_device, prepare_dashboard, train_run


def run_preflight(data: str | Path, root: str | Path, *, model_id: str = "s8", inputs: str = "rgb", steps: int = 600,
                  batch: int = 16, val_every: int = 200, budget_s: float = 600, device: str = "auto") -> dict:
    root = Path(root)
    dev = pick_device(device)
    t0 = time.monotonic()
    ds = load_dataset(data)
    dash = Dashboard(root, ds)
    baselines = prepare_dashboard(dash, ds)
    cfg = RunConfig(model_id, inputs, max_steps=steps, time_cap_s=budget_s, val_every=val_every, log_every=10, batch=batch)
    result = train_run(cfg, ds, root, device=dev, dashboard=dash, baselines=baselines)
    losses = [t[1] for t in dash.run(cfg.name)["train"]]
    head, tail = losses[:3], losses[-3:]

    ck = torch.load(root / cfg.name / "ckpt-latest.pt", map_location="cpu", weights_only=True)
    model = Upscaler(model_id, inputs)
    model.load_state_dict(ck["model"])
    train = ds.split("train")
    model_train = evaluate(lambda p: predict_model(model, p, ds.near, ds.far, torch.device("cpu")), train)
    nearest_train = evaluate(predict_nearest, train)
    exports = root / cfg.name / "exports"
    seconds = time.monotonic() - t0
    checks = {
        "trainingFinished": result["state"] == "done",
        "lossFell": bool(head and tail and sum(tail) / len(tail) < sum(head) / len(head)),
        "beatsNearestOnTrain": model_train["overall"] is not None and nearest_train["overall"] is not None
        and model_train["overall"] < nearest_train["overall"],
        "exportsWritten": all((exports / f"{cfg.name}-{k}" / "model.json").exists() for k in ("best", "final")),
        "withinBudget": seconds <= budget_s,
    }
    report = {
        "pass": all(checks.values()), "checks": checks, "device": str(dev), "seconds": round(seconds, 1),
        "run": result, "lossHead": head, "lossTail": tail,
        "train": {"model": model_train["overall"], "nearest": nearest_train["overall"]},
        "val": {"model": (result["best"] or {}).get("overall"), "nearest": baselines["nearest"]["overall"],
                "bicubic": baselines["bicubic"]["overall"]},
        "exports": {k: str(exports / f"{cfg.name}-{k}") for k in ("best", "final")},
    }
    (root / "PREFLIGHT.json").write_text(json.dumps(report, indent=1))
    return report


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Neural upscale pre-flight: local smoke training (spec §6).")
    ap.add_argument("--data", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--model", default="s8", choices=["s8", "s16", "s32"])
    ap.add_argument("--inputs", default="rgb", choices=["rgb", "rgbd"])
    ap.add_argument("--steps", type=int, default=600)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--val-every", type=int, default=200)
    ap.add_argument("--budget-min", type=float, default=10.0)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args(argv)
    report = run_preflight(args.data, args.root, model_id=args.model, inputs=args.inputs, steps=args.steps,
                           batch=args.batch, val_every=args.val_every, budget_s=args.budget_min * 60, device=args.device)
    print(json.dumps(report, indent=1))
    print("PREFLIGHT: PASS" if report["pass"] else "PREFLIGHT: FAIL")
    sys.exit(0 if report["pass"] else 1)


if __name__ == "__main__":
    main()
```

Run the Python command with `-m pytest -q -p no:cacheprovider tests/test_preflight.py`. Expected: `1 passed`.

- [ ] **Step 3: The smoke pairs**

```bash
ls /tmp/blud-upscale-data/smoke-2026-09-11-r4/manifest.json
```

If that file is missing (`/tmp` was cleared), regenerate the 60 P2 pairs. This takes about 15 minutes of GPU time:

```bash
LAB_VITE_PORT=5325 LAB_CDP_PORT=9325 UPSCALE_OUT=/tmp/blud-upscale-data/smoke-2026-09-11-r4 UPSCALE_DUMP_CHECK=1 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs' 2>&1 | tail -20
```

Expected: the G2 checks pass and 60 frames are written (see `docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md`).

Then convert them, unless a converted copy already exists:

```bash
test -f /tmp/blud-upscale-data/preflight-v2/manifest.json || \
(cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt python -m nupscale.convert_p2 /tmp/blud-upscale-data/smoke-2026-09-11-r4 /tmp/blud-upscale-data/preflight-v2)
```

- [ ] **Step 4: Run the pre-flight**

```bash
rm -rf /tmp/blud-upscale-runs/preflight
(cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt python -m nupscale.preflight --data /tmp/blud-upscale-data/preflight-v2 --root /tmp/blud-upscale-runs/preflight) 2>&1 | tail -40
```

Expected: `PREFLIGHT: PASS`, with all five checks true. The reference run on MPS:
- 24 s in total;
- loss 0.085 → 0.054;
- on its training pairs, model 0.0322 vs nearest 0.0335;
- on validation, model 0.0220, nearest 0.0228, bicubic 0.0213.

A CPU-only machine is slower but must stay inside the 10-minute budget. A FAIL is a finding: write it down, don't tune it away (contracts §0.2).

- [ ] **Step 5: Pack, serve and pull (the pod round trip, locally)**

```bash
bash scripts/neural-upscale/runpod/pack-exports.sh /tmp/blud-upscale-runs/preflight
python3 -m http.server 8768 --bind 127.0.0.1 --directory /tmp/blud-upscale-runs/preflight > /tmp/p3d-http.log 2>&1 &
echo $! > /tmp/p3d-http.pid
sleep 1
bash scripts/neural-upscale/runpod/pull.sh --url http://127.0.0.1:8768; echo "pull exit $?"
```

Expected:
- `wrote …/exports.tar.gz`;
- four `PASS` lines and `G3: PASS` for each of `s8-rgb-best` and `s8-rgb-final`;
- `installed into …/.upscale-models: s8-rgb-best s8-rgb-final`;
- `pull exit 0`.

Leave the server running for Step 6.

- [ ] **Step 6: The dashboard serves and is complete**

```bash
curl -fsS http://127.0.0.1:8768/ | grep -c 'Blud neural upscale'
python3 - <<'PY'
import json, urllib.request
base = "http://127.0.0.1:8768/"
d = json.load(urllib.request.urlopen(base + "dashboard.json"))
run = d["runs"][0]
assert run["state"] == "done" and run["val"], run["state"]
assert set(d["baselines"]) >= {"nearest", "bicubic"}, d["baselines"].keys()
pairs = d["showcase"]["pairs"]
assert pairs, "no showcase pairs"
paths = list(pairs[0]["base"].values()) + list(d["showcase"]["runs"][run["name"]]["best"].values())[:1]
for p in paths:
    assert urllib.request.urlopen(base + p).status == 200, p
print("dashboard OK:", run["name"], "step", run["step"], len(pairs), "showcase pairs,", len(paths), "images fetched")
PY
kill "$(cat /tmp/p3d-http.pid)"
```

Expected: `1`, then `dashboard OK: s8-rgb step 600 12 showcase pairs, 4 images fetched`.

- [ ] **Step 7: The pulled model in the game**

```bash
UPSCALE_SMOKE_MODEL=s8-rgb-best LAB_VITE_PORT=5324 LAB_CDP_PORT=9324 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-trained-smoke.mjs' 2>&1 | tee /tmp/p3d-smoke.log | tail -20
```

Expected: `SMOKE: PASS`. The reference self-check was sp/dc `maxRelRgb` 1.28e-3 with 0 mismatches.

- [ ] **Step 8: Notes and TASKS**

Create `docs/dev-notes/2026-09-11-neural-upscale/p3-preflight.md` with:
- date, checkout SHA, device;
- the verdict: **PASS** only if Steps 4–7 all passed;
- a table of the `PREFLIGHT.json` checks and numbers (seconds, loss head and tail, train model vs nearest, val model/nearest/bicubic);
- the G3 lines for both exports;
- the pull output line;
- the dashboard check line;
- the smoke's `self-check:` line and result;
- anything that needed a retry.

In `TASKS.md`, `## Neural upscale (ESPCN family)` section, add:

```
- [x] P3d pre-flight PASS on the 60 smoke pairs: train, G3, pull round trip, dashboard, in-game smoke (`p3-preflight.md`).
```

(Write `[ ]` and FAIL instead if it failed.)

- [ ] **Step 9: Commit**

```bash
git add scripts/neural-upscale/nupscale/preflight.py scripts/neural-upscale/tests/test_preflight.py docs/dev-notes/2026-09-11-neural-upscale/p3-preflight.md TASKS.md
git commit -m "test(upscale P3d): local pre-flight — train, export, G3 parity, pull round trip, dashboard, in-game smoke"
```

---

### Task 3: Owner runbook

**Files:**
- Create: `docs/dev-notes/2026-09-11-neural-upscale/p3-runbook.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Write the runbook**

`docs/dev-notes/2026-09-11-neural-upscale/p3-runbook.md`:

````markdown
# Neural upscale P3 — owner runbook

From capture to a trained model in the game. Every step that costs money or touches the RunPod API
key is **yours**; agents never run them.

- Spec: `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md`
- Budget: **$10 cap**. The estimate for one RTX 4090 at $0.69/h is about **3.9 h ≈ $2.70**
  (6 runs × 25 min, plus setup and a 40-minute pull window).

## 0. Check the pre-flight passed

`p3-preflight.md` in this folder must say **PASS**. It covers local training, G3 parity, the pull
round trip, the dashboard and the in-game smoke. Don't launch a pod otherwise.

## 1. Capture the dataset (local, hours)

On a quiet machine. Re-running the same command resumes. Details are in `p3a-capture.md`.

```bash
mkdir -p ~/blud-upscale-data
LAB_VITE_PORT=5320 LAB_CDP_PORT=9320 UPSCALE_NAME=v2-2026-09-12 UPSCALE_PAIRS=1000 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-v2.mjs' 2>&1 | tee ~/blud-upscale-data/v2-2026-09-12.log
uv run scripts/upscale-dataset-check.py ~/blud-upscale-data/v2-2026-09-12
```

## 2. RunPod API key (once)

```bash
runpodctl doctor      # asks for the key from https://www.runpod.io/console/user/settings and saves it
runpodctl user        # shows your account and balance, so the key works
```

## 3. Pick a GPU and read its price

```bash
runpodctl gpu list
```

Pick one GPU with at least 24 GB that is in stock on community cloud. The RTX 4090 is the default;
an RTX 3090 or A5000 also works. Note its hourly price.

## 4. Pack, read the estimate, launch

```bash
scripts/neural-upscale/runpod/pack.sh ~/blud-upscale-data/v2-2026-09-12
scripts/neural-upscale/runpod/launch.sh --dataset ~/blud-upscale-data/v2-2026-09-12 --hourly-usd <price>         # dry run: read it
scripts/neural-upscale/runpod/launch.sh --dataset ~/blud-upscale-data/v2-2026-09-12 --hourly-usd <price> --yes   # creates the pod; billing starts
```

For another GPU, add `--gpu-id "<id from gpu list>"`. Note the pod id it prints.

## 5. Upload and start training

```bash
runpodctl send ~/blud-upscale-data/upload/v2-2026-09-12-upload.tar     # prints a one-time code
```

In the RunPod console, open the pod → **Connect** → **Web terminal**:

```bash
cd /workspace && runpodctl receive <code> && tar -xf v2-2026-09-12-upload.tar
bash /workspace/neural-upscale/runpod/bootstrap-pod.sh --data /workspace/v2-2026-09-12 --hourly-usd <price>
```

It starts in the background and prints the dashboard link. Closing the terminal is fine.

## 6. Watch the dashboard

`https://<pod id>-8080.proxy.runpod.net` opens on any device and refreshes every 30 s. The link is
unlisted but not password-protected; it shows only crops and numbers.

- **Runs table:** each number is the error against the clean supersampled picture, so lower is
  better. Green means the run beats plain bicubic resizing. **G4 pass** means it's worth trying in-game.
- **Curves:** train loss should fall. The validation lines should cross under the dashed bicubic
  line, especially on face, wound, edge, medium and far.
- **Showcase:** the same crop as nearest | bicubic | model | native | supersampled target.

The grid takes about 3 hours. Pod logs are `/workspace/grid.log` and `/workspace/bootstrap.log`.
If anything looks wrong: `scripts/neural-upscale/runpod/stop.sh <pod id>`.

## 7. Pull the models (within 40 minutes of the grid finishing)

When every run shows done (or the page shows `STOPPED_AT_CAP`):

```bash
scripts/neural-upscale/runpod/pull.sh <pod id>
```

It installs every export into `.upscale-models/` and runs G3 parity on each. Never load a model
whose parity fails.

## 8. Stop, delete, check the bill

The pod stops itself 40 minutes after the grid ends. Confirm it has, then delete it once the pull
has worked; a stopped pod still bills for its disk.

```bash
runpodctl pod get <pod id>
runpodctl pod delete <pod id>
runpodctl billing
```

## 9. Judge it in the game

```bash
npm run dev
```

Open `/sdf-game.html?upscale=trained&upscalemodel=<name>`. Use the name of the best G4-passing
export, for example `s16-rgbd-best`.

Press **U** to cycle **native** (full-resolution render) → **nearest** (blocky 2×) → **model**.
The label bottom-left names the mode. Look at faces, wounds and outlines at close, medium and far
range, both still and moving. Adding `&upscalelayout=dc` should look identical: it's the same maths,
laid out differently on the GPU.

Your verdict decides. Note it in `TASKS.md` or tell Claude.

## If the grid stopped at the cap or failed

- `STOPPED_AT_CAP`: the spend meter reached the cap (a pricier GPU or a slow pod). There is no
  automatic re-run; decide the next step with Claude.
- `GRID_FAILED.txt`: the grid crashed. The pod still packs what exists, waits, and stops. Pull
  what's there, confirm the pod stopped, and share `/workspace/grid.log`.
````

- [ ] **Step 2: TASKS**

In `TASKS.md`, `## Neural upscale (ESPCN family)` section, add:

```
- [ ] OWNER, P3 run: capture → RunPod API key → launch OK → pull → in-game verdict, per `docs/dev-notes/2026-09-11-neural-upscale/p3-runbook.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/dev-notes/2026-09-11-neural-upscale/p3-runbook.md TASKS.md
git commit -m "docs(upscale P3d): owner runbook — capture, RunPod launch, dashboard, pull, in-game verdict"
```
