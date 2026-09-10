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
(`packCapsulesFromBoneInstances`, 2 per bone), so `nCaps` is realistically
300-900 at the 4-8 bodies the census shows on screen.

So the per-thread worst case is `32 rays x (1 + 8 shadow sweeps) x ~600 capsules`
≈ **1.7e5 capsule/box tests per probe**, i.e. of order **7e7 for the whole
gather**, executed by **7 workgroups**. Whatever the exact figure, this is both
(a) genuinely heavy per thread and (b) dispatched nowhere near wide enough to
hide the latency — an M3 has far more than 7 resident workgroup slots.

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

## Original plan for this run (superseded by the contamination)

Cone A/B + step sweep + miss fraction, expecting to falsify the miss-tail
hypothesis. It was falsified by the step sweep (above). The miss fraction via
`__sdfGame.occupancy()` was not taken — it needs a quiet machine to mean
anything, and the step-slope result already removes the reason to care.
