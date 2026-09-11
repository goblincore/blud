# Neural upscale P3 — face/body capture v2 and RunPod training — design

**Date:** 2026-09-11 · **Status:** approved design, owner "yes you can write the spec" 2026-09-11
**Parent spec:** `docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md` (stage, network
family, layouts, §4 reconstruction). **P1+P2 results:** `docs/dev-notes/2026-09-11-neural-upscale/`
(`g1-parity.md` PASS, `g2-pairs.md` PASS; the cost bench is deferred).

## Owner decisions (2026-09-11)

| Topic | Decision |
|---|---|
| Visibility | A **dashboard** openable from any device while training runs, **plus loading checkpoints into the game** to judge them in motion |
| Scope | A **bigger capture**, then **train on RunPod from the start** (no Mac-only pilot phase) |
| What matters | **Face and body surface detail**, and **aliased edges** at low resolution. Gore is not the priority |
| Budget | **~$10** RunPod spend cap for this phase |

## Goal

Train the ESPCN-family upscaler (s8/s16/s32 × `rgb`/`rgbd`) on a capture designed around faces,
body detail and silhouettes. Measure it against nearest and bicubic on exactly those regions, and
put the best checkpoints in front of the owner in-game. **Quality first; cost is measured later.**

## Known limit (stated up front)

A single-frame upscaler can reduce edge aliasing and sharpen surfaces. But face features only a
pixel or two across at 400×300 (eye and mouth lines) were never sampled, so the network can only
infer them. The dashboard's face crops show how much is recovered. If faces fall short, the next
levers are temporal reconstruction (jittered history) or a small full-resolution face pass. Both
are **out of scope** here.

## Data flow

```
Mac (Chrome, GPU)                         RunPod (1 GPU pod, one session)          Mac
capture v2 ──► dataset (~1,000 pairs) ──► upload ──► train grid (6 runs) ──► exports ──► pull ──► G3 parity ──► in-game A/B
      │                                               └─► dashboard (proxy URL, any device)
      └─► pre-flight: local smoke training on the 60 existing pairs (must pass before any pod launch)
```

## 1. Capture v2 (local)

**Code.** Move the shared parts of `scripts/upscale-pairs-capture.mjs` into `scripts/lib/upscale-capture.mjs`:
march readback, `renderAt`, coverage, the G2 checks and the registration gate. The existing script
keeps working through that module. Add `scripts/upscale-capture-v2.mjs`.

**New game seams (dev-only, `game-main.ts`):**
- `actorLimbCenter(actorId, limb)` → world-space centre of the actor's live `'head'` or `'torso'`
  cluster (from `a.posed().clusters`, as `aimAtNearestSurface` reads it), or `null`.
- A way to list spawnable character types (for `spawnDebugCharacter(name)`). If no list exists,
  add `characterNames()`.

**Framing classes** (seeded `mulberry32`; the seed is recorded):

| Class | Share | Look-at | Distance | Orbit around the body's facing | Camera height |
|---|---|---|---|---|---|
| face | 40% | head centre | 0.6–1.2 m | ±60° | head height ±0.15 m |
| body | 40% | torso centre | 1.5–3.0 m | ±90° | 1.2–1.8 m |
| far | 20% | torso centre | 3.0–6.0 m | full circle | 1.4–1.8 m |

**Content:**
- **Characters:** every spawnable character type, round-robin across sequences.
- **Wounds:** about 25% of sequences take 1–3 pellet hits (`fire`, aimed at the body) before
  capture, as body detail rather than gore.
- **Lighting:** the shipped lighting of each room, with no special lighting sweeps.

**Motion guarantee.**
- Between captured frames the simulation advances `ADVANCE` frames.
- If the input flesh mask still overlaps the previous captured frame by IoU ≥ 0.98, it advances
  again (up to 3 times), then re-stages at a new orbit.
- Frames that never move are skipped and counted in the manifest.

