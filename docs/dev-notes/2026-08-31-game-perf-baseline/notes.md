# Game perf baseline (Phase 0) — taken

**Date:** 2026-08-31 · **Branch:** `claude/sdf-rendering-improvements-b3b219`
**Spec:** [2026-08-31-sdf-crowd-perf-investigation-design.md](../../superpowers/specs/2026-08-31-sdf-crowd-perf-investigation-design.md)
**Plan:** [2026-08-31-game-perf-baseline.md](../../superpowers/plans/2026-08-31-game-perf-baseline.md)

## Verdict

**Baseline taken.** The harness is built, unit-tested, and now produces
repeatable numbers — most legs repeat within **1-13%** across three identical
runs. Raw output: [`bench-rooms34.md`](bench-rooms34.md) /
[`bench-rooms34.json`](bench-rooms34.json).

The headline, and it is not what the plan expected:

> **Resolution scale is the dominant lever by a wide margin, and the occluder
> pre-pass is currently worth approximately nothing.**

| leg | room 3 (8 bodies) | room 4 (9 bodies) | read |
| --- | ---: | ---: | --- |
| baseline | 21.42 | 14.56 | — |
| occluder-off | 21.24 | 14.93 | **no effect** (−0.8% / +2.5%, inside spread) |
| cone-on | 18.77 | 14.73 | no effect (inside spread) |
| fxaa-off | 21.40 | 13.96 | FXAA ≈ 0-4%, marginal |
| scale-0.7 | 13.03 | 10.95 | **−39% / −25%** |
| scale-0.5 | 9.06 | 6.64 | **−58% / −54%** |

Throughput = median chunk-mean ms, median of 3 repeats.

Against the owner's target (p95 ≤ 33 ms over a firefight), the per-frame spike
pass reads **room 4 p95 30.3 ms** (inside) and **room 3 p95 37.7 ms**
(outside). Note the spike pass fences every frame, which drains the queue and
lets the GPU clock down, so these are the pessimistic end.

**This strengthens the case for the shell march.** The scale result is a direct
confirmation that cost is fill-bound — pixel count is the only thing that
moves it. The occluder gives a far bound but does not shrink the traced pixel
set; the shell march does exactly that, and the measured lack of occluder
benefit says the remaining win is in the pixels being traced, not in how far
each ray runs.

### Caveats, stated plainly

- **Two legs are still unresolved**: `cone-on` room 3 spread 40% and
  `occluder-off` room 3 spread 19%. Their deltas are smaller than their own
  spread, so "no effect" for those two means *not resolvable here*, not
  *proven zero*. The scale deltas (25-58%) are many times any leg's spread and
  are solid.
- **Rooms 1 and 2 were excluded**: the camera placement faces a wall there
  (`bodies 0 -> 0`). Rooms 3 and 4 are the valid ones. This matters less than
  it sounds — see the crowd-ladder correction below.
- **The gib segment barely gibs**: room 4 reaches `chunks 0 -> 1`, room 3
  reaches none. The slug wounds but rarely severs, so the gib column is closer
  to a second firing segment than to a gore spike.
- The driver's own summary line flags the single worst leg and then says to
  treat every comparison as unresolved. That is too blunt — judge each delta
  against its own legs' spread, as above.

## History: why the first three attempts produced nothing

## Why the numbers do not repeat

Two causes, and the second was the real one.

**A busy machine.** The first attempts ran with the owner's own Chrome live at
~32% CPU (58 processes). Three identical back-to-back runs read 10.1 / 5.6 /
56.1 ms. Re-running with Chrome at 3.2% removed much of this.

**Damage persisted across runs — the actual defect.** The page was never
reloaded between legs, and wounds, severed limbs and collapsed bodies survive
on it. The census caught it: room 3's walk segment *opened* at `wounds 20`,
carried over from room 2's run, with `bodies 0 -> 0` because the survivors had
already been shot to pieces. Every run's cost therefore depended on cumulative
damage from all previous runs rather than on the leg under test. Fixed by
reloading the page before every run; repeat spread fell from **583% to 1-13%**
on most legs.

This is why the 2026-08-27 wound-hull note could not resolve its occluder A/B
either. That finding stands, but the cause was probably not machine noise
alone.

What was ruled OUT, with evidence:

- **Not a missing GPU fence.** The adapter is real Apple Metal-3 and
  `timestamp-query` IS supported. A direct probe timed 20 submitted frames at
  30-40 ms of submission against 165-172 ms of fence, i.e. ~10.0-10.7 ms/frame
  — and that figure repeated across five consecutive chunks (10.24, 10.01,
  10.06, 10.66, 9.78). The fence works, and short interleaved measurements are
  stable. It is the longer, leg-switching matrix that drifts.
- **Not a hidden page.** Every leg reported `valid: true`; zero hidden frames.
  (A hidden page has no swapchain texture, resolves to ~0.065 ms of nothing,
  and reads as a 70x speedup — the harness fails the run on any such frame.)
- **Not a WebGL fallback.** Backend asserted `webgpu` on every run.

## What the census caught — four bugs, each of which produced a plausible table

The per-segment scene census (bodies / wounds / chunks at each segment's start
and end) is the most valuable thing built here. Every bug below shipped a
perfectly readable-looking result table, and none would have been caught by
looking at timings alone.

**1. The firefight annihilated its own subjects.** The first scenario fired
both barrels every 20 frames — six double blasts that shredded all of room 4's
zombies into collapsed corpses inside the first second. The table then read
`fire` and `gib` at ~9 ms against `walk` at ~40 ms, which looks like firing is
cheap. It was timing an empty floor. Now: one barrel every 40 frames.

**2. The shots never landed at all.** Teleporting the player to the room
centre put a zombie **0.97 m** away — the spawn table clusters bodies near the
centre too. `aimAtNearestSurface` pitched 26 degrees *down* into it,
`predictSlugHit` returned `actorId: -1`, and all eight pellets expired within
15 frames having hit nothing. The census read `wounds 0 -> 0` through a
segment named "fire". A second attempt (stand in the outer corner) faced a
wall instead: `bodies 1 -> 0`. The fix is goal-directed rather than heuristic —
back off 4 m from the room's **actual body centroid**, facing it. Census now
reads `wounds 0 -> 16` across the fire segment.

**3. Damage persisted across every run.** Covered above — the single largest
source of false numbers in this whole exercise, and invisible without a census.

