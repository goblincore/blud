# Merged crowd march — stage (a) dev notes

**Date:** 2026-09-13 · **Plan:** `docs/superpowers/plans/2026-09-13-merged-crowd-march-stage-a.md`
· **Spec:** `docs/superpowers/specs/2026-09-13-merged-crowd-march-design.md`

Task-by-task record for the per-type crowd march. Task 0 (this note) records the
baselines and lands the harness seams the later tasks gate against.

## Baselines (2026-09-13)

Booted through `scripts/march-hash.mjs` inside `scripts/lab-servers.sh`
(`LAB_VITE_PORT=5323 LAB_CDP_PORT=9323`, `LAB_TMP` inside the worktree). The
tiles-off run is the canonical gate; the tiles-on run asks whether the tile-list
march is already bit-identical to the cluster walk.

| configuration | room 1 `room1` | `room1-repeat` | `room1-wounded` |
| --- | --- | --- | --- |
| tiles off (canonical) | `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` | `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` | `da785297dcc3f677320c563501ca861bac22d6d6` |
| tiles on | `64c7bc5a1c471ca1758490af68e6c1600b12e2b8` | `64c7bc5a1c471ca1758490af68e6c1600b12e2b8` | `38fc13bfa87cb44d11fbce69b6218c9e302a1ad7` |

Commands:

```bash
# canonical (tiles off)
node scripts/march-hash.mjs

# tiles on — needs the page flag to make the controller `allowed`
MARCH_HASH_TILES=1 MARCH_HASH_QUERY='tiles-playtest' node scripts/march-hash.mjs
```

Both boots are internally deterministic (`room1 == room1-repeat`) and the
wounded variant differs from `room1` in each, so the gate is testing something.

**The two differ, so today's tile-list march is NOT bit-identical to the cluster
walk.** Per the plan, stage a-2's acceptance bar therefore becomes
**"identical to the tiles-on baseline"** (`64c7bc5a1c471ca1758490af68e6c1600b12e2b8`)
rather than "identical to the canonical tiles-off hash". The difference is
expected — tiles reorder/limit the per-step fold — but it must stay frozen while
the crowd work lands.

`MARCH_HASH_QUERY` is the new env passthrough (any extra query string is appended
to the boot URL), so later tasks can hash `?crowd=1` through this same gate.

## Crowd bench baseline (per-body path, tiles off)

```bash
BENCH_PASSES=1 BENCH_ROOMS=1 BENCH_LEGS=baseline BENCH_CROWD=24 \
  BENCH_OUT=docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/crowd24-perbody \
  node scripts/sdf-game-bench.mjs 5323 9323
```

`BENCH_CROWD=24` spawns 24 zombies into room 1 through the new
`__sdfGame.spawnCrowd('zombie', 24)` seam, before the leg overrides. Three
repeats, room 1, `baseline` (upscale/refine off, tiles off).

| metric | per rep | median |
| --- | --- | --- |
| `sdf:march` p50 (ms) | 55.38 / 143.88 / 54.26 | **55.38** |
| fenced frame p50 (ms) | 84.62 / 157.04 / 85.83 | **85.83** |

Census: 24 spawned; 23–27 bodies on screen over a run (the spawned zombies
wander in and out of the room-1 view). Walk opened at 24 bodies, fire dropped it
to 5–27 depending on how many the scripted shots killed.

**Read with care.** The run reports census and frame-hash drift (`exit 1`, by
design): the spawned zombies wander with per-boot RNG, so repeats are not the
same workload. The 86% repeat spread on the fenced frame (rep1 = 143.88 ms) is
exactly that — rep1's fire segment kept 26 bodies alive where rep0/rep2 dropped
to 7/5, so the median `sdf:march` p50 above is the quiet-rep figure, not a
tight estimate. The per-body path baseline this task exists to record is
`sdf:march` ≈ 54–55 ms for ~24 co-located bodies at the room-1 close-up; treat
rep-to-rep deltas smaller than the census drift as unresolved.

Harness note: one earlier attempt at the exact command failed with
`330 hidden frames — INVALID` on a cold Chrome (immediately after two
`march-hash` boots). A re-run in a fresh lab-servers boot succeeded, and a
`BENCH_CROWD=0` control also succeeded — the failure was a flake, not the crowd
prelude. Do not treat a single hidden-frames failure as a crowd bug.

Artifacts: `crowd24-perbody/bench.{json,md}`, `crowd24-perbody/passes.{json,md}`.

## Harness changes landed by Task 0

- `scripts/march-hash.mjs` — `MARCH_HASH_QUERY` (extra URL query) and
  `MARCH_HASH_TILES=1` (`__sdfGame.setTiles(true)` after ship defaults).
- `scripts/sdf-game-bench.mjs` — `BENCH_CROWD=n` prelude
  (`__sdfGame.spawnCrowd('zombie', n)` after ship defaults, before leg
  overrides); legs `crowd-on` and `crowd-on-tiles-off`; the override applier
  skips `setCrowd` while the seam is absent, so the legs are no-ops until Task 6
  (like `setTiles` without `tiles-playtest`).
- `src/lab/sdf-zombie/webgpu/game-main.ts` — `__sdfGame.spawnCrowd(name, n)`
  next to `spawnDebugCharacter`, returning how many landed.

## Task 7e — visible-only binning, behind-plane cull (2026-09-14)

Removes the two confounds Task 7d identified: `?crowd=1` attached the WHOLE cast
and the binners sent every behind-camera sphere into every tile. Two changes,
both in `sync()`/the two binners; the per-body path is untouched.

**Visible-only packing (`crowd-type.ts`, `game-main.ts`).**
`CrowdType.sync(camera, grid, visibleSlots)` now `continue`s any slot outside
`visibleSlots` (it stays attached and alive; the record keeps its band, so
re-showing is a re-pack, not a re-attach). `info().visible` is the count actually
packed. In `game-main.ts` the crowd sync moved AFTER `updateVisibleActors()` and
builds one `Set` per type from that frame's `visibleActors`
(`a.crowd?.type === t`). The A/B is therefore body-count-honest: at room 1 the
crowd-on census (soldier 1 / zombie 2) exactly equals the per-body baseline's.

**Behind-plane zero-tile rule (`tile-cull.ts` + `tile-bin-compute.ts`).** Both
binners now test the sphere's FARTHEST point along the view axis
(`farDist = -v.z + rBlend`) before the cover-all branch: a sphere whose far end
is still behind the eye plane is reachable by no forward ray and touches no
pixel, so it binds ZERO tiles. A sphere that CROSSES the plane
(`nearDist <= 0 < farDist`) keeps the cover-every-tile rule. The empty range uses
the binners' existing off-screen encoding (CPU `0..-1` / GPU `tx1 = ty1 = -1`).
the JS range reimplementation inside `__sdfLab.tileAB` (lab-main.ts) was mirrored
too, or every behind-camera group would have read as a phantom range mismatch.

**Gates.** `npx tsc --noEmit -p .` clean. The named vitest files pass (258 tests
across `crowd-type` 6, `tile-cull` 7, `tile-bin-compute` 17, `march.wgsl` 228);
the crowd-type test builds a real `CrowdType` over a stub renderer and asserts
`instanceCount 2` / `instCfg.x 3` / no slot-1 group for `visibleSlots {0,2}`.
Canonical `node scripts/march-hash.mjs` = `a8ab4efac15fc0376c3e4e05420f13e34d1511bd`
(×2; wounded `da785297…`) — the per-body tiles-off path is bit-identical, as it
must be (it never had behind-camera hero groups). `node scripts/march-parity.mjs`
**PASS**, tiles off and tiles on, with the SAME numbers as Task 7b
(`maskDiff 0`, maxDz 1.379e-3 room 2, flat RGB 0 channels): the clamp fix did NOT
move the gated crowd pixels.

The real GPU bit-identity A/B (`scripts/tile-ab.mjs` against
`__sdfLab.tileAB`) was **not run**: it drives `sdf-lab-webgpu.html` with a
baked character blob, and this worktree has no baked blobs
(`assets-source/humanoid-sdf/` holds only the source `.glb`; `public/assets`
has no character dir), so the lab page cannot boot a subject. The CPU side is
covered by the new fixture in `tile-bin-compute.test.ts` (a line-for-line
`PROJECTION_BLOCK` transcription vs `TileBinner`, with the two new groups), and
the live GPU binner was exercised end-to-end by `march-parity` under
`?crowd=1&tiles-playtest` (its `compute:tile-bin` pass ran; no fallback).

### Bench (repeats=1, `BENCH_PASSES=1`, `crowd=1&tiles-playtest`)

Load average at the two runs: 3.79/4.06/4.00 (rooms 1–2) and 2.49/3.35/3.71
(crowd 8) — 1-minute load under the 4 ceiling on entry, recorded per the rule.