**Visibility guards.**
- Skip frames with input flesh < 0.5% of the frame.
- Face-class frames must have the projected head centre inside the frame, with a margin of one
  head radius.

**Storage per pair.**
- **Crop:** the union flesh bounding box of the input (×2) and the target, padded by 8 input px,
  clamped to the frame, with the origin aligned so that output origin = 2 × input origin.
- **Files:** `in.npy` (h×w×4) and `target.npy` (2h×2w×4), both float32. Clip depth needs float32.
- **Per-pair manifest entry:**
  - crop origin and full-frame size;
  - class, character, room, distance, orbit, wounds;
  - projected head centre and radius in output px (head radius 0.12 m);
  - near/far, and IoU against the previous captured frame.

**Size, location, splits.**
- Target: **~1,000 pairs**, hard cap 4 GB.
- Written to `UPSCALE_DATA_ROOT` (default `~/blud-upscale-data/<name>`), outside every worktree and
  outside `/tmp`, because the capture takes hours.
- 10% of **sequences** held out for validation, chosen by a seeded hash; never adjacent frames.
- **Showcase set** (fixed validation crops the dashboard shows): 12 pairs — 6 face, 4 body, 2 far.

**Checks.** The existing G2 checks run at the start of every capture session. A determinism
spot-check (render twice, ≤ 1e-6) runs every 100 pairs. A failure stops the capture.

**Content rights.** Only tracked `public/assets/lab/*` content is in the flesh layer, so the
dataset may be uploaded to RunPod.

## 2. Trainer (PyTorch, `scripts/neural-upscale/`)

**Files:**

| File | Responsibility |
|---|---|
| `model.py` | The network, mirroring `upscale-model.ts` |
| `data.py` | Loading and cropping |
| `losses.py` | Loss terms and weights |
| `train.py` | The training loop |
| `evaluate.py` | Metrics and baselines |
| `export.py` | JSON export |
| `run_grid.py` | Runs the 6-run grid with the spend meter |
| `dashboard/` | The static page |
| `requirements.txt` | Pinned dependencies |

Every script is device-agnostic (`cuda` → `mps` → `cpu`).

**Exact mirror of `upscale-model.ts`:**
- `Conv2d(3×3, padding=1, padding_mode='replicate')`, ReLU between layers; the last layer has 16
  channels.
- Weight order `W[out, in, ky, kx]`; pixel shuffle `out[c, 2y+i, 2x+j] = last[c·4 + i·2 + j]`.
- Input assembly identical to `assembleInput`: rgb × hit, hit, and for `rgbd` linear depth × 0.1.

**Initialization.**
- Hidden layers: He.
- Last layer: **ICNR** (one 4-channel kernel copied to all four sub-pixels), scaled ×0.1 with zero
  bias, so training starts at the nearest-upscale baseline without checkerboard artifacts.

**Reconstruction in training (differentiable where it can be).**
- Output colour = the §4 source texel's rgb (index selection, not differentiated) + predicted residual.
- Coverage margin = `ownHit + res.w − 0.5`, the shader's own threshold.

**Loss.** All terms are computed on output pixels.
- **Colour:** L1 on `log1p(rgb)` over pixels that are flesh in the target **and** have a §4 source.
  `log1p` stops HDR highlights (measured up to ~28) from dominating.
- **Detail:** L1 on the x and y finite-difference gradients of `log1p(rgb)`, on the same mask, weight 0.5.
- **Coverage:** a hinge with margin 0.25. Target flesh wants margin ≥ +0.25; target non-flesh wants
  ≤ −0.25. Weight 1.
- **Region weights, matching the owner's priority:**
  - face region (inside the projected head circle) ×3;
  - silhouette edge band (target flesh within 2 output px of non-flesh, or where input and target
    coverage disagree) ×2;
  - body interior ×1.
- All weights are recorded in the run config.

**Sampling and schedule (defaults, recorded per run).**
- Crops: 64×64 input (128×128 target) from the pair crops. 50% are centred in a face region when
  the pair has one; the rest are uniform over flesh.
