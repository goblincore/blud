# The probe gather is the #2 GPU pass, and nothing on the board knew

**2026-09-10.** Worktree `claude/sdf-march-perf-518bcc`. First bench on the
2026-09-09-interlace + temporal-start ship config, taken with **ship-truth
pins** (see the caveat at the bottom — the harness does not pin ship truth by
default).

Artifacts: `/tmp/sdf-bench-round1/{bench.json,bench.md,passes.json,passes.md}`
and `passes-CONTAMINATED.md` beside this note.

## The run is CONTAMINATED. Read this before any delta.

```
worst repeat spread: 116%   (steps-48, room 4: 14.06 / 30.38 / 16.14 ms)
spread % per leg/room: 53, 14, 44, 40, 65, 116, 94, 54, 85, 55
```

Cause: a second agent was working in another repo for the whole run, plus the
harness GUI tab itself burns 15-36% of a core (measured idle). Load at start
3.65, rising during the run.

**Consequence: every CROSS-LEG delta in this run is UNRESOLVED, not zero** —
by the harness's own contract ("a delta smaller than either leg's spread is
unresolved"). So:

- **Cone pre-pass: no verdict.** The `cone-on` leg is additionally broken —
  `gpu:idle` reports 18-20 ms (51-57% of its labelled total) and the harness's
  gap goes NEGATIVE (−18.20 ms), i.e. the leg spent most of its frame with the
  GPU waiting. Its `sdf:march` (5.43 room 4 / 9.44 room 3) is not better than
  baseline (7.98 / 9.05) but that is not evidence of anything at this noise.
  Note `TASKS.md` X1.14 already measures the cone at **0.4%** once the occluder
  hull landed, and X1.15 says the hull "SUPERSEDES the cone" — so the expected
  answer is ≈0 and this run does not contradict it.
- **Step budget: the lever is DEAD, and this reproduces the 2026-08-31 finding
  on a different config.** `sdf:march` p50 across 96 / 48 / 24 / 16 steps:
  room 3 **9.05 → 8.96 → 10.28 → 8.88**, room 4 **7.98 → 6.48 → 6.95 → 6.78**.
  A **6x** cut with no monotonic downward trend. This is robust in a way the
  frame-level numbers are not: noise cannot manufacture the *absence* of a
  trend. It independently confirms `2026-08-31-game-perf-baseline/notes.md:204-238`
  — "rays are not exhausting their step budget; cost is dominated by per-pixel
  work, not per-step work" — now on the interlace + temporal-start config.

## What the run DID establish: the shape of the frame (within-leg, so robust)

Ship config, 800x600 content, `'bodies'` interlace (march target **800x300**),
temporal start ON, occluder OFF + hull exit bound ON:

| pass | room 3 ms | share | room 4 ms | share |
| --- | ---: | ---: | ---: | ---: |
| `sdf:march` | 9.05 | 48% | 7.98 | 47% |
| **`compute:probe-gather`** | **7.19** | **38%** | **6.02** | **35%** |
| `gpu:idle` | 0.41 | 2% | 1.24 | 7% |
| `sdf:polys` | 0.80 | 4% | 0.77 | 4% |
| everything else | <0.5 each | | <0.5 each | |
| **fenced frame p50** | **19.61** | | **16.81** | |

Two corrections to the project's own picture, both important:

1. **The march is no longer 75-83% of the frame.** It is **47-48%** of the
   labelled GPU total, and the fenced frame p50 is **16.8-19.6 ms against a
   33.3 ms budget**. The interlace + temporal start did their job; the
   "the march is the whole frame" premise that drives the whole backlog is
   now false, and every note quoting 17-21 ms for `sdf:march` is stale.
2. **`compute:probe-gather` is the second-largest GPU pass** at 5.7-7.2 ms
   (27-38%). It is stable at 6.01-7.19 ms across ALL five legs and both rooms
   *while frame times swung by 116%* — that stability is why I trust the pass
   numbers even though the deltas are junk. Per segment (room 4): walk 6.28,
   fire 6.06, gib 5.72 — it is a constant tax, not an effect spike.

