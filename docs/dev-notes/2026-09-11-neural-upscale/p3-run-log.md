# P3 training run — log

- **Started:** 2026-09-12 02:45 UTC
- **Pod:** `ads3oxjqv25e7o`, RunPod **secure** cloud, RTX 4090 24 GB, **$0.74/h**
  (community 4090 stock was exhausted; secure succeeded on the fourth attempt)
- **Image:** `runpod-torch-v21` — torch 2.1.0+cu118, Python 3.10.12, numpy 1.24.1, 96 vCPU, 251 GB RAM
- **Dashboard:** `https://ads3oxjqv25e7o-8080.proxy.runpod.net`
- **Dataset:** `v2-2026-09-12`, 1,000 pairs / 4.0 GB, 924 train + 76 val, 12 showcase,
  roster zombie/goblin/soldier, captured locally in 24 min at 1.4 s/pair
- **Grid:** s8/s16/s32 × rgb/rgbd, 20,000 steps or 25 min each, $10 cap, 40 min pull grace
- **Unattended pull:** `watch-pull.sh ads3oxjqv25e7o --stop` under `caffeinate` on the Mac

## Baselines (76 validation pairs, vs the supersampled target)

| | overall |
|---|---|
| nearest (the zero model) | 0.0314 |
| **coverage-aware bicubic — the G4 bar** | **0.0284** |
| native single-ray 800×600 | 0.0141 |

## Snapshot while writing this

- spend $0.38 of $10.00 at $0.74/h
- s8-rgb: running, step 1500/20000, best overall 0.0259
- s8-rgbd: pending, step 0/0
- s16-rgb: pending, step 0/0
- s16-rgbd: pending, step 0/0
- s32-rgb: pending, step 0/0
- s32-rgbd: pending, step 0/0

## Local throughput, for sizing future runs

Measured on the Mac (MPS) against this dataset, batch 64, 64×64 crops:

| model | params | steps/s | 20k steps |
|---|---|---|---|
| s8-rgbd | 2,120 | 25.0 | 13.3 min |
| s16-rgbd | 5,376 | 22.5 | 14.8 min |
| s32-rgbd | 15,344 | 17.8 | 18.7 min |

Validation (76 pairs + 12 showcase PNGs) costs 1.7 s, so `val-every 500` adds ~1 min per run.
The bottleneck is the CPU-side crop sampler, not the GPU.

## Fixes this run forced

1. **`RUNPOD_POD_ID` is absent from an ssh session**, so the pod's own auto-stop died on `set -u`.
   `bootstrap-pod.sh` now falls back to `/proc/1/environ`.
2. **numpy pinned `<2`** and installed only when missing: this image's torch is built against
   numpy 1.x.
3. `runpodctl 2.1.9 gpu list` reports **no prices**, so `launch.sh` was run with a deliberately
   high $1.00/h for its estimate; the true $0.74/h came from `pod get` and was passed to the
   spend meter.

## When the grid ends

The watcher pulls `exports.tar.gz` (models, parity fixtures, **checkpoints**, dashboard + images),
runs G3 parity per export, installs into `.upscale-models/`, then stops the pod. Delete it with
`runpodctl pod delete ads3oxjqv25e7o` once the models have been judged in-game; a stopped pod still
bills for its volume.
