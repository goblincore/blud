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