**4. `p95` over six samples is just the max.** 120 frames / 20-frame chunks =
6 samples per segment, and `floor(0.95 * 6) = 5` — the last index. Every "p95"
in the first table was a maximum wearing a percentile's name, which is why the
first segment (carrying each leg's setup cost) dominated every row. Throughput
now reports the **median of ~12 chunk means**; p95 is answered by the spike
pass, which has real per-frame samples.

## A fourth finding, which changes the plan

**The rooms are not a 1/2/3/4 crowd ladder.** The spec assumed benching per
room would give a free 1→4 body curve from `ROOMS[].zombies`. The census says
otherwise: standing in room 4, `bodiesOnScreen` reads **9**, not 4. The
tunnels give sightlines into the neighbouring rooms, so almost the whole
10-body population is in frustum from one position.

That is worth knowing for its own sake — it means the game's worst case is
already ~9 bodies on screen, not 4 — but it also means the crowd curve Phase 1
needs has to come from a deliberate spawn ladder, not from room choice. The
spec's crowd-ladder paragraph should be corrected before Phase 1 reads it.

## Known remaining gap

`chunks 0 -> 0` in the gib segment: the slug lands a wound (`16 -> 17`) but
does not sever, so the segment does not yet contain flying gib chunks. The
segment is therefore currently a second firing segment. Either raise the
damage or stage the sever explicitly before the gib segment is quoted.

## What was built

| File | What it is |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts` | Pure: the firefight as timed actions + named segments. 7 tests. |
| `src/lab/sdf-zombie/webgpu/game-bench.ts` | The harness. Injected deps, throughput + spike modes, per-segment aggregation, census. 10 tests. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | `__sdfGame.bench`, `resolveGpu`, `setCone`/`setFxaa`/`setSmear`, `aimSurface`; `predictSlugHitNow` lifted so aim and the placement gate share one predictor. |
| `scripts/sdf-game-bench.mjs` + `.sh` | CDP driver: interleaved legs, throughput matrix, census table, spike pass. |

Gates: `npx tsc --noEmit` clean; `npx vitest run src/lab` 1685 tests across 93
files, 17 of them new.

## Next step

The Phase 2 gate can now be argued from data. The ordering the spec proposed
(C2 → C1 → shell march) should be reconsidered in light of the scale result:
resolution is doing all the work, which is precisely the axis the shell march
attacks, while the occluder — the existing bounding lever — has stopped paying.

Before Phase 1 reads anything off this:

- Re-run with rooms 1-2 placement fixed, if a low-body-count point is wanted.
- Stage a real sever so the gib segment contains gore.
- Re-take `cone-on` and `occluder-off` on room 3 — those two are unresolved.

```bash
LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 BENCH_REPEATS=3 BENCH_ROOMS=3,4 scripts/sdf-game-bench.sh
```

Read the census table before any timing: if `bodies` is 0, or `wounds` stays 0
through `fire`, the numbers describe something other than a firefight.

---

# Follow-up: the step-budget sweep (shell-march decision experiment)

## Why this experiment

The shell march's case rested on the spike's "~14x fewer `mapBody` evals"
(285k proxy-box pixels traced for a ~30k-pixel body). But an eval count is not
a cost. Before committing to per-limb posed hulls — the largest piece of work
on the table — it is worth knowing *which* evals are expensive.

The march budget (`marchCfg.x`, ships at 96) gives a way to ask without
writing a shader. A ray that lands on flesh converges in ~8 steps (the spike
measured 8.02 over surface pixels); a ray that misses runs on toward the
budget. So:

```
cost(budget) ≈ hitPixels × (steps to converge) + missPixels × budget
```

Sweep the budget, fit the line: the **slope** is what miss pixels cost, and
miss pixels are exactly the work a bounded entry/exit shell deletes.
`__sdfGame.setMarchSteps(n)` and the `steps-*` bench legs implement this.

## Result: directionally clear, numerically UNRESOLVED

Two sweeps were run. The second hit a background system load spike
(`ANECompilerService` at 92% CPU, WindowServer at 34% — an Apple Neural
Engine compile, nothing to do with this project) and repeat spread went to
31-91%, which is larger than the deltas being measured. **No number here is
quotable.**

What survives across both sweeps, noise included, is the sign and rough scale:

| | room 3, 96 → 16 steps | room 4, 96 → 16 steps |
| --- | ---: | ---: |
| sweep 1 (rep 0) | 21.74 → 15.03 (−31%) | 13.98 → 12.12 (−13%) |
| sweep 2 (medians) | 22.22 → 20.25 (−9%) | 14.45 → 13.54 (−6%) |

**A 6x cut in the step budget buys single-digit to low-double-digit percent.**
Every leg agrees on that, and it is a large enough qualitative gap to survive
the noise. Compare the resolution result from the main baseline: quartering
the pixels (scale 0.5) bought **−54%**.

## What that means — and it revises the shell-march argument

**Rays are not exhausting their step budget.** Miss rays terminate on distance
(the proxy box's far side, or the occluder's `tMax`) long before step 96, and
the relaxed tracer strides through empty space cheaply. The spike's 14x eval
reduction is real, but those evals are the *cheap* ones.

So the spec's framing — "the shell march wins by deleting 255k wasted marched
pixels' worth of stepping" — is **not supported**. That stepping is nearly
free.

**The case for the shell march is not dead; it rests on a different mechanism.**
Cost is dominated by *per-pixel* work, not per-step work: that is what the
scale result (−54% for a quarter of the pixels) and the step result (−6 to
−31% for a sixth of the steps) say together. A shell march deletes pixels
outright — a pixel outside the hull's screen footprint is never rasterised, so
it pays no per-pixel setup, no tile-list read, no shading. It also tightens the
interval for the pixels that DO hit, which the spike measured as 8.02 → 3.30
steps.

That is a better argument than the one in the spec, and it predicts something
testable: **the shell march's win should track how much of each body's proxy
box is empty**, not how many steps rays take.

## Before building anything

1. **Re-run the sweep on a quiet machine.** One command; the method is sound,
   only the conditions were bad.
   ```bash
   LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 BENCH_REPEATS=3 BENCH_ROOMS=3,4 \
     BENCH_LEGS=steps-96,steps-48,steps-24,steps-16 scripts/sdf-game-bench.sh
   ```
2. **Measure proxy-box occupancy** — what fraction of each body's rasterised
   box pixels actually hit flesh, at real crowd scale. That is the shell
   march's addressable market under the revised argument, and it is cheap to
   get (the march already carries `debugCfg` step/prim instrumentation; a raw
   float output mode plus a readback would do it).
3. Only then decide on per-limb posed hulls.

**Do not start the posed-hull work on the strength of the spike's eval count.**
