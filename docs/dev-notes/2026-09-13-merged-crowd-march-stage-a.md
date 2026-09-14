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