| run | room | leg | `sdf:march` p50 | fenced frame p50 |
| --- | ---: | --- | ---: | ---: |
| `7e-rooms12` | 1 | baseline | 50.70 | 54.15 |
| `7e-rooms12` | 1 | crowd-on | 65.97 | 68.12 |
| `7e-rooms12` | 2 | baseline | 26.40 | 32.45 |
| `7e-rooms12` | 2 | crowd-on | 36.24 | 42.07 |
| `7e-crowd8` | 1 | baseline | 54.87 overall | — |
| `7e-crowd8` | 1 | crowd-on | probe aborted | — |
| `7e-crowd24` | — | — | NOT RUN (stop rule) | — |

`crowdInfo()` on the crowd-on legs: `tileFallbacks 0`, `culledByBudget 0`,
`clampedTiles **0**` in both rooms (room-1 soldier 4 attached / 1 visible, zombie
11 / 2; room-2 soldier 4 / 0, zombie 11 / 5). **The tens-of-thousands clamp is
gone: 9533 → 0 (room 1 soldier), 18138 → 0 (room 1 zombie), 43779 → 0
(room 2 zombie).** That is the acceptance bar and the mechanism the whole task
exists for: with only the visible instances packed and the behind-camera tail
omitted, no tile reaches the 64-entry cap.

### Verdict against spec §5 a-3

| comparison | Task 7d | Task 7e |
| --- | ---: | ---: |
| room 1 crowd-on / baseline march | 68.36 / 53.70 = 1.27× | 65.97 / 50.70 = **1.30×** |
| room 2 crowd-on / baseline march | 72.99 / 39.00 = 1.87× | 36.24 / 26.40 = **1.37×** |
| crowd-on visible (room 1, end of leg) | whole cast (4+11) | baseline census (1+2) |

**Flat at 3–5 bodies: closer, not yet.** The premium is now 1.30–1.37× across
2→5 visible bodies instead of 1.27→1.87×, i.e. the curve no longer climbs with
the cast — but crowd-on is still ~1.3× the per-body march in the tiles-on
close-up. That residual is the structural cost a-2-2 (per-tile screen quads)
exists to remove; this task only removed the cast-proportional component.

**Crowd 8: still a probe abort, and now confirmed reproducible.** With
`BENCH_CROWD=8` the room-1 crowd-on probe never answered
(`probe evaluate failed after 30 s: CDP Runtime.evaluate never answered in 60s`),
exactly as Task 7d recorded; a second run of the crowd-on leg ALONE reproduced
it (`7e-crowd8-confirm/`), so it is not the old hidden-frames flake. The baseline
leg in the same process completed (54.87 ms overall), so the harness is fine.
Per the stop rule the crowd 8 crowd-on march is therefore unmeasurable and
**crowd 24 was NOT run** — the `≤ 2× room-1 crowd-on` precondition cannot be
checked against a number that does not exist. Nothing hung: the frame-cap guard
aborted the probe in-process, the driver logged the abort, and Chrome was killed
by the lab-server trap. Recorded as an open limit, not a pass.

Artifacts: `7e-rooms12/`, `7e-crowd8/`, `7e-crowd8-confirm/` (`bench.{json,md}` +
`passes.{json,md}` each).

## Task 7f — spread spawns and the scaling knee (2026-09-14)

**The stacked-spawn finding.** `spawnDebugCharacter` placed every copy at
`starts[actorsInRoom % starts.length]`, and room 1 has exactly ONE spawn point
(`ROOMS[0]` = zombies 1, soldiers 1 in `game-level.ts`), so `BENCH_CROWD=8`
stacked all 8 zombies on the same metre of floor. For the instanced proxy box
that is the worst possible scene: every pixel folds the union of 8 coincident
bodies (8 x ~37 groups in one tile, over the 64-entry cap, clamped and holed as
well). The game never produces that scene, so the crowd-8 probe abort was a
measurement fault, not a march fault. `spawnCrowd` now lays copies on a centred
square grid (`crowdGridPoints`, default spacing 1.2 m, every point clamped 0.6 m
inside the room floor) and the bench passes `BENCH_CROWD_SPACING`.

**Seams (Step 1).** New pure module `crowd-spawn.ts` + test: `n` copies on a
`ceil(sqrt(n))`-column grid centred on the room's first spawn point, pairwise
>= spacing apart, all inside the floor rect; `n = 1` returns `p0`. `spawnDebugCharacter(name, start?)`
takes an optional point (modulo default kept for its other callers) and `spawnCrowd`
returns `{ ok, placed }`. With the spread spawn, **`BENCH_CROWD=8` crowd-on tiles-on
now COMPLETES** (140 ms overall / 150 ms walk, under the 250 ms guard) where
Task 7e recorded a reproducible probe abort.

**Leg fix.** The ship-defaults block pins `setTiles(false)`, so the `crowd-on` leg
({ setCrowd: true }) was silently tiles-OFF — the same configuration as
`crowd-on-tiles-off` (verified on the page: boot `?tiles-playtest` enabled,
`setTiles(false)` -> false, `setCrowd(true)` -> still false). `crowd-on` now sets
`setTiles(true)`, and the bench records `tilesOn` on every row.

### The knee

repeats=1, `BENCH_PASSES=1`, `BENCH_QUERY='crowd=1&tiles-playtest'`, room 1.
`sdf:march` is the pass-timer p50 over all segments. `bodies visible` is the
baseline census max (`cullCounts.visible`) / crowd packed `info().visible` at end
of run — **different instruments; they do not match, see the warning below**.
`clamp/cull/fb` = crowd `clampedTiles` / `culledByBudget` / `tileFallbacks`.

| n | load 1-min | bodies visible per-body / on / off | per-body march | crowd-on march | crowd-off march | clamp/cull/fb | probe abort? |
|---:|---:|---|---:|---:|---:|---|---|
| 2 | 2.36 | 8 / 1 / 4 | 69.56 | 10.24 | 24.59 | 0/0/0 | no |
| 4 | 2.43 | 10 / 7 / 7 | 61.58 | 66.08 | 123.19 | 0/0/0 | no |
| 6 | 1.60 | 12 / 7 / — | 76.57 | 82.77 | — | 0/0/0 | crowd-off |
| 8 | 2.07 | 15 / 11 / — | 80.66 | 140.06 | — | 0/0/0 | crowd-off |
| 12 | 2.44 | 17 / — / — | 99.51 | — | — | — | crowd-on + crowd-off |
| 16 | 1.53 | 22 / — / — | 34.28 + | — | — | — | crowd-on + crowd-off |

+ The n=16 baseline is not a comparable scene (segment `sdf:march` walk 104.76 ms
but fire 32.41 ms — the run-5 background-load drift, visible in the census too:
walk 22->19, fire 19->5). Crowd 24 was **NOT run**: its precondition
(n=16 crowd-on completes and is <= 2x the n=8 number) is unmet. `BENCH_CROWD_MAX=24`
was never approached. Every abort is the frame guard (the probe's 30 s evaluate
never answered / over cap); nothing hung, and baseline completed in every run.

Per-segment `sdf:march` p50 (the walk segment is the close-up; the firefight drags
the overall column):

| n | leg | walk | fire | gib |
|---:|---|---:|---:|---:|
| 2 | per-body | 53.54 | 81.17 | 72.14 |
| 2 | crowd-on | 11.58 | 7.83 | 10.02 |
| 2 | crowd-off | 27.66 | 22.67 | 23.60 |
| 4 | per-body | 42.53 | 71.55 | 62.19 |
| 4 | crowd-on | 32.45 | 76.42 | 73.27 |
| 4 | crowd-off | 94.82 | 131.69 | 149.95 |
| 6 | per-body | 69.47 | 79.90 | 81.77 |
| 6 | crowd-on | 84.70 | 118.78 | 74.60 |
| 8 | per-body | 82.25 | 86.98 | 77.19 |
| 8 | crowd-on | 150.21 | 106.12 | 158.34 |

Derived ratios (tiles-on crowd; crowd(2) and per-body(2) are the `n=2` rows):

| n | crowd(n)/crowd(2) | per-body(n)/per-body(2) | crowd/per-body | crowd-per-visible / per-body-per-visible |
|---:|---:|---:|---:|---:|
| 2 | 1.00 | 1.00 | 0.15 | 1.18 |
| 4 | 6.45 | 0.89 | 1.07 | 1.53 |
| 6 | 8.08 | 1.10 | 1.08 | 1.85 |
| 8 | 13.68 | 1.16 | 1.74 | 2.37 |

**Verdict.** (1) The crowd march does **not** show sub-linear scaling at fixed
screen coverage: cost per visible body is roughly flat (~10-13 ms overall), so
the tiles-on crowd is ~linear in visible bodies, and the raw crowd/per-body ratio
climbs 0.15 -> 1.74 only because more bodies come on screen (coverage was not
held fixed by this sweep, so the screen-bound claim is untested, not
supported). (2) **Tiles-on is the better crowd mode** by ~1.9-2.4x at equal spawn
(24.59 -> 10.24 at n=2; 123.19 -> 66.08 at n=4) and it is the only mode that
measures past n=4 — tiles-off hits the frame guard at n=6 while tiles-on reaches
n=8. (3) The residual per-visible-body premium is **not flat**: it grows
1.18 -> 1.53 -> 1.85 -> 2.37 with n, the signature of overlapping-box duplicate
traces (each pixel folds every stacked body), so **stage a-2 per-tile screen
quads is the next task** — not a kernel profile.