- A pair crop smaller than 64×64 (far bodies are often ~20 input px wide) is **padded with the
  no-flesh sentinel** (rgb 0, clip depth 1.0), never resized. Padding is non-flesh, so it only
  enters the coverage loss, exactly as empty screen does in-game.
- Batch 64; Adam at lr 1e-3 with cosine decay.
- The dataset is preloaded into memory, so the loader is not the bottleneck.
- Per-run limit: 20,000 steps **or** 25 minutes, whichever comes first.

**Validation (every 500 steps, on full validation pairs).**
- Flesh-masked mean |Δ log1p rgb|, reported overall and per region (face, edge band, interior).
- Coverage error rate.
- Baselines computed once:
  - **nearest** (the zero model);
  - **coverage-aware bicubic**: bicubic over flesh taps only, weights renormalized, coverage from
    the nearest texel.

**Checkpoints.**
- Written at every validation. The best-by-validation checkpoint is kept separately.
- An export is written at the best and final checkpoints.

## 3. Export and parity

**Model JSON** (`format: "blud-upscale-model/1"`):
- Identity: `id` (s8/s16/s32), `inputs`, `source: "trained"`, `run`, `step`.
- `layers[]`, each `{ inC, outC, relu, weights, bias }`, with arrays as base64 float32
  little-endian in PyTorch order.
- `inScale`, `inOffset`.
- `weightHash`: the same FNV-1a over the float bytes as `hashModel`.
- `metrics`: validation and baseline numbers at that step.
- `trainedOn`: dataset name and manifest hash.

**Fixture.** Each export ships `parity-fixture.npz`: 2 validation inputs and PyTorch's reconstructed
outputs, both layouts.

**G3 parity (local).**
- A TypeScript check loads the JSON through the new `parseUpscaleModelJson` and runs
  `upscaleReference` (no float16 emulation) on the fixture inputs.
- Pass: colour relative difference ≤ 1e-4, depth exact, and coverage identical wherever the
  margin is ≥ 1e-3.
- Then the existing in-game `upscaleSelfCheck` (G1-parity thresholds) runs on the trained model.

## 4. Pod run and dashboard

**Prerequisites (owner only).**
- The RunPod API key is configured in `runpodctl`. The CLI currently reports "API key not found".
  Agents never handle the key.
- **Pod launch needs the owner's explicit OK** after seeing the GPU type, hourly price and
  estimated total.

**Launch (`scripts/neural-upscale/runpod/launch.sh`).**
- Picks the cheapest available single GPU with ≥ 24 GB, on RunPod's PyTorch image.
- Exposes HTTP port 8080 and sizes the container disk for the dataset.
- Prints the estimate and **refuses to create a pod without `--yes`**.
- Upload: a tarball of the dataset plus `scripts/neural-upscale/`, sent with `runpodctl send`.

**Grid (`run_grid.py`).**
- Six runs in sequence: s8, s16, s32 × `rgb`, `rgbd`.
- The spend meter is the pod's hourly price × elapsed time.
- It won't start a run whose estimated cost would cross the cap.
- At the cap it finishes the current checkpoint, exports, writes `STOPPED_AT_CAP` and stops.
- When the grid ends, or on any fatal error, the pod is stopped. RunPod billing is checked
  afterwards with `runpodctl billing`.

**Dashboard (served from the pod).**
- `python -m http.server 8080` in the run directory, reachable at
  `https://<podId>-8080.proxy.runpod.net`, so it opens from any device.
- The trainer writes `dashboard.json` and PNG crops; `index.html` is static, with inline JS and SVG
  charts, no CDN, and refreshes every 30 s.
- **Status:** per-run state, step, best validation, and spend against the cap.
- **Curves:** train and validation loss; face, edge and interior error, with the nearest and
  bicubic baselines as flat lines.
- **Showcase:** the 12 fixed validation crops at the latest and best checkpoints — nearest |
  bicubic | model | native, shown enlarged with nearest filtering so pixels stay visible.