Nothing on the perf board treats the gather as a top cost. The backlog's only
probe item is "serve the most active room"; the owner knew it as the
"highest-variance pass" (p95 27 ms with tracers). It is the **#2 mean cost**.

## Why it costs 6-7 ms — the code, read

`compute:probe-gather` (`probe-gather-compute.ts:84`) dispatches
`compute(call, caps.maxProbes, [64])` with `maxProbes = 400`
(`game-main.ts:1971`). That is **400 invocations in 64-wide workgroups = 7
workgroups**. One thread per probe, `raysPerProbe: 32` (`game-main.ts:1241`).

Per thread (`probe-dynamic.wgsl.ts` `kProbeGather`), per ray:

```
let bh = kdHitBox(origin, dir, boxes, false);        // up to 16 boxes
let ch = kdHitCapsule(origin, dir, capsules);        // up to nCaps capsules
...
for (var l = 0u; l < nLights; l = l + 1u) {          // up to 8 lights
  ...
  if (kdShadowed(o, ld, d, capsules, boxes)) { continue; }   // FULL SWEEP AGAIN
}
```

`maxCapsules: 1024`, and the capsules are packed from posed bone instances
(`packCapsulesFromBoneInstances`, 2 per bone). **CORRECTED 2026-09-10:** this
note first said "realistically 300-900". The project's own measurement is
**~45 capsules per body**, so 4-8 bodies on screen is **~180-360 capsules**
(900 would need ~20 bodies). The revision REINFORCES the conclusion below — the
per-thread cost is roughly half what I first estimated, which makes the
6-7 ms look even more like latency than like arithmetic.

So the per-thread worst case is `32 rays x (1 + 8 shadow sweeps) x ~200 capsules`
≈ **3.4e4 capsule/box tests per probe**, i.e. of order **1.4e7 for the whole
gather**, executed by **7 workgroups**. Whatever the exact figure, this is both
(a) genuinely heavy per thread and (b) dispatched nowhere near wide enough to
hide the latency — an M3 has far more than 7 resident workgroup slots.

**Occupancy arithmetic (verified dispatch + hardware numbers, from the
2026-09-10 research briefing):** three.js `WebGPUBackend` dispatches
`ceil(count / size)` = `ceil(400/64)` = **7 workgroups = 448 threads**. An M3
10-core GPU has **1280 ALUs**, so the gather occupies ~35% of ONE wave and
~2 warps per core — effectively no latency hiding. A static op-count model
(~95-110 ops + 3 sqrt + 2 div per capsule test) predicts **0.2-0.7 ms at full
occupancy** and **1-4 ms at 448 threads** against the 6-7 ms measured. The gap
is latency, not ALU. Mark that arithmetic INFERRED, not measured — but it
agrees with the shape of the fix list below, where widening the dispatch is
lever 1.

## The levers, in the order I would try them

All are one-axis changes, and each is measurable with `BENCH_PASSES=1` reading
the `compute:probe-gather` row — a *within-leg* number, so it survives the
contamination that killed this run's deltas.

1. **Widen the dispatch: one thread per (probe, ray), not per probe.**
   400 x 32 = 12,800 invocations ≈ 200 workgroups, with a per-`(gi, ray)`
   reduction instead of an in-thread accumulation. If the pass is
   latency-bound (it looks it), this is the big one and it changes no maths.
2. **Cull capsules per probe.** The march already does exactly this with
   bound spheres per cluster/group; the gather tests all ~600 from every probe
   and again from every shadow ray. A per-probe (or per-cell) bound sphere
   against the capsule list should reject the vast majority — a probe in one
   room should not be sweeping bodies in another.
3. **Stop re-sweeping for shadow rays.** `kdShadowed` repeats the full
   capsule+box walk for each of up to 8 lights. Cull once per `(ray, light)`
   with a bound, or reuse the primary hit's candidate set.