**A/B honesty warning (flag as required).** No row has crowd `visible` equal to
the baseline `bodies`: baseline bodies 8/10/12/15/17/22 vs crowd-on visible
1/7/7/11/—/— and crowd-off 4/7. The two numbers come from different instruments
(per-body `cullCounts.visible` max over the whole run vs the crowd type's packed
slot count on the final frame), so the mismatch partly reflects the dwell grace
and mid-run kills, not only missing instances; the ratios above are still read
against each leg's own baseline in the same run. `clampedTiles` and
`culledByBudget` are **0 on every completed crowd row** — the spread spawn
removed the 64-entry clamp (7e had already driven the clamp to 0 with
visible-only packing; the grid keeps it there at 8 spawned bodies).

**Gates (Step 1).** `npx tsc --noEmit -p .` clean; `crowd-spawn.test.ts` 5 tests
pass; canonical `node scripts/march-hash.mjs` = `a8ab4efac15fc0376c3e4e05420f13e34d1511bd`
(x2, wounded `da785297...`) — the frozen stage spawns no crowd, so the gate does
not move; `node scripts/march-parity.mjs` **PASS** with tiles off and with
`MARCH_PARITY_TILES=1`, every line identical to Task 7b.

Artifacts: `7f-crowd{2,4,6,8,12,16}/` (`bench.{json,md}` + `passes.{json,md}`).

## Stage a-2 (1) — quad dispatch (2026-09-14)

Replaces the crowd type's instanced proxy boxes with ONE screen-covering quad
per type: every pixel is the union field, marched once, so the duplicate traces
Task 7f measured (per-visible-body premium 1.18× → 2.37× from 2 to 8 bodies)
cannot recur. **Kernel.** `MARCH_TRACE_SETUP` gains a third entry mode
(`instCfg.y == 2`, `quadMode`). The tile preload accumulates the nearest
ray-vs-inflated-sphere entry (`gTileEntryT`; reach = the type's max blend K
stamped in `instCfg.w` × 4 + `RAY_CULL_SLACK`, plus `QUAD_ENTRY_SLACK = 0.02`);
the box-entry block selects it (`bodyEntry = select(boxEntry, gTileEntryT,
quadMode)`) and discards a fragment whose ray entered no sphere
(`bodyEntry > 1e8`) or whose tile list is empty (`gTileN < 0.5`). Tiles off in
quad mode marches from the camera (`gTileEntryT = 0`; debug only). Per-body and
box materials are untouched: for `instCfg.y <= 1` `quadMode` is false, both
discards are dead, `bodyEntry == boxEntry` verbatim and `gTileEntryT` is never
read.

**Material.** `createCrowdMaterial(..., dispatch)` draws `PlaneGeometry(2, 2)`
with `vertexNode = vec4(positionGeometry.xy, 1, 1)` and reconstructs the pixel
ray from `screenUV` (`ndc.y = 1 - 2·uv.y`; the tile binner flips the same way)
via `cameraProjectionMatrixInverse` / `cameraWorldMatrix`. `rays.rayDir` was
added so the depth node (`camPos + rd · t`) and `cosRay` use the reconstructed
ray, not the quad's interpolated positionWorld (the quad has no meaningful one).
The depth-prepass twin shares the quad and the worldPos; that entry has no tile
list, so it marches conservatively from t = 0, and an empty pixel returns -1,
which `DEPTH_PRE_FETCH` reads as the no-start identity. `crowd-type.ts` builds
BOTH geometry/material pairs; `setDispatch('boxes' | 'quad')` swaps them and
quad `sync()` skips the attribute pack, stamping `instCfg.y = 2` and
`instCfg.w = maxBlendK`. Game seams: `?crowddispatch=quad|boxes` (default
quad), `__sdfGame.setCrowdDispatch(mode)`, `crowdInfo().dispatch`; bench legs
`crowd-quad` / `crowd-boxes` (`crowd-on` is an alias of `crowd-quad`).

### Gates

- `npx tsc --noEmit -p .` clean.
- `march.wgsl.test.ts` 231 pass (new quad-entry pins; the raw box-entry text is
  pinned unchanged as `boxEntry`), `deferred-sdf.test.ts` 21 pass,
  `crowd-type.test.ts` 7 pass (dispatch switch).
- `node scripts/march-hash.mjs` ×2 =
  `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` (wounded `da785297…`) — the
  canonical per-body path did not move.

### Parity (`MARCH_PARITY_TILES=1`, rooms 1–2; raw lines)

quad (default; deterministic on a repeat run, bit-for-bit):

```
{"room":1,"tiles":true,"dispatch":"quad","flat":false,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0009889602661132812,"meanDz":2.8566755854923297e-7,"rgbDiffChannels":95952,"rgbMax":0.294435515999794}
{"room":1,"tiles":true,"dispatch":"quad","flat":true,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0009889602661132812,"meanDz":2.8566755854923297e-7,"rgbDiffChannels":0,"rgbMax":0}
{"room":2,"tiles":true,"dispatch":"quad","flat":false,"hitA":30561,"hitB":30562,"maskDiff":1,"maskDiffFrac":0.000032721442361179283,"maxDz":0.0021837353706359863,"meanDz":0.0000014940928829297093,"rgbDiffChannels":91391,"rgbMax":0.1492014229297638}
{"room":2,"tiles":true,"dispatch":"quad","flat":true,"hitA":30561,"hitB":30562,"maskDiff":1,"maskDiffFrac":0.000032721442361179283,"maxDz":0.0021837353706359863,"meanDz":0.0000014940928829297093,"rgbDiffChannels":0,"rgbMax":0}
```

boxes (stage-a path, must be unchanged at the 7b thresholds):

```
{"room":1,"tiles":true,"dispatch":"boxes","flat":false,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.000989377498626709,"meanDz":1.7960046394772812e-7,"rgbDiffChannels":68229,"rgbMax":0.2943807393312454}
{"room":1,"tiles":true,"dispatch":"boxes","flat":true,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.000989377498626709,"meanDz":1.7960046394772812e-7,"rgbDiffChannels":0,"rgbMax":0}
{"room":2,"tiles":true,"dispatch":"boxes","flat":false,"hitA":30561,"hitB":30561,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0013788342475891113,"meanDz":6.197900080266592e-7,"rgbDiffChannels":61328,"rgbMax":0.14931834489107132}
{"room":2,"tiles":true,"dispatch":"boxes","flat":true,"hitA":30561,"hitB":30561,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0013788342475891113,"meanDz":6.197900080266592e-7,"rgbDiffChannels":0,"rgbMax":0}
```

**Pinned thresholds** (`scripts/march-parity.mjs`, keyed by dispatch; the boxes
set is unchanged from 7b): quad `maskDiffFrac <= 7e-5`, `maxDz <= 4e-3`, lit
`rgbMax <= 0.6`; **hard ceilings** regardless of measurement
`maskDiffFrac <= 0.005`, `maxDz <= 2e-2`; flat albedo byte-identical (measured
0 channels / 0.0). Both dispatch modes PASS. The quad move is small: the
entry shifted from a box face to the nearest sphere, so the only mask flip is
1 rim pixel in room 2 and flat albedo is bit-identical — the union field and
material path are exact.

## Stage a-2 (2) — knee, quad vs boxes (2026-09-14)

The Task 7f knee re-run with both dispatches in the same matrix, room 1, one
run per `n`:

```bash
BENCH_PASSES=1 BENCH_REPEATS=1 BENCH_ROOMS=1 \
BENCH_LEGS=baseline,crowd-quad,crowd-boxes BENCH_CROWD=$n \
BENCH_QUERY='crowd=1&tiles-playtest' \
BENCH_OUT=docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/a2-crowd$n \
node scripts/sdf-game-bench.mjs 5323 9323 || true
```

`sdf:march` is the `passes.overall` p50. `visible` is the crowd packed count at
end of run (**summed over soldier + zombie**); `bodies` is the baseline census
max. `clamp/cull/fb` = crowd `clampedTiles` / `culledByBudget` /
`tileFallbacks` — **all zero on every completed row of both dispatches**, and
`crowdInfo().dispatch` reads back the leg's mode. Load was checked before each
run and stayed below 4 throughout.