- **Exposure:** proxy URLs are unlisted, not authenticated. The page holds only project-asset
  crops and metrics.

**Pull back (`runpod/pull.sh`).** Exports go into a gitignored `.upscale-models/` in the repo root.
Accepted models can later be committed under `public/assets/lab/upscale/`.

## 5. In-game

**Dev middleware** (the `labDevSave` pattern in `vite.config.ts`, `apply: 'serve'`):
- `GET /__lab/upscale-models` lists the exports (name, id, inputs, run, step, headline metrics).
- `GET /__lab/upscale-model/<name>` returns the JSON.

**TypeScript.**
- `parseUpscaleModelJson(json): UpscaleModel` in `upscale-model.ts`. It validates the format, the
  shapes against `HIDDEN_WIDTHS[id]` and `INPUT_CHANNELS`, and recomputes `weightHash`; a mismatch
  is rejected.
- `createUpscaleStage(config, marchTexture, flipY, model?)` uses `model` when given. Its `id` and
  `inputs` must match `config`.
- `UpscaleInfo` gains `source ('random' | 'trained')`, `run` and `step`.

**Flags and seams.**
- `?upscale=trained&upscalemodel=<name>` fetches at boot. A missing or invalid model leaves the
  stage off, with a console error.
- `__sdfGame.setUpscale({ trained: '<name>', layout? })` is async.
- `__sdfGame.upscaleModels()` lists the models.

**A/B key (dev-only, when `?upscale` is present).** `U` cycles:
1. **native** — scale 1.0, shipped field style;
2. **nearest** — scale 0.5, zero model;
3. **trained model**.

A small on-screen label names the current mode. Switching reallocates targets, so a brief hitch
is acceptable.

## 6. Gates and stop rules

**Pre-flight (local, must pass before any pod launch).**
- Smoke training on the 60 existing pairs (`/tmp/blud-upscale-data/smoke-2026-09-11-r4`,
  regenerate if gone), CPU/MPS, ≤ 10 minutes.
- Training loss falls, and the model beats nearest on its own training crops (an overfit sanity check).
- The export round-trips, G3 parity passes, and the dashboard renders locally.

**G2** at every capture session, plus the periodic determinism check (§1).

**G3 parity** (§3), for every model shown in-game.

**G4 quality.**
- At least one run's best checkpoint beats coverage-aware bicubic on the validation set,
  **overall and on faces and on the edge band**.
- G4 only decides whether the in-game look is worth the owner's time. **The owner's in-game A/B
  verdict decides.**

**Stop rules.**
- **$10 cap** (estimate from pod hours; billing checked afterwards).
- No runs beyond the 6-run grid, and no automatic re-capture or grid expansion.
- The pod is stopped when the grid ends or on any fatal error.

## 7. Execution split

| Work | Who |
|---|---|
| Capture v2 code + seams + `scripts/lib/upscale-capture.mjs` refactor | dispatchable (browser checks on the `pi` harness; the `dsh` sandbox blocks Chrome) |
| Trainer, losses, data, evaluate, export, grid runner, dashboard + unit tests (PyTorch vs TS twin on a fixture) | dispatchable |
| In-game loader, middleware, `parseUpscaleModelJson`, A/B key | dispatchable |
| RunPod launch/pull scripts — written and dry-run, **never executed** by agents | dispatchable |
| Running the ~1,000-pair capture (hours, local GPU) | with owner |
| RunPod API key; approving the launch; watching the dashboard | owner |
| In-game verdict | owner |

## Out of scope

- Temporal reconstruction.
- A full-resolution face pass.
- **Richer aux inputs** (normal/albedo/wound via MRT). The parent spec's P3-prep decision:
  **deferred again**. This round stays `rgb`/`rgbd`; revisit only if G4 fails on faces and `rgbd`
  doesn't help.
- The cost bench (parent plan Task 6, still deferred).
- Shipping anything on by default.
