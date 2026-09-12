# P3a capture v2 — Task 7 (capture script, dataset check, smoke)

**Date:** 2026-09-11
**Checkout:** `6137127c` (Task 6 head; Task 7's own changes are committed on top)
**Dataset:** `/tmp/blud-upscale-data/v2-smoke` (smoke, 24 pairs)

Plan: `docs/superpowers/plans/2026-09-11-neural-upscale-p3a-capture-v2.md` Task 7.
Contract: `docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md` §1.

## Artifacts

- `scripts/upscale-capture-v2.mjs` (new) — the capture.
- `scripts/upscale-dataset-check.py` (new) — the dataset v2 validator (uv, numpy).
- `scripts/lib/upscale-framing.mjs` — one constant flip (below).

## Smoke command

```bash
mkdir -p /tmp/blud-upscale-data
LAB_VITE_PORT=5320 LAB_CDP_PORT=9320 UPSCALE_DATA_ROOT=/tmp/blud-upscale-data \
UPSCALE_NAME=v2-smoke UPSCALE_PAIRS=24 UPSCALE_FRAMES=4 UPSCALE_FACE_SHOT=1 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-v2.mjs' \
  2>&1 | tee /tmp/p3a-task7.log
```

Syntax check: `node --check scripts/upscale-capture-v2.mjs && python3 -c "import ast; ast.parse(open('scripts/upscale-dataset-check.py').read())"` → `ok`.

## Session checks

**Supersample checks** (printed by the capture):

```
supersample checks: {"zeroJitterMaxAbsDiff":0,"offsetMean":[0,0],"registration":{"texels":4214,"argmin":{"ox":0,"oy":0},"subpixelOutputPx":{"x":0.12845004005253713,"y":0.12443447585203148}}}
```

**G2** (from `manifest.json` `checks.g2`):

- determinism, all three `max |Δ|`: **0** at temporal ray start **on (shipped)** — no fallback needed.
- depth registration: 4210 interior texels, argmin **(0, 0)**, sub-pixel **(0.000160, 0.002899)** output px, IoU **0.98744**, mean |depth diff| **0.002187 m**.
- orientation: input centroid row 185.56/300, target 369.95/600 → `rowZero: top`.

The supersampled target registered at **(0.12845, 0.12443)** output px — inside the 0.25 gate, and consistent with the documented first-hit-in-sample-order bias (the first sample is at (−0.125, −0.125)).

## Dataset check

```
$ uv run scripts/upscale-dataset-check.py /tmp/blud-upscale-data/v2-smoke
pairs 24  classes {'medium': 12, 'close': 7, 'far': 5}  splits {'train': 24}  showcase 0  with-head 24  with-wound 17
stats {'skippedStatic': 0, 'skippedEmpty': 0, 'skippedNoHead': 1, 'skippedSpawn': 4, 'secondsPerPair': 3.58325}
OK
```

Shape/dtype, finiteness, target-alpha-vs-coverage-agreement, native-file-per-split and region-in-crop all pass. No `PROBLEM` lines.

## Timing

- Measured: **3.58 s/pair** (24 pairs; includes boot + G2 + supersample session checks amortised over a small N).
- Projected for 1,000 pairs: **~60 min (~1 h)** wall clock from this number. Pair-only cost will be slightly lower once the fixed session setup is spread over 1,000 pairs.

## Face-direction check

`face-check-s0001-f000.png` (presented frame of the first close/head pair) was first captured with `BODY_FACING_SIGN = 1` and showed the **back** of the head. Per the plan, `scripts/lib/upscale-framing.mjs` was changed to:

```js
export const BODY_FACING_SIGN = -1;
```

and the smoke rerun. The regenerated PNG shows the **front** of the head and torso — **PASS**. `scripts/lib/upscale-framing.test.ts` still passes 6/6 (the tests pass an explicit facing sign, as the plan says).

## Skipped counts

`{ skippedStatic: 0, skippedEmpty: 0, skippedNoHead: 1, skippedSpawn: 4, secondsPerPair: 3.58325 }`.

Four sequences were skipped because their drawn character cannot be spawned as a game actor (see below); one pair was dropped because the head circle left the target frame.

## Problems / deviations (recorded, not hidden)

1. **Spawn throws instead of returning errors (fixed in the capture script).** The plan's
   `stageSequence` expected `spawnDebugCharacter` to report failure through `sp.errors`, but eight
   registered characters throw inside `createZombieActor` before `spawnDebugCharacter` returns:
   `mouse`, `cyclops`, `schoolgirl-alt`, `strand-fixture`, `dragon`, `box-fixture`, `gargoyle`,
   `bloatmaw` — seven with `no motion joints` and `strand-fixture`/`box-fixture` with
   `Cannot read properties of undefined (reading '0')` in `makeMotionJoints`. `characterNames()`
   returns the full registry, so the plan's `characters[index % length]` draws these. Without a
   guard the capture aborts at the first one. `scripts/upscale-capture-v2.mjs` now wraps the
   `spawnDebugCharacter` call in a `try/catch` and returns the message as `{ error }`, so the
   plan's existing `stats.skippedSpawn` + warn path actually runs. No gate or threshold changed.
   (`game-main.ts` is outside this task's file list, so the seam itself was not touched; a future
   task could make `spawnDebugCharacter` catch and report instead.)
2. **Coincident-actor staging (known from Task 6, unchanged).** `resetCast()` refills the room's
   default cast, then `spawnDebugCharacter` puts the new actor on spawn point 0 because
   `spawnPoints(room)` is already fully occupied; the two actors overlap, and scripted shots land
   on the default actor. Consequences visible in this smoke: the `wounds` field of the staged actor
   is 0 for several sequences (`s0001`, `s0003`), and `regions.wounds` can come from the
   overlapping default actor instead (it is defined to cover every visible actor). `lookAt: 'wound'`
   therefore falls back to the torso. Frames still render and validate, but the full capture's wound
   supervision is untrustworthy until the cast is cleared before spawning. **Owner action before the
   full capture:** fix the staging (`resetCast` should clear `actors`, or spawn into a free slot).
3. **No validation sequences in this smoke.** `splitFor(1, 0..10)` produced 0 `val` sequences, so
   all 24 smoke pairs are `train`, no `native.npy` was written, and `showcase` is 0. The checker
   accepts this (the native-file-per-split rule holds vacuously). The full ~1,000-pair run spans
   enough sequences for ~10% `val` and a populated showcase.

## Update 2026-09-12 — validation path verified, and two numbers the owner should know

The 24-pair smoke put every pair in `train` (its sequences never hit the 1-in-10 validation
draw), so the `val` split and its `native.npy` renders were untested. A second run was made purely
to exercise them: **44 pairs, seed 1, `UPSCALE_FRAMES=2`**, which reaches sequence 17 — the first
index `splitFor(1, ·)` marks `val` (then 22, 23, 24).

```
splits {'train': 40, 'val': 4}   val sequences [17, 22, 23]   showcase 4
native.npy written for 4 of 4 val pairs, and for 0 train pairs
s0017-f000  in (177, 331, 4)  target (354, 662, 4)  native (354, 662, 4)  float32, finite
upscale-dataset-check.py -> OK
```

The trainer consumes it, which is the real proof — `compute_baselines` raises without val pairs and
skips the native baseline without `native.npy`:

```
loaded 44 pairs | 40 train, 4 val | native on 4
baselines: nearest 0.0208 | bicubic 0.0177 | native 0.0079
```

Native scoring far better than bicubic against the supersampled target is the expected shape: the
target is the same render, cleaned of aliasing.

**Two findings for the full run.**

1. **Spawn failures are common.** This run skipped **16 of 42 sequences** (38 %) because the drawn
   character could not be spawned — e.g. `gargoyle`, `bloatmaw`, both reporting
   `zombie NNN: no motion joints`. The 24-pair smoke saw 4. The capture handles it (counts it in
   `stats.skippedSpawn` and moves on), but the dataset's character mix is therefore whatever
   spawns, not the full roster. Worth a look before the full run if character variety matters.
   Characters actually captured here: bonewalker x4, clown x3, clown-alt x3, cyberdemon x4, female x4, gnasher x3, goblin x5, minotaur x4, schoolgirl x3, schoolgirl-described x4, soldier x3, zombie x4.
2. **Time per pair is workload-dependent:** 3.58 s/pair on the 24-pair smoke, **5.25 s/pair** here
   (more far-class and more skipped sequences). A 1,000-pair capture is therefore roughly
   **1–1.5 h**, not the "hours" the plan text assumes.