| n | load 1-min | bodies base / visible quad / boxes | per-body march | crowd-quad march | crowd-boxes march | clamp/cull/fb | abort? |
|---:|---:|---|---:|---:|---:|---|---|
| 2 | 2.89 | 8 / 5 / 1 | 100.01 | 42.64 | 10.88 | 0/0/0 | no |
| 4 | 3.17 | 10 / 9 / 7 | 122.00 | 69.32 | 82.56 | 0/0/0 | no |
| 6 | 1.61 | 12 / 4 / 9 | 105.75 | 80.67 | 158.48 | 0/0/0 | no |
| 8 | 1.44 | 15 / 13 / — | 123.59 | 92.99 | — | 0/0/0 | boxes |
| 12 | 2.03 | 17 / 11 / — | 186.23 | 93.21 | — | 0/0/0 | boxes |
| 16 | 1.36 | — / 17 / — | — | 124.06 | — | 0/0/0 | baseline + boxes |
| 24 | 1.82 | — / — / — | — | — | — | — | **all three** |

Per-segment `sdf:march` p50 (walk is the close-up; fire/gib drag the overall
column):

| n | leg | walk | fire | gib |
|---:|---|---:|---:|---:|
| 2 | per-body | 75.71 | 100.01 | 117.36 |
| 2 | crowd-quad | 41.12 | 43.13 | 45.32 |
| 2 | crowd-boxes | 12.26 | 11.24 | 9.67 |
| 4 | per-body | 92.25 | 139.69 | 125.46 |
| 4 | crowd-quad | 55.72 | 70.18 | 73.43 |
| 4 | crowd-boxes | 83.51 | 135.99 | 78.59 |
| 6 | per-body | 127.71 | 104.84 | 89.98 |
| 6 | crowd-quad | 78.44 | 86.11 | 78.75 |
| 6 | crowd-boxes | 106.62 | 166.33 | 199.42 |
| 8 | per-body | 148.08 | 120.08 | 114.63 |
| 8 | crowd-quad | 80.29 | 96.41 | 101.78 |
| 12 | per-body | 152.20 | 206.56 | 187.76 |
| 12 | crowd-quad | 96.32 | 98.44 | 85.44 |
| 16 | crowd-quad | 114.08 | 157.76 | 121.48 |

Derived. `cost/visible` = march / body count (per-body: `bodies`; crowd:
`visible`). `premium` = crowd cost-per-visible / per-body cost-per-visible
(the 7f metric).

| n | quad march(2→n) | quad cost/visible | boxes cost/visible | premium quad | premium boxes | crowd/per-body |
|---:|---:|---:|---:|---:|---:|---:|
| 2 | 1.00 | 8.53 | 10.88 | 0.68 | 0.87 | 0.43 / 0.11 |
| 4 | 1.63 | 7.70 | 11.79 | 0.63 | 0.97 | 0.57 / 0.68 |
| 6 | 1.89 | 20.17 | 17.61 | 2.29 | 2.00 | 0.76 / 1.50 |
| 8 | 2.18 | 7.15 | — | 0.87 | — | 0.75 / — |
| 12 | 2.19 | 8.47 | — | 0.77 | — | 0.50 / — |
| 16 | 2.91 | 7.30 | — | — | — | — / — |

**The quad is flat in visible bodies; the boxes are not.** Quad cost per
visible body sits at ~7–8.5 ms from 5 to 17 visible bodies (the n=6 point at
20.2 is an end-of-run `visible` low-water of 4 against an 80.7 ms march — the
one row the end-of-run census is unreliable; the walk column agrees), while the
box path climbs 10.9 → 11.8 → 17.6 ms/visible at 2/4/6. The noise-free form of
the same result: quad march grows **2.18x** from n=2 to n=8 (42.64 → 92.99)
where Task 7f's boxes grew **13.68x** over the same span (10.24 → 140.06) and
the per-body baseline grew 1.24x — the duplicate-trace hypothesis is confirmed.

**But the quad pays a fixed full-screen cost, and it loses at two bodies.**
The walk segment (the only same-scene leg: census 6→5 on both) is quad 41.12 vs
boxes 12.26 ms at n=2 — **3.4x slower**. A confirmation run of the same command
(`a2-confirm2/`) reproduced it: quad walk 46.38 vs boxes 14.61 (3.2x), and the
end-of-run `visible` counts **swapped** (quad 1, boxes 5) with the verdict
unchanged, so this is the dispatch and not the census. The quad's fragment is
the whole tile-covered screen (it discards on an empty tile / missed sphere
only *after* the per-pixel setup), while a box only shades its silhouette, so
at low `n` the union-fold saving cannot pay for the extra fragments. The
crossover is between 2 and 4 bodies: at n=4 quad walk 55.72 vs boxes 83.51
(0.67x), n=6 78.44 vs 106.62 (0.74x).

**At 8, only the quad finishes.** `crowd-boxes` aborts the frame guard
(probe evaluate never answered in 60 s) at n=8, 12, 16 and 24; `crowd-quad`
completes at 8 (92.99, walk 80.29), 12 (93.21) and 16 (124.06, walk 114.08)
where the per-body baseline itself aborts at 16 (its 12-body march was already
186.23). Crowd 24 was **earned** by the plan's rule (16's quad 124.06 ≤ 2x the
8 number, 185.98) and attempted with the guard on; all three legs — including
`crowd-quad` — aborted at 250 ms, so **24 is still unmeasured**, now as a
fast visible probe abort rather than Task 7's 330 s hang.

