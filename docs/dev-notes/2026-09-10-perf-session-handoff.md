# Perf session handoff — 2026-09-10 → hand to a fresh agent

**Read `TASKS.md` "Current focus" first** — it carries this session's state at the
top. This file is the longer version: what was measured, what is CLOSED, the two
bugs and the rules they produced, and exactly where to pick up.

## Merging these branches

`main` advanced by exactly ONE commit while this work was in flight —
`ded97034 docs(tasks): wrap-up notes for the temporal-start follow-up night`, a
docs-only commit. Merge base is `5bea5c54`.

**Expect a conflict in `TASKS.md`**: `ded97034` edited it and so did this session
(current-focus section + the stale-claim corrections). It should be a trivial
textual conflict in the Current focus region — keep BOTH sets of notes, this
session's block on top. Nothing else should conflict: everything else this
session touched is new files or files `ded97034` did not.

`claude/determinism-stage1` was branched from this branch's `b4cd8776`. The boot
fix landed there twice and is now CONSISTENT with this branch: `e4eba930` was
cherry-picked, then `f3541064` (the structural `boot-params.ts` extraction and
its 8-test gate) was cherry-picked on top as `ebb78150`, cleanly, with `tsc`
clean. So both branches carry the same `boot-params.ts` and the same tested
parser — no duplicated inline parsing left to reconcile on merge.

`claude/determinism-stage1` does NOT have this branch's later work (the
`?tracerlightslots` fix, the census gate, the bench wiring, this handoff).

## Branches

| branch | tip | what it is |
| --- | --- | --- |
| `claude/sdf-march-perf-518bcc` | `921f3fc6` | the perf work; 22 commits off `main` |
| `claude/determinism-stage1` | `27702f24` | demo determinism stage 1 (sim clock, seeded LCG, boot fix cherry-picked) |

Both working trees clean. `main` was never touched.

## Measured results

**Probe gather −33%.** `compute:probe-gather` **7.19 → 4.85 ms** (room 3) and
**6.02 → 3.99** (room 4). Cross-run, but the per-leg ranges DO NOT OVERLAP
(old 6.01–7.19 across five legs; new 3.97–4.87) and repeat spread was 19%/23%.
Three exact optimisations: bounding-sphere cull with a `tMax` bound in
`kdHitCapsule`; an any-hit `kdCapsuleBlocks` bounded by the light distance
replacing a full nearest search run once per light per ray; boxes (≤16) tested
before capsules (~200) in `kdShadowed`. Equivalence is **proven** against an
independent reference in `probe-dynamic-cull.test.ts`.

**Cost split, previously a model.** Primary rays 2.15/1.82 ms; per-light shadow
**2.84/2.26 ms = 57%/55%**. Measured with `?dynrays=0` / `?dynlights=0`.

**READ THIS BEFORE QUOTING THE GATHER.** It runs every OTHER frame
(`probeGatherRate = 2`), so its amortised cost is **~2 ms/frame**, not the 4–5 ms
the pass row shows. That row prices ONE gather. Only `sdf:march`
(6.7–9.7 ms, no cadence) is a true per-frame row, and it is **51–63%** of the
labelled GPU total. The median frame sits at **15.9–17.5 ms against the 33.3 ms
budget** and **nothing this session moved it**.

## CLOSED — do not re-litigate

- **Cone pre-pass: DO NOT SHIP.** The documented −22% does not reproduce
  (`sdf:march` is *higher* with it on: 6.68→8.18 / 8.75→9.13), it adds ~0.6 ms of
  its own pass, `TASKS.md` X1.14 already measured 0.4%, and X1.15 says the
  occluder hull supersedes it. Enabling it also reproduces a CPU submission stall
  (`gpu:idle` 15–20 ms, negative gap) in two independent runs.
- **Step budget / miss-pixel 96-step tail: DEAD.** A 6× cut (96/48/24/16) shows
  NO monotonic trend in `sdf:march`. Per-step is not the axis.
- **Cadence (`probeGatherRate` 2→4): VOID, needs one re-run.** Round 4's A/B was
  invalidated by my own missing harness reset. Re-run
  `BENCH_LEGS=baseline,probe-rate4` (~7 min) to settle it.
- **`-22%` in `sdf-layer.ts:220-238` is stale doc-rot** (predates the occluder hull).
- Also dead from earlier work: reduced-scale flesh, neural upscale, hull mode,
  over-relaxation ω>1, per-ray wound list, bounded regions, half-rate C2.

## Two bugs I shipped, and the rules they produced

1. **Harness legs did not reset a new seam.** Legs leaked into the next rep's
   baseline. **RULE: any seam a leg can set MUST be pinned in the ship-defaults
   reset block in `sdf-game-bench.mjs`.**
2. **`?dynrays` / `?dynlights` booted every unparameterised page with 0 rays and
   an empty light list** (`Number(null) === 0` passed a `>= 0` guard), zeroing the
   dynamic probe layer — characters in the player's room rendered as black
   silhouettes. Fixed and made structural in `webgpu/boot-params.ts`
   (`parseIntParam` reads the RAW string) with `boot-params.test.ts` as the gate.
   **RULE: a boot-param default is what you get when the parameter is ABSENT, not
   what the number parses to.**
3. A third instance was found by **auditing the class**: `?tracerlightslots`
   defaulted to 0 instead of 2, so tracer lights never fed the gather. **RULE:
   audit the bug class, not the instance.**

All three shared one signature: a wrong value that reads as a design choice
rather than as an error.