4. **Fewer rays, more accumulation.** `raysPerProbe: 32` is a single number and
   the pass already has a temporal blend + afterglow (`blend`, `fall`) that
   would hide 32 -> 16 or 8. This trades the probe layer's response time, not
   its steady state.
5. **Cadence / room selection** — the existing `probeGatherRate` (2, `?proberate=`
   up to 4) and the backlog's most-active-room item.

Levers 1-3 are pure restructurings of the same maths, so the visual risk is
low; 4 trades latency of the dynamic layer.

## Caveat that must not get lost: the harness does not pin ship truth

`scripts/sdf-game-bench.mjs` pins `setOccluder(true)` and
`setHullExitBound(false)`. The game runs the **opposite** of both
(`setOccluderEnabled(false)`, `GAME_HULL_EXIT_BOUND = 1`). This run added

```
BENCH_PRELUDE='__sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)'
```

to measure the config the game actually runs. Without it, every delta includes
a pass the game does not run and omits a bound it has. An owner decision should
re-sync those pins; until then the prelude is mandatory for a ship-truth
number.

## MEASURED: the sweep fixes are worth -33%. Run of 2026-09-10 (round 3).

```
BENCH_OUT=/tmp/sdf-bench-gather
BENCH_PRELUDE='__sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)'
BENCH_LEGS=baseline BENCH_ROOMS=3,4 BENCH_REPEATS=3 BENCH_PASSES=1
```
Load 6.77 at start (another agent active), 79% idle. **Repeat spread 19% / 23%**
(room 3 / room 4) — a usable run, unlike round 1's 116%.

`compute:probe-gather`, the metric this note is about:

| | room 3 | room 4 |
| --- | ---: | ---: |
| before (`13fc0c30`'s parent, round 1) | 7.19 | 6.02 |
| **after (`13fc0c30` + `56da3ed3`)** | **4.85** | **3.99** |
| delta | **-33%** | **-34%** |

**This is well separated, which is why I am willing to report a cross-run
number.** Per-leg values: round 1 read 7.19 / 6.02 / 6.86 / 6.05 / 6.83 / 6.15 /
6.79 / 6.09 / 6.90 / 6.01 across five legs and two rooms — range **6.01-7.19**.
This run reads 4.01 / 3.97 / 4.87 / 3.99 / 4.85 / 4.23 — range **3.97-4.87**. The
ranges **do not overlap**: the lowest old value is 23% above the highest new
one. Caveat carried: round 1's FRAME-level numbers were contaminated and are not
used here; only the pass-attribution row is, and it was tight in both runs.

The gather is now **25-35%** of the labelled GPU total (was 35-38%), and it is
flat across segments — walk 3.99, fire 3.95, gib 4.13 (room 4) — still a
constant tax rather than an effect spike.

**What is NOT claimed.** Frame-level deltas are all inside the 19-23% repeat
spread: fenced frame p50 read 16.15 / 16.64 here against 19.61 / 16.81 in round
1, and `sdf:march` read 7.05 / 9.87 against 9.05 / 7.98 — the two rooms'
march numbers essentially swapped, i.e. noise. **No frame-level win is asserted.**

**What this implies for the next lever.** The observed -33% is real but SHORT of
the 1.5-2x the shadow-sweep argument predicted, and the dispatch is still 7
workgroups / 448 threads. So the residual ~4 ms is still occupancy/latency
dominated rather than sweep-count dominated — which is exactly what the
occupancy arithmetic below predicts, and it makes **widening the dispatch (R1)
the confirmed next lever**, not more culling.

## Levers 1-3, DONE (commits `13fc0c30`, `56da3ed3`)

- **Bounding-sphere cull in the capsule sweep**, bounded by a `tMax`: the
  capsule is contained in the sphere around the segment midpoint of radius
  `|ba|/2 + r`, so a ray that misses the sphere cannot hit the capsule, and one
  whose sphere exit is behind the origin cannot have a positive entry. Two dots
  and at most one sqrt against the quadratic's three. Sound because
  `t_capsule_entry >= t_sphere_entry`. `kProbeGather` passes the box hit it
  already has.
- **`kdCapsuleBlocks`: any-hit, bounded by the light distance**, replacing the
  full nearest search the shadow path ran per light per ray (up to 8x per ray).
- **Boxes first in `kdShadowed`** — a boolean OR, so order cannot change the
  answer, but <=16 boxes tested before ~200 capsules short-circuits the capsule
  sweep whenever a wall or furniture is in the way.
- Equivalence is PROVEN, not asserted: `probe-dynamic-cull.test.ts` checks an
  independent reference (bisection on the true point-to-segment distance) over
  900 randomised capsule/ray pairs for all three properties.

## Strategic findings from the 2026-09-10 GI research briefing

1. **There is no maintained "DDGI 2.0".** NVIDIA-RTX/RTXGI v2.x ABANDONED DDGI —
   its own Readme calls v2 "replac[ing] traditional probe-based irradiance
   caching with a world-space radiance cache" and ships only NRC + SHaRC, for
   path tracing; it points DDGI at the frozen v1 repo (last release v1.3.7, May
   2023). So DDGI 2019/2021 remains the live reference. Do not go looking for a
   newer paper to adopt.
2. **Direct on-stack prior art: `speedball-gi`** — BVH-traced DDGI for *three.js
   WebGPU targeting three r185*, the exact version this project pins. npm
   v0.7.0, published 2026-08-20. It has `cascades` as an option, explicit dirty
   lanes (`markTransformsDirty` / `markDeformsDirty` / `markTopologyDirty`),
   idle-gated structural rebuilds, and a `jitterMode: 'gated'` that holds a
   STABLE sampling basis to cut flicker — the opposite of this gather's
   per-frame `frameSeed` rotation of the Fibonacci set, which is presumably why
   the afterglow blend exists. **Read it before designing anything further.**
   The BVH point is the important one: blud sweeps explicit capsule lists where
   DDGI-family engines trace an acceleration structure, and that is what makes
   the per-thread cost here what it is.
3. **The gather re-derives analytically what the frame already rasterises.**
   `dungeon-lighting.ts` enables `SHADOW_HULL_LAYER` on the spotlight's shadow
   camera and `deferred-shadows.ts` renders a map containing level geometry plus
   inflated character proxies; `march.wgsl.ts` `LEVEL_SHADOW` already samples
   it. The gather binds **no shadow map at all** and sweeps capsules+boxes per
   light instead. For the flashlight — the dominant indirect contributor — that
   whole per-light sweep could become one texture fetch. This is exactly what
   DDGI does (the app traces, the probe pass shades from the frame's data).
   Caveat: muzzle-flash point lights have no shadow map and keep the analytic
   path.
4. **`probeGatherRate` is already 2** (`game-main.ts:650`, `setProbeGatherRate`
   clamps 1..4), so "gather less often" is already spent; **4 is a one-line 2x**
   on the #2 pass, at the cost of the dynamic layer's response time.
5. **Godot SDFGI is NOT a model for this problem.** The deep-dive CONTRADICTS the
   hypothesis: Godot only voxelises `GI_MODE_STATIC` geometry and dynamic
   objects cannot contribute at all (they can only receive). blud's gather
   exists precisely to make posed bodies occlude, so SDFGI's cascades are worth
   reading for update SCHEDULING but not for dynamic-object handling.

## Original plan for this run (superseded by the contamination)

Cone A/B + step sweep + miss fraction, expecting to falsify the miss-tail
hypothesis. It was falsified by the step sweep (above). The miss fraction via
`__sdfGame.occupancy()` was not taken — it needs a quiet machine to mean
anything, and the step-slope result already removes the reason to care.