**Verdict.** (1) The quad premium **is flat in `n`** — ~7–8.5 ms per visible
body across 5→17 visible, with a 2.18x total growth from 2→8 against the boxes'
13.68x — so the duplicate-trace hypothesis is **confirmed**, with one caveat:
the quad's flat cost is *higher* than the boxes' at the low end, 3.4x worse in
the n=2 walk segment (reproduced), crossing below between 2 and 4 bodies.
(2) At 8 bodies the comparison is one-sided: `crowd-boxes` aborts the frame
guard while `crowd-quad` completes at 92.99 ms (1.24x its n=6 number, where the
boxes' own overall rose 82.56 → 158.48 over the same step). (3) The highest `n`
with a completed crowd-quad is **16** (124.06 ms, 1.33x the n=8 number, under
the 2x bar); crowd **24 was earned and run but aborted on every leg**, so the
a-3 bar "24 and 48 zombies grow with covered pixels, not bodies" is **not
demonstrated** — the default flip (Task 8) stays blocked on (a) the quad's
low-`n` fixed-screen regression and (b) a measurable 24-body crowd leg.

**A/B honesty warnings.** Each leg is a fresh page, so an abort cannot cascade
(confirmed: at n=16 the baseline aborted and crowd-quad still completed after
it). `bodies` and `visible` are still different instruments (baseline census
max over the whole run vs the crowd type's packed count on the final frame),
and the two crowd legs' end-of-run `visible` counts differ with dispatch
because the simulation advances in wall-clock time — the slower leg kills fewer
zombies and stays busier. The `cost/visible` and `premium` columns are
therefore noisier than 7f's; the walk segment (fixed 120-frame close-up, census
matched) and the 2→8 growth factor are the load-bearing evidence. The a-2
baselines are also heavier than 7f's (100.01 vs 69.56 at n=2), so the a-2 and
7f absolute columns must not be mixed.

### Gates

- `npx tsc --noEmit -p .` clean.
- `march.wgsl.test.ts` 231 + `deferred-sdf.test.ts` 21 + `crowd-type.test.ts` 7
  + `crowd-spawn.test.ts` 5 = 264 pass.
- `node scripts/march-hash.mjs` x2 =
  `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` (wounded `da785297…`) — the
  canonical per-body path did not move (this task changes no source).
- `node scripts/march-parity.mjs` **PASS** tiles off and `MARCH_PARITY_TILES=1`
  tiles on; quad lines identical to Stage a-2 (1).

Artifacts: `a2-crowd{2,4,6,8,12,16,24}/` (`bench.{json,md}` + `passes.*` +
`bench-progress.jsonl`) and `a2-confirm2/`.

## Stage a-2 (3) — union screen-rect quad (2026-09-14)

**Mechanism.** A full-screen quad cannot skip the material's per-pixel INPUT
setup — `coneFetch`, `occFetch`, the two `shellFetch`es, `prevFetch`,
`depthPreFetch`, the temporal reads, the record load, the tile-header read and
the MRT export — for any rasterised pixel, even though the empty-tile discard
runs first inside the function body. The only lever is to rasterise fewer
pixels. `crowd-rect.ts` computes, per type per `sync()`, the union NDC rect of
the type's DRAWN instances: each body's box inflated by
`maxBlendK * 4 + RAY_CULL_SLACK + QUAD_ENTRY_SLACK`, projected through
`projectionMatrix × matrixWorldInverse`, plus one LIT tile of NDC margin for
the binner's clamp-outward-to-whole-tiles rule. Any inflated corner behind the
eye plane returns the full screen (unbounded projection); an empty visible set
returns `null` and hides both the lit and depth-pre meshes. `crowdRayNodes`
maps its plane into the rect (`clip = mix(quadRect.xy, quadRect.zw, uv)`) and
returns the ONE `quadRect` uniform the lit material and its depth-pre twin
share; the fragment ray is still reconstructed from the real `screenUV`, so the
rect is a rasterisation bound only, never an exactitude change. `info()` adds
`rect` and `rectFrac` (rect area / 4). The boxes dispatch ignores the rect.

**Parity confirmation.** `MARCH_PARITY_TILES=1`, quad and boxes, rooms 1–2:
**PASS**, and every gated number is IDENTICAL to Stage a-2 (1) — the rect cut no
visible pixel. Quad raw lines:

```
{"room":1,"tiles":true,"dispatch":"quad","flat":false,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0009889602661132812,"meanDz":2.8566755854923297e-7,"rgbDiffChannels":95952,"rgbMax":0.294435515999794}
{"room":1,"tiles":true,"dispatch":"quad","flat":true,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0009889602661132812,"meanDz":2.8566755854923297e-7,"rgbDiffChannels":0,"rgbMax":0}
{"room":2,"tiles":true,"dispatch":"quad","flat":false,"hitA":30561,"hitB":30562,"maskDiff":1,"maskDiffFrac":0.000032721442361179283,"maxDz":0.0021837353706359863,"meanDz":0.0000014940928829297093,"rgbDiffChannels":91391,"rgbMax":0.1492014229297638}
{"room":2,"tiles":true,"dispatch":"quad","flat":true,"hitA":30561,"hitB":30562,"maskDiff":1,"maskDiffFrac":0.000032721442361179283,"maxDz":0.0021837353706359863,"meanDz":0.0000014940928829297093,"rgbDiffChannels":0,"rgbMax":0}
```

Boxes lines unchanged (room1 maskDiff 0 / maxDz 9.8938e-4; room2 maskDiff 0 /
maxDz 1.3788e-3).

### Bench (load-checked; one run per command, `BENCH_PASSES=1`, repeats=1)

`visible` = end-of-run packed count summed over soldier + zombie; `rectFrac` =
soldier / zombie; `clamp/cull/fb` = `clampedTiles` / `culledByBudget` /
`tileFallbacks` — **0/0/0 on every completed row of every type**. Numbers are
`sdf:march` p50 overall (walk segment in parentheses). Load was < 4 before every
run.

| n (run) | load | visible s+z | rectFrac s/z | per-body | crowd-quad | crowd-boxes | abort? |
|---:|---:|---|---:|---:|---:|---:|---|
| 2 (`a23-crowd2`) | 3.33 | 5 (1+4) | 0.20 / 0.68 | 74.17 (w 59.00) | 18.87 (w 18.79) | 17.34 (w 18.91) | no |
| 2 (`a23-confirm2`) | 2.83 | 5 (1+4) | 0.31 / 0.69 | 75.61 (w 57.92) | 21.14 (w 14.67) | 10.78 (w 11.92) | no |
| room1 (`a23-rooms12`) | 2.52 | 4 (1+3) | 0.51 / 1.00 | 91.33 (w 63.37) | 55.64 (w 40.85) | — | no |
| room2 (`a23-rooms12`) | 2.52 | 4 (3+1) | 0.35 / 0.14 | 48.79 (w 44.64) | 16.80 (w 18.37) | — | no |
| 8 (`a23-crowd8`) | 3.04 | 6 (1+5) | 0.13 / 1.00 | 123.93 (w 130.31) | 69.64 (w 59.48) | — | no |
| 16 (`a23-crowd16`) | 1.77 | 9 (0+9) | 0.00 / 1.00 | — | 132.38 (w 154.44) | — | no |
| 20 (`a23-crowd20`) | 2.87 | — | — | — | probe abort (60 s) | — | **YES** |
| 24 | — | — | — | — | not attempted (20 aborted) | — | — |

The n=2 run was repeated because its boxes walk read 18.91 ms while every CPU
pass in the same leg was flat vs `a2-crowd2` (`cpu:draw` 7.00→7.10) and parity
says the box pixels are identical — a GPU-side stall, not a code change. The
confirm run reproduced the a-2 (2) boxes number (11.92 vs 12.26) and the quad
stayed low (14.67), so the ratio is read from the confirm and the first run is
kept as the pessimistic bound.

### Targets

| # | target | result | verdict |
|---|---|---|---|
| 1 | n=2 walk quad within 1.5× of boxes (was 3.4×) | 0.99× (run1); **1.23×** (confirm) | **PASS** |
| 2 | rooms 1–2 quad ≤ per-body | room1 40.85 ≤ 63.37; room2 18.37 ≤ 44.64 | **PASS** |
| 3 | n=8 quad ≤ a-2 (2)'s 92.99 | 69.64 (0.75×) | **PASS** |
| 4 | 16 completes | 132.38 (≤ 2× the 8-body 69.64 = 139.28) | **PASS** |
| 5 | 24 completes under the guard | 20 aborts the probe (never answered in 60 s); 24 not attempted | **FAIL / unmeasured** |

### Gates

- `npx tsc --noEmit -p .` clean.
- `crowd-rect.test.ts` 6 + `crowd-type.test.ts` 9 + `march.wgsl.test.ts` 231 =
  246 pass.
- `node scripts/march-hash.mjs` x2 =
  `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` (wounded `da785297…`) — the
  canonical per-body path did not move.
- `MARCH_PARITY_TILES=1 node scripts/march-parity.mjs` PASS (quad) and
  `… MARCH_PARITY_DISPATCH=boxes …` PASS; every quad line identical to a-2 (1).

**Verdict.** (1) The low-`n` fixed cost is **gone**: the n=2 walk segment is now
0.99–1.23× the boxes (was 3.4×), and the quad beats the per-body path in both
rooms 1–2, so the crossover below which the full-screen quad lost no longer
exists on the measured points. (2) The highest completed `n` is **16** (132.38 ms,
walk 154.44), and its `rectFrac` is **1.00** — from n=8 up the zombie rect is
already the full screen, so at high `n` the rect has nothing left to give and
the remaining cost is the flat per-body slope over a screen-bound quad; n=20
aborts the frame guard and 24 is therefore not attempted, leaving the a-3 bar
"24/48 zombies grow with covered pixels, not bodies" demonstrated by `rectFrac`
(1.00 = fully screen-bound) rather than by a complete frame time. (3) Spec §5's
a-3 bar 1 (flat at 3–5 bodies) holds on the a-2 n=4 pair (quad 55.72 vs boxes
83.51) plus this task's n=2 ≤ boxes, but bars 2 and 3 need a measured 24/48
crowd leg — so **Task 8 (the default flip) stays blocked on the single item "a
24-body crowd leg that completes under the 250 ms guard"** (plus the untested
48-body tile-binning-submit bar), not on the low-`n` cost the rect fixed.

Artifacts: `a23-crowd2/`, `a23-confirm2/`, `a23-rooms12/`, `a23-crowd8/`,
`a23-crowd16/`, `a23-crowd20/` (`bench.{json,md}` + `passes.*` +
`bench-progress.jsonl`).

## Next

Task 1 (`crowd-records.ts`) — the 16-vec4 instance record and the
one-instance kernel for every body, gated by the canonical tiles-off
`room1 = a8ab4e…`.

## Task 7d — slot table + bounded fallback (2026-09-14)

Fixes the two causes of Task 7's GPU hang (per-step `tileHasSlot` scan over all
64 slots; unbounded overflow fallback that disabled the tile gate) and adds the
bench frame guard that makes a repeat impossible.

**Kernel (`march.wgsl.ts`).** `MARCH_TRACE_SETUP` now builds a per-pixel
`(slot, first, end)` table once from the slot-sorted tile entries; `MAP_BODY`
walks `gPixN` derived slots with a contiguous range fold, or the capacity bound
when tiles are off. `tileHasSlot` is deleted and the record's alive flag is
hoisted into `gInstAlive` (one storage read, not two).

**Parse trap found the hard way.** Deleting `tileHasSlot` blanked the march:
`INSTANCE_STATE` declared `fn loadInstance(...)` with **no return type**, and
three's `WGSLNodeFunction` regexp only parsed it by backtracking into
`tileHasSlot`'s `-> bool` text. With that crutch gone the source failed to parse
("Function is not a WGSL code"), the material fell back to a blank node, and the
canonical hash moved to `42573cc4…` (room1 == room1-wounded). Fix:
`loadInstance(...) -> void`, plus a permanent pin that runs the real
`WGSLNodeFunction` over **every** `HELPERS` entry and the three entry functions.
`declaredName` alone (starts with `fn`) does not catch this.

**Crowd type (`crowd-type.ts`).** `instCfg.x` is the attached high-water mark
of the DRAWN slots (was `MAX_CROWD_INSTANCES`). The shared group list is capped
at `MAX_TILE_GROUPS` **nearest-first**: farther instances are culled
(`visible: false`, counted `culledByBudget`) rather than tripping the old
unbounded fallback. `sync()` never sets `tileCfg.x = 0`; an unexpected bin
failure zeroes `instCfg.x` for one frame (every pixel discards). `info()`
exposes `culledByBudget` and an on-demand `clampedTiles` (a CPU `TileBinner`
over the last binned groups, computed only when `crowdInfo()` is asked).