## Where to pick up, in order

**1. Deeper interlace (top lever).** Plan:
`docs/superpowers/plans/2026-09-10-deeper-interlace-fields.md`. The pure math is
DONE and tested (`field-render.ts`, 47 tests): N-field parity/target-height/
jitter/row-source, the history ring (`fieldHistorySlot` / `fieldHistoryRead`),
and `fieldHeldNeighboursInteger` — the division-free form PROVEN equal to the
float one, because WGSL's `/` and `%` truncate toward zero and the float form is
wrong wherever `y < field`.
**⚠ HAZARD, do not land blind:** `COMPOSITE_WGSL`'s inputs bind POSITIONALLY and a
missing/zero `fieldCount` is division by zero in the composite — broken rendering
no unit test here can catch. Needs a GPU round trip, and the shader must clamp
(`max(...,1)`) so a bad binding degrades to no-interlace rather than NaN.
`FIELD_INTERLEAVE_WGSL` (the `'frame'` style) also hardcodes 2 and must be
generalised or refused.

**2. R1 — widen the gather's dispatch.** `probe-gather-compute.ts` dispatches
`compute(call, 400, [64])` = **7 workgroups / 448 threads** on an M3 with 1280
ALUs. Now backed by the measured 56% shadow share for the R2 alternative.
Two verified WebGPU constraints pin the design: **no `atomic<f32>`** (gpuweb#4894)
and **no global memory barrier between workgroups in one dispatch** (gpuweb#3774),
so use either a two-dispatch ray buffer (~410 KB) or a workgroup shared-memory
tree (~2.5 KB). A two-dispatch reduction also keeps summation order fixed, which
matters for the frame-hash gate below.

**3. R2 — sample the shadow map the gather already has.** `dungeon-lighting.ts`
already enables `SHADOW_HULL_LAYER` on the spotlight and `deferred-shadows.ts`
renders a map with level geometry + inflated character proxies; the gather binds
nothing. Caveats: one-frame-old map, bodies only via inflated hulls, muzzle-flash
lights must keep the analytic path.

**4. Finish demo determinism.** Plan:
`docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md`. Stage 1 is
partly done on its own branch (sim clock for the cull dwell; fire path on the
seeded LCG — the only `Math.random()` left in `game-main.ts` is inside a comment).
Remaining: the **frame hash** (highest value — it would have caught the zeroed
layer instantly and would verify the WGSL transcription of `probe-dynamic`
without a quiet machine or eyes), then `.dem` serialization.

**5. Re-aim far-body LOD before building it.** The spec'd version
(coverage <8% → 40 steps, wounds off) targets the **dead step axis**. Put LOD on
per-pixel work (shading/probe/wound detail) instead, and the owner declined the
popping variant, so it needs hysteresis.

## Measurement discipline — this is the part that cost the most

**Three of six bench windows this session were unusable.** Worst repeat spreads:
116%, 116%, 187%, against 19%/23% and 1% on quiet windows.

- Read the **Repeatability** section FIRST and judge each delta against **its own
  legs' spread**. A delta smaller than either leg's spread is UNRESOLVED, not zero.
- **Only a within-leg pass row survives a busy machine.** `compute:probe-gather`
  held 6.01–7.19 ms across five legs while frame times swung 116%.
- Tag ship-truth runs with
  `BENCH_PRELUDE='__sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)'`
  — **the harness still pins the OPPOSITE of both** (`setOccluder(true)`,
  `setHullExitBound(false)`), so every untagged delta includes a pass the game
  does not run and omits a bound it has.
- `node scripts/census-diff.mjs <bench.json>` reports workload drift, and the
  bench now does it automatically on every run. **The same "identical" leg has
  run with a 4× spread in droplets and a different body count** — so machine noise
  is not the only thing making deltas unreliable.
- **The honest headline for this session's benches: run across all four stored
  runs, EVERY ONE drifted — 0 of 4 had a repeatable workload, 127 drifted census
  fields in total (26 / 12 / 64 / 25).** Not one A/B taken this session compared
  legs whose workload was identical between repeats. Judge anything measured here
  accordingly, and treat the determinism work as the prerequisite for the next
  round of measurement rather than a nice-to-have.
- What still stands despite that: the gather's **−33%** rests on a within-leg pass
  row whose per-leg ranges do not overlap across two independent runs, and the
  **cost split** rests on three separated within-leg values (5.00 / 2.16 / 0.01).
  Both are the kind of evidence that survives a drifting workload. The
  **frame-level numbers do not**, and none of them are claimed.
- Do not bench while the owner has the game open; check
  `lsof -nP -iTCP:<port> | grep ESTABLISHED`.

## Known non-green state (pre-existing, NOT from this session)

`surface-nets.wgsl.test.ts` fails: `HULL_FIELD` (`surface-nets.wgsl.ts:21`) calls
`mapBody` with 17 args while `MAP_BODY` declares 19 — missing `segVolumeAtlas` /
`segVolumeMeta`. Dormant (only `hull-spike-main.ts` builds that chain) but it is
real signature rot in the same class the retired specialiser hit. Owner's call:
repair the chain or retire it. `main` is not green because of it.

## Open questions for the owner

1. Re-sync the harness ship-truth pins, or keep them?
2. Is `probeGatherRate` 2→3/4 an acceptable look trade (~1 ms of mean GPU work)?
3. Repair or retire the `HULL_FIELD` chain?
4. Far-body LOD: build the re-aimed version, or drop it?