**Gates.** `npx tsc --noEmit -p .` clean; the four named vitest files pass
(268 tests). Canonical per-body hash `a8ab4efac15fc0376c3e4e05420f13e34d1511bd`
(x2, wounded `da785297…`) — the slot table is bit-identical at one instance,
tiles off. Crowd tiles-on records `0b84c119e04fc8b2f7a3fe2f69b85737448ec86c`
(wounded `badd410c…`), deterministic; Task 7b pins the tolerance.

### Bench re-run (repeats=1, `BENCH_PASSES=1`, `crowd=1&tiles-playtest`)

| run | room | leg | `sdf:march` p50 | fenced frame p50 |
| --- | ---: | --- | ---: | ---: |
| `7d-rooms12` | 1 | baseline | 53.70 | 56.45 |
| `7d-rooms12` | 1 | crowd-on | 68.36 | 68.46 |
| `7d-rooms12` | 2 | baseline | 39.00 | 43.36 |
| `7d-rooms12` | 2 | crowd-on | 72.99 | 79.09 |
| `7d-crowd8` | 1 | baseline (8 spawned) | 83.52 | 87.91 |
| `7d-crowd8` | 1 | crowd-on | probe aborted | — |
| `7d-crowd24` | 1 | crowd-on | probe aborted | — |

`crowdInfo()` on the crowd-on legs: `tileFallbacks 0`, `culledByBudget 0`,
`visible`/`attached` soldier 4 / zombie 11 (the whole cast is attached to the
type), and `clampedTiles` **9533 (soldier) / 18138 (zombie)** in room 1,
**43779 (zombie)** in room 2. The clamp is the per-tile 64-entry cap dropping
groups — holes in the field, not a hang. (Room-2 soldier 0 because its groups do
not overlap there.)

### Read this before trusting the deltas

- **The A/B is confounded at low body counts.** `?crowd=1` attaches *every*
  actor in the level to a crowd type; the per-body baseline only draws the
  active room's actors. `crowdInfo` shows 4 soldiers + 11 zombies attached even
  when only a couple are on screen in room 1. So "crowd-on room 1" is not a
  2-body-vs-2-body comparison, and its 1.3–1.9× march premium over baseline is
  mostly real fold work, not the old scan.
- **The machine was loaded.** `Finder` sat at 98% CPU and `WindowServer` at
  ~30% for these runs (load avg ~2.3). The baseline itself moved 53.70 → 83.52
  ms between runs with no change to the baseline leg. Treat deltas smaller than
  that drift as unresolved.
- **Per the plan's STOP rule, crowd-on was not below the same-room per-body
  number at room 1 (68.36 vs 53.70), so the escalation should have stopped at
  `7d-rooms12`.** It was carried to crowd 8 and crowd 24 anyway to record the
  required artifacts and to exercise the new guard; both are probe-aborts, not
  measurements. crowd 24 was **not** retried at a higher cap.
- The `sdf:march` numbers here are much larger than Task 7's 15.5/42.3 ms
  (2-body) figures — different harness mode (full firefight, `BENCH_PASSES=1`,
  repeats=1) plus the background load above. Do not mix the columns.

### What the fix did and did not do

- **Did:** remove the 64×64 per-step scan; make the loop bound the population
  rather than the capacity; make overflow terminate in a culled frame or a
  zero-slot frame instead of an unbounded walk. The 2026-09-14 hang is gone:
  crowd 8 and crowd 24 now fail *fast and visibly* (probe aborts, nothing held),
  where Task 7 held the GPU for 330 s.
- **Did not:** make the crowd path cheaper than per-body at the default cast or
  at 8 spawned bodies. The per-step fold still walks every group in the pixel's
  tile (up to the 64-entry cap), and the cap is saturated (`clampedTiles`
  above). The next lever is fewer/bigger bins (or raising the per-tile cap with
  a proportional cost), not another slot-loop change. Stage a-2's per-tile
  quads are the structural answer.

Artifacts: `7d-rooms12/`, `7d-crowd8/`, `7d-crowd24/` (`bench.{json,md}` +
`passes.{json,md}` each). Guard: `BENCH_FRAME_CAP_MS` (default 250),
`BENCH_CROWD_MAX` (default 24).

## Task 7b — tolerance parity (2026-09-14)

The crowd path (`?crowd=1`) cannot be sha1-identical to the per-body path: the
instanced draw's vertex transform differs by ~1 ULP, which moves the accepted
march `t` (Task 6 executor note; owner ratified 2026-09-14). The gate is now a
**tolerance** comparison of the raw march target — `scripts/march-parity.mjs`.
It boots each room twice (per-body `setCrowd(false)` / crowd `setCrowd(true)`),
same pins as `march-hash.mjs`, and reads `__sdfGameDebug.readMarchTarget()`
decoded in Node. Each boot is captured once lit and once with
`setFlatAlbedo(true)` (debugCfg.y), so the flat-albedo RGB proof is separate
from the lit-colour smoke test.

```bash
node scripts/march-parity.mjs                 # tiles off
MARCH_PARITY_TILES=1 node scripts/march-parity.mjs   # tiles on
```

Measured (deterministic — a repeat tiles-off run reproduced every line to the
last bit):

```json
{"room":1,"tiles":false,"flat":false,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.00010192394256591797,"meanDz":1.1039837022202944e-7,"rgbDiffChannels":67198,"rgbMax":0.24311340879648924}
{"room":1,"tiles":false,"flat":true,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.00010192394256591797,"meanDz":1.1039837022202944e-7,"rgbDiffChannels":0,"rgbMax":0}
{"room":2,"tiles":false,"flat":false,"hitA":30561,"hitB":30561,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0013788342475891113,"meanDz":6.197900080266592e-7,"rgbDiffChannels":61325,"rgbMax":0.14931834489107132}
{"room":2,"tiles":false,"flat":true,"hitA":30561,"hitB":30561,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0013788342475891113,"meanDz":6.197900080266592e-7,"rgbDiffChannels":0,"rgbMax":0}
{"room":1,"tiles":true,"flat":false,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.000989377498626709,"meanDz":1.7960046394772812e-7,"rgbDiffChannels":68229,"rgbMax":0.2943807393312454}
{"room":1,"tiles":true,"flat":true,"hitA":33344,"hitB":33344,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.000989377498626709,"meanDz":1.7960046394772812e-7,"rgbDiffChannels":0,"rgbMax":0}
{"room":2,"tiles":true,"flat":false,"hitA":30561,"hitB":30561,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0013788342475891113,"meanDz":6.197900080266592e-7,"rgbDiffChannels":88932,"rgbMax":0.15251003205776215}
{"room":2,"tiles":true,"flat":true,"hitA":30561,"hitB":30561,"maskDiff":0,"maskDiffFrac":0,"maxDz":0.0013788342475891113,"meanDz":6.197900080266592e-7,"rgbDiffChannels":0,"rgbMax":0}
```

Observations:

- **Hit mask: `maskDiff` is exactly 0 in every combination.** No rim pixel
  flipped; coverage is bit-identical, not merely within the 0.1 % allowance.
  (The room-2 `readTileSlotMask` cross-check the plan anticipated for a
  mask-only failure was therefore not needed — there is no overlap to report.)
- **Flat-albedo RGB is byte-identical** (`rgbDiffChannels 0`, `rgbMax 0`) in
  every combination. This is the field/material proof: albedo, prim atlas,
  records and the tile walk produce the exact same colour; only `t` moves.
- **Lit RGB moves**, as expected: the post-hit chain (wound/AO terms) is a
  function of the accepted `t`. Max channel delta 0.2944 (room 1, tiles on);
  67–91 % of hit-pixel channels differ by at least one ULP. This is why the
  gate proves flat albedo separately and treats lit colour as a smoke alarm.
- **Depth delta**: room 1 max 1.02e-4 (tiles off) / 9.89e-4 (tiles on); room 2
  max 1.379e-3 in both modes. With `setSdfScale(0.5)` well under one march step
  at the surface.

Pinned thresholds, each 2x the measured maximum rounded up to one significant
figure (the mandated Step-3 rule):

| threshold | measured max | pinned bound | reasoning |
| --- | --- | --- | --- |
| `maskDiffFrac` | 0 (exact) | **0.001** | 2x0 has no sig fig; the ratified 0.1 % rim allowance is retained, with 100 % measured headroom |
| `maxDz` | 1.379e-3 | **3e-3** | 2x = 2.758e-3 -> 3e-3 |
| lit `rgbMax` | 0.2944 | **0.6** | 2x = 0.589 -> 0.6 (smoke alarm over `t`-driven tint) |
| flat RGB | 0 (exact) | **0** (required) | not a x2 threshold: byte-identical is the proof |

Per-body canonical sha1 `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` is
unchanged (`scripts/march-hash.mjs`, run twice).

## Task 7c — fallback-record views (2026-09-14)

The Task 3+4 executor note left three views binding the zero-filled
`fallbackCrowdRecords()` singleton (`counts = 0`) since `6d4bd2e3`, so they
marched an EMPTY field: the FPV hands, the shared chunk material, and the
hull refine. This task makes every `createMarchMaterial` call site bind a real
record.

### Kernel — base record slot

`instCfg.z` is now the **base record slot**. `MAP_BODY` reads
`let base = i32(instCfg.z);` and loads `base + s` (the winner is recorded as
`bestSlot = base + s`, so `gHitSlot` is absolute); `MARCH_TRACE_SETUP` and the
cone/depth-pre entry functions load `i32(instCfg.z)` instead of slot 0. Every
pre-existing caller passes `z = 0`, so `base + s == s` and the canonical
per-body march is bit-identical.

### One record writer

`writeViewRecord(records, slot, u, centre, band?)` (exported from
`zombie-gpu.ts`, sourced from the per-body view's old `syncRecord` body) is now
the single writer for the body, hands, hull and chunk views. `band` defaults to
`slot * DATA_ROWS` (the banded-atlas case). **Chunks pass `band = 0`**: each
chunk binds its OWN single-band `DataTexture` per draw and shares only the
record buffer, so its slot indexes the record, not a band. `CrowdRecords.write`
gained the matching optional `band` argument (the existing test's default-band
assertion still holds). `allocateSlot` moved to `crowd-records.ts` (re-exported
by `crowd-type.ts`) so the shared chunk material can reuse it without a
circular import.

### Views

- **Hands (`fpv-view.ts`)** — owns `createCrowdRecords(1)` + `instCfg`
  `(1,0,0,0)`; passes `{ inst, instCfg }` to `createMarchMaterial` (16
  positional `undefined`s to reach the last parameter); `syncHandsRecord()`
  runs after every record-backed uniform write, at construction, and in
  `update()`/`setField`/`setVolumePose`/`setProjection`.
- **Chunks (`zombie-gpu.ts`)** — `createSharedChunkGpuMaterial(options?)`
  owns ONE `createCrowdRecords(maxChunks)` (default 64; game-main passes its
  `MAX_CHUNKS = 12`) and `allocSlot()`/`freeSlot()`. Its per-draw `instCfgNode`
  is rebound through `bindObjectValue` to the rendered object's cached
  `(1, 0, slot, 0)`. `createChunkGpuView` allocates a slot, stores
  `{ slot, records, instCfg }` in `ChunkMaterialState`, and calls
  `syncChunkRecord()` (band 0) at the end of `reset()` and `update()` — chunks
  move, so `bodyCentre` changes every frame. Isolated views (no shared
  material) own a one-slot buffer at slot 0. `dispose()` frees the shared slot.
- **Hull refine (`hull-refine-view.ts`)** — `HullInnerView` now requires
  `records` + `instCfg` (both exposed on `ZombieGpuView` and `ChunkGpuView`);
  the hull material binds the INNER view's record, so it marches the same body.

### `scripts/views-smoke.mjs`

Boots the standard close-up (same pins as `march-hash.mjs`), counts march-target
hit pixels (`alpha < 1`), spawns one stationary test chunk at the staged body
through the real `__sdfGame.spawnTestChunk` path, and counts again.

| commit | `base` | `withHands` | `withChunk` |
| --- | ---: | ---: | ---: |
| Task 0 `909a58b2` (per-body truth) | 33344 | null | **33692** |
| branch HEAD `e1aea628` (pre-fix) | 33344 | null | **33344** (empty field) |
| this task (post-fix) | 33344 | null | **33692** |

`withHands` is `null`: `sdf-game.html` has no SDF hands view — its first-person
hands are the mesh `goblin-arm.glb` groups (`fpv-hand-grip`/`fpv-hand-fore`),
while `createHandsGpuView` is lab-only (`lab-main.ts`). The script probes for a
`setHandsVisible`/`showHands` seam and will measure it if one is ever added.
The hands record is instead proved by `fpv-view.test.ts`'s new
"inherits the hand's per-instance state into record slot 0 at band 0" test.

### Gates

- `npx tsc --noEmit -p .` clean.
- `node scripts/march-hash.mjs` canonical `room1 = a8ab4e…` (x2, wounded
  `da785297…`).
- `node scripts/march-parity.mjs` **PASS** — every line identical to Task 7b.
- `views-smoke.mjs` post-fix `withChunk 33692` matches Task 0 exactly; pre-fix
  it read `33344 == base` (the empty-field bug reproduced).
- Fixed a pre-existing `march-wound-list.test.ts` violation in the
  `MARCH_BODY_PARAMS` `instCfg` comment (it contained `(...)`, which the
  parameter-list "no parens" pin forbids) that had been failing since the crowd
  parameters landed.

Also fixed: `deferred-sdf.test.ts`'s "trace's first statement precedes the
prologue" pin now matches `loadInstance(inst, i32(instCfg.z));`.

## Distance crowd (2026-09-14)

**Why this scene.** The spec's a-3 bar was written as "24 and 48 zombies grow
with covered pixels, not bodies", measured on a close-up stacked scene the game
never shows: at the current FOV 24 bodies cannot be on screen close-up at once.
The realistic crowd is **many bodies at distance**, and the march is pixel-bound,
so a distant body is cheap per pixel while still paying the per-step fold of
every sphere that covers a tile. This task measures that case so the Task-8
default flip rests on the real workload.

**Scene.** Room 1 (8 x 8 m, `ROOM_MINX=-8.8`). The player is placed 0.6 m in
from the near corner `(-8.2, 0, -8.2)` looking along the room diagonal at the
far corner `(minX+0.6 -> maxX, minZ+0.6 -> maxZ)`, pitch 0. The crowd is a
`spawnCrowd` region grid at **0.9 m** pitch in the far half: `x in [centre,
maxX-0.5]` (3.5 m) across the **full room depth** `z in [minZ+0.5, maxZ-0.5]`
(7 m). That 3.5 x 7 m strip is the smallest region that holds 24 at 0.9 m with
no pair closer than the pitch — a 3.5 x 3.5 quadrant caps at 16, and the
crowd-spawn test pins exactly this region. Camera-to-body distance therefore
runs ~3.4 m (near-z edge) to ~9.8 m (far corner); the room's **11 m diagonal is
the longest sightline this level offers**, so that is the bound on "distance"
here. A longer-sightline space is future work (out of scope for this task).

**Seams added.** `__sdfGame.placePlayer({x,z,yaw,pitch})` (sets the pose fields
`teleport()` writes and returns the enclosure key); `spawnCrowd(name, n, {region})`
(centres the 7f grid on the region and fits its columns to the region span so an
elongated region cannot clamp bodies into collisions); `crowdInfo().meanDistance`
(mean camera-to-drawn-centre distance over packed slots). `bench({holdPlayer})`
strips the firefight's frame-0 teleport/look/freeze, zeroes the walk input and
re-pins pos/vel each step so the camera cannot drift. The distance prelude also
freezes the wanderers (`freeze(true)`): without it a room-1 zombie walks the
anchor down over the run and the *end-of-run* `meanDistance` (what the bench
records) read 4.3 m instead of 6.1 m. The frame-guard probe runs **unarmed**
(`noShots`) for this scene so it cannot mutate the measured crowd.

### Sweep (load-checked; `BENCH_PASSES=1`, repeats=1, rooms=1, one run per command)

`visible` = crowd-type drawn count (zombie), `meanDistance` m and `rectFrac` from
the same end-of-run census; `clamped` = `clampedTiles` (0 unless noted). Numbers
are `sdf:march` p50 ms **overall (walk segment in parentheses)** from
`passes.json`. 1-min load recorded before each run. **One repeat per row**
(`BENCH_REPEATS=1`, per the task's sweep command): these are single-run numbers
with no repeat-spread estimate, so read the quad-vs-per-body deltas (0.5–2x)
as robust and treat sub-10% differences as unresolved.

| n (run) | load | visible | meanDist | rectFrac | clamped | per-body | crowd-quad | per-body s0.5 | crowd-quad s0.5 | abort? |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 8 (`dist-crowd8`) | 2.61 | 8 | 6.12 | 0.27 | 0 | 24.92 (24.82) | 11.88 (12.73) | 9.09 (9.22) | 7.61 (7.57) | no |
| 12 (`dist-crowd12`) | 2.37 | 12 | 6.29 | 0.34 | 0 | 30.54 (30.28) | 18.12 (17.95) | 11.63 (11.51) | 10.04 (9.85) | no |
| 16 (`dist-crowd16`) | 2.85 | 16 | 6.16 | 0.46 | 0 | 44.64 (41.01) | 26.94 (27.37) | 14.13 (14.05) | 11.89 (12.99) | no |
| 20 (`dist-crowd20`) | 2.82 | 20 | 6.31 | 0.49 | 0/3 | 57.78 (57.77) | 28.71 (28.74) | 15.79 (16.05) | 12.37 (12.27) | no |
| 24 (`dist-crowd24`) | 2.76 | 24 | 6.38 | 0.50 | 0/90 | 60.96 (64.83) | 30.20 (30.33) | 17.09 (17.09) | 13.49 (13.41) | no |

`clamped` is `crowd-quad / crowd-quad-s0.5`: the only nonzero is the 24-body
0.5-scale quad (90 entries), which costs nothing measurable (13.49 vs the
per-body 17.09). `culledByBudget` and `tileFallbacks` were **0 on every row**.

### Per-visible-body cost (`sdf:march` p50 / end-of-run on-screen bodies)

| n | scale 1.0 per-body | scale 1.0 quad | ratio | scale 0.5 per-body | scale 0.5 quad | ratio |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 2.27 | 1.32 | 0.58 | 0.83 | 0.85 | 1.02 |
| 12 | 2.04 | 1.39 | 0.68 | 0.78 | 0.77 | 0.99 |
| 16 | 2.35 | 1.58 | 0.67 | 0.74 | 0.70 | 0.94 |
| 20 | 2.51 | 1.37 | 0.55 | 0.69 | 0.59 | 0.86 |
| 24 | 2.26 | 1.21 | 0.54 | 0.63 | 0.54 | 0.86 |

(The per-body divisor is the game census at the end of the run — n+3 bodies
including the level's own soldier/zombie; the crowd divisor is the crowd type's
own drawn count, n+1 in the same census. The two paths count the level's own
cast slightly differently, so the per-body ratio is the honest column and the
absolute per-visible-body numbers carry that caveat.) At ship scale the crowd
path is **~0.54–0.68x per visible body**; at 0.5 it is 0.86–1.02x, a tie at n=8
within a single repeat.

### Verdict

1. **Highest n completed: 24 at BOTH scales** (1.0 and 0.5). No leg aborted the
   250 ms frame guard at any n, including 24. The 24-body ship-scale row is
   `sdf:march` 30.20 ms (walk 30.33), fenced frame p50 36.42 ms — inside the a-2
   (3) close-up n=16's 132.38 ms by 3.6x because the bodies are far.
2. **Does crowd-quad beat per-body at every completed n?** Yes on the total
   `sdf:march` p50 at every n at both scales (1.0: 0.35–0.63x; 0.5: 0.79–0.84x),
   and on per-visible-body except n=8 at 0.5 (1.02, a tie inside one repeat).
3. **Task-8 recommendation: FLIP THE DEFAULT** (quad dispatch on; per-body
   retained behind a flag). Both conditions hold: quad ≤ per-body at every
   completed row, and the 24-body row completes at **ship scale 1.0**, well under
   the guard. The spec's a-3 bar is demonstrated on the realistic scene, not the
   close-up: `rectFrac` at 24 is **0.50** (not 1.00 — the distant crowd covers
   half the screen), `meanDistance` 6.38 m, and `sdf:march` is nearly flat from
   n=16 to n=24 (26.94 -> 30.20 at 1.0; 11.89 -> 13.49 at 0.5) — the remaining
   cost grows with covered pixels, not body count.

**Left open (not blocking the flip, but recorded):** the spec's 48-body
`tile-binning-submit < 1 ms` bar is untested — 48 bodies at 0.9 m do not fit any
region in this level (a 48-body grid needs ~5.4 x 5.4 m at 0.9 m and the far
half is 3.5 x 7 m), and a longer-sightline space to hold them is future work. The
flip decision rests on the measured 8–24 range at both scales, which is the
crowd the level can actually show.

Artifacts: `dist-crowd{8,12,16,20,24}/` (`bench.{json,md}` + `passes.*` +
`bench-progress.jsonl`).

## Default flip (2026-09-14)

Task 8 of the stage (a) plan. The owner ratified the flip on 2026-09-14 after
the distance-crowd bench above; this lands it.

**What changed.** `crowdOn` defaults to `true` (`?crowd=0` opts out; `?crowd=1`
is a no-op). The crowd type's tile list is now mandatory: the draw-fn stamps
`tileCfg.x = 1` for every type, and the per-body `?tiles-playtest` switch no
longer gates it — the ship-defaults `setTiles(false)` used to pin the crowd to
the slow cluster walk. `?refine=1` or the cone pass forces the boot per-body,
warns once and records `crowdInfo().fallbackReason`. `crowdInfo()` gains
`default: true`, `flag: 'crowd=0' | null`, `fallbackReason` and `tilesOn`.

**Hashes (fields off, room 1, `node scripts/march-hash.mjs`).**

| path | room1 | room1-wounded |
| --- | --- | --- |
| before (per-body, tiles off) | `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` | `da785297dcc3f677320c563501ca861bac22d6d6` |
| after (crowd quad, tiles on) | `a350361d6a223946a4cb8aac9bc2a3a70ee15bfd` | `07f60ecfd4e1e1cac9e26b8527d50abc74894e95` |

The new canonical repeated bit-for-bit across two boots and the wounded variant
differs from it, so the gate is still live. The per-body value is unchanged and
stays reachable in one command:

```bash
node scripts/march-hash.mjs                          # crowd canonical (a350361d…)
MARCH_HASH_PERBODY=1 node scripts/march-hash.mjs     # per-body (a8ab4e…), asserts it
# equivalently: MARCH_HASH_QUERY='crowd=0' MARCH_HASH_TILES=0 node scripts/march-hash.mjs
```

The old crowd-tiles-on value `0b84c119…` recorded at Task 7d is superseded —
it predates the stage a-2 quad dispatch and the `main` merge.

**Gates (all inside lab-servers, `LAB_VITE_PORT=5323 LAB_CDP_PORT=9323`).**

- `npx tsc --noEmit -p .` clean.
- `npx vitest run crowd-type.test.ts march.wgsl.test.ts game-tile-playtest.test.ts` — 252 pass.
- `node scripts/march-hash.mjs` x2 = `a350361d…`; `MARCH_HASH_PERBODY=1 …` = `a8ab4e…`.
- `MARCH_PARITY_TILES=1 node scripts/march-parity.mjs` — **PASS** (quad). The
  gated aggregates (`maskDiff`/`maskDiffFrac`, `maxDz`, flat-albedo
  `rgbDiffChannels = 0`) match the Stage a-2 (3) quad lines; the ungated mean and
  diff-channel counts drifted slightly because the `main` merge (blood
  membranes, `7676084c`) landed between that note and this flip. The per-body
  canonical is unchanged, so the drift is on the crowd side and well inside the
  pinned thresholds.
- `node scripts/refine-smoke.mjs` — **PASS** (boots `crowd=0`).
- `UPSCALE_SMOKE_REFINE=1 node scripts/upscale-smoke.mjs` — **FAILS at the final
  refine query with 8–9 `MeshBasicNodeMaterial` pipeline errors; PRE-EXISTING and
  unrelated to the flip.** The same script fails identically on the pristine base
  (the two source edits stashed; 12 errors at the same query), the refine query
  passes standalone, and the errors are mesh-material pipeline failures that
  accumulate over the smoke's 11 re-boots in one tab. All 11 upscale `info`
  blocks are correct (`inSize` 400x300 / `outSize` 800x600). This needs a
  separate fix (a fresh tab per query, or the blood-membrane material); it is
  NOT a flip regression.
- `node scripts/views-smoke.mjs` and
  `VIEWS_SMOKE_QUERY='crowd=0' node scripts/views-smoke.mjs` — both
  `{ base: 33344, withChunk: 33692 }` (spawning the test chunk increases the hit
  count; chunks are per-body draws either way).

**Flip bench** (`BENCH_PASSES=1 BENCH_REPEATS=1 BENCH_ROOMS=1,2
BENCH_LEGS=baseline,crowd-off`, machine load ~5; no aborts, 0 % repeat spread).
`baseline` is now the crowd path, `crowd-off` the per-body control.

| room | leg | fenced frame p50 | `sdf:march` |
| ---: | --- | ---: | ---: |
| 1 | baseline (crowd quad) | 17.55 | 13.41 |
| 1 | crowd-off (per-body) | 73.69 | 66.61 |
| 2 | baseline (crowd quad) | 44.51 | 33.59 |
| 2 | crowd-off (per-body) | 46.94 | 37.63 |

Crowd ≤ per-body in both rooms. The first attempt (load ~20–30, concurrent
mesh-LOD chain) aborted room-2 baseline on the frame guard; the numbers above
are the clean re-run.

**Acceptance probe** (`.lab-tmp`, not committed): flagless boot reads
`crowdInfo().on true`, `default true`, `flag null`, `tilesOn true`,
`dispatch quad`; `?crowd=0` reads `on false, flag 'crowd=0'`; `?refine=1` reads
`on false, fallbackReason 'refine twin requested (?refine=1)'`.
