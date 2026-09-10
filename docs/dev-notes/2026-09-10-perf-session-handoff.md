# Perf session handoff — 2026-09-10 → hand to a fresh agent

**Read `TASKS.md` "Current focus" first** — it carries this session's state at the
top. This file is the longer version: what was measured, what is CLOSED, the two
bugs and the rules they produced, and exactly where to pick up.

## STATUS (2026-09-10, later) — both branches are MERGED; start at "Where to pick up"

Everything below the "Measured results" heading still stands. **The merge and
branch sections are historical and no longer actionable:**

- `claude/sdf-march-perf-518bcc` and `claude/determinism-stage1` are both merged
  into `main` (`a76978fa`, `d3a8cdb7`), and `f845c71b` adds the cadence result
  that supersedes the file's "VOID, needs one re-run" entry: `probeGatherRate`
  2→4 is worth **~5% (room 3)**. No branch is left to merge, so the two-branch
  reconciliation and the `TASKS.md` conflict warning are moot. Working tree clean.
- **Do not start more than one new branch off this work.** Both workstreams are
  parked on `main`; the next tick is a continuation of `main`, not a resurrection
  of either branch.
- The determinism work is now the **prerequisite for the next round of
  measurement**, not a side quest — see "The next thing" below.

## The next thing: the frame hash (owner-directed, 2026-09-10)

**The determinism harness landed; the frame hash — the piece that actually pays —
did not. Do that next.** Stage 1 (sim clock, seeded fire path, one tested
boot-param parser, the census gate) is now testing infrastructure; the frame hash
is the instrument. Nothing else on this list converts "needs a quiet machine and
the owner's eyes" into "compare a number".

**It is the lever that would have caught the worst bug of the session instantly.**
The `?dynrays` / `?dynlights` zeroed dynamic-probe layer — characters in the
player's room rendering as **black silhouettes** — was found by the owner
PLAYTESTING. A per-frame hash of the march/dynamic-layer output would have failed
on the exact frame it shipped, with no human and no quiet machine. It also
verifies the WGSL transcription of this session's three shader commits (capsule
cull, any-hit shadow, box-first reorder), which today are proven only at the
CPU-twin level in `probe-dynamic-cull.test.ts`.

**Scope it as a target-level hash first, not a screen hash.** Hash the
`marchTarget` readback (and/or the dynamic-probe layer state), NOT the
scanline-composited frame. The composite carries the interlaced field's parity,
so a naive screen hash flickers by design on alternate frames, whereas the
zeroed-layer bug and the shader transcription both live at the target level.
Screen-level hashing is a later, harder stage — it needs field parity/freeze
plumbing first. The dynamic-probe layer is a GPU resource, so it needs its own
explicit readback if you extend the hash to it; `readMarchTarget()` is the one
that already exists and is the cheapest first cut.

**A cheaper second seam, worth having even without the GPU hash:** a **sim-state
hash** (census fields + body poses + wound counts, already collected by
`game-bench.ts`) catches SIM divergence and is GPU-free. It is not a substitute —
it would NOT have caught the black-silhouette bug, which is renderer-only — but
it makes "same inputs, same work" a one-line check rather than a 127-field diff.

**The primitive already exists — build on it, do not invent a readback path.**
`__sdfGame.installDebugProbe()` installs `window.__sdfGameDebug.readMarchTarget()`
(`game-main.ts` ~7364): loop-stop + `handle.step(0)` + `resolveGpu()`, a
padded-row march-target float readback with the padding stripped, returned as
base64 because **a 2.3M-float readback must not cross CDP as a `returnByValue`
object**. The FNV-1a in-page digest convention is already the house pattern
(`hashSurface()` and `game-deferred-renderer.ts`, `deferred-main.ts`). So: add
`__sdfGame.frameHash()` (in-page FNV over the logical texels, bounded numbers
only) rather than a new transport.

**Everything the hash needs frozen already has a switch.** Freeze, in order:
light flicker (`setLightClockFrozen` — the clock is wall-clock on purpose, and
this is exactly why the freeze exists), the probe gather's `frameSeed`
(`probeFrame % 64`, `game-main.ts` ~1282), field parity (`setFieldStyle` /
`setFieldComb`), and the actor visual animation phase (**`view.setTime(now)`
still reads `performance.now() / 1000` at `game-main.ts` ~4449 — move it onto the
existing `simClockMs`**; it changes pixels but not sim state, so it is a genuine
stage-1 remainder and a hard blocker for a pixel hash).

**Design constraints, and one that is not optional:**

- The hash **must not gate anything legitimately allowed to vary** (field parity,
  `frameSeed`, the flicker clock) until those are frozen. Otherwise the gate is
  noise and gets ignored — which is worse than no gate.
- **Fixed summation order is a hard requirement for R1.** This is why the
  gather's two-dispatch reduction (ray buffer, then a per-probe pass summing in
  INDEX ORDER) beats a `subgroupAdd`/atomic reduction: WebGPU has no `f32`
  atomics anyway (gpuweb#4894), and a floating-point reduction with a different
  order is not bit-stable, so the hash would flap. Pick the two-dispatch shape.
- **No silent default changes.** The demo/hash seam must be inert unless a demo
  is being recorded or replayed.
- **Same build, same machine only.** Do not expect hashes to survive a GPU or
  driver change, and do not make CI portability a requirement of stage 2.
- **Plan for triage, not just failure.** A hash mismatch can be a real
  regression OR a deliberate visual change. That is why the plan asks for a
  **first-divergent-frame + per-region difference count**, so a real break is
  distinguishable from an intentional one. A bare pass/fail number will get
  switched off the first time a legitimate change trips it.
- Freeze the **chunk-bake worker swap** to a recorded frame index too: it is
  async and lands on whichever frame it finishes, which is why
  `cpu:phase:chunk-bake-swap` flickers in and out of the bench tables.

**Residual stage-1 gaps, for completeness** (none of them block starting the
hash): `view.setTime` on the wall clock (above); the chunk-bake swap frame index;
and two `Math.random()` calls still reachable in the active game path —
`dynamite-prop.ts:166` and `fpv-view.ts:671`, both `cooking ? … + Math.random()`
spark-pulse scale. Visual-only, but they are pixel-level randomness and will
break a composited hash that includes an active dynamite spark.

**Do not regenerate this from scratch.** Plan:
`docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md`. Its
existing "Do not break" and "Payoff, stated honestly" sections are the contract —
including the honest limit: **determinism makes both legs do the same WORK; it
cannot make the GPU run at the same SPEED**, so it complements the Repeatability
discipline below rather than replacing it.

### IT IS BUILT, AND IT ALREADY FAILS — read this before re-deriving it

The instrument shipped 2026-09-10 (`0ca65f62`, `b04d36e5`). `frame-hash.ts`
(pure, 22 tests), `demo-hash.ts` (in-page, 13 tests), `__sdfGame.frameHash()` /
`setDemoHold()` / `demoScenario()`, `scripts/sdf-demo-hash.sh` (`ab` | `record` |
`verify` | `negative`), and the bench reports frame-hash drift beside census
drift. **The live runs do NOT pass, and the failing evidence is the most useful
thing here.** Everything below is measured, not inferred; the stored run dirs are
named where it matters.

**PROVEN — do not re-derive these:**

1. **The readback and the digest are sound.** Hashing one position with NOTHING
   between the reads returns an identical digest, in EVERY run. A mismatch is
   therefore never a readback artefact — the frame really differs.
2. **The render sequence IS deterministic.** A 24-position alignment sweep across
   two page boots (gather rate 1) matches **23/23 overlapping positions at a
   ONE-POSITION offset**, with all 24 digests distinct per boot. Not a periodic
   artefact — a real phase offset. So "the renderer is nondeterministic" is
   FALSE, and anything built on that assumption is wasted work.
3. **The interlaced field's parity is real and is now recorded.** One frame at a
   time on a locked, unchanging scene makes the march digest alternate between
   exactly two values (run set `nogather`: A held `1142176106` throughout, B held
   `1439188061` throughout, same recorded parity). `demoScenario` records each
   sample's parity and the recorder **REFUSES a mixed-parity recording** instead
   of reporting a phantom divergence. `every` must be EVEN.
4. **The gather's dispatch SCHEDULE is deterministic: both boots dispatched
   exactly 36 times** over the same spec (`final`). Schedule is not the problem.
5. **The gather's `frameSeed` is now PINNED to 0 while a demo is held** (it
   rotates per dispatch in play, which makes the blended estimate track a
   different ray set every dispatch). This is a RECORDING-ONLY change and it is
   the one thing here that alters a recording's look — a settled estimate rather
   than an oscillating one.

**NEGATIVE RESULTS — also do not re-derive:**

- **Pinning the seed did NOT align two boots** (`pinned`, `final`: still 0 shared
  digests, march still varies between samples at held parity). So the seed is not
  the cause.
- **Anchoring the dispatch phase did NOT align them either.** Resetting
  `probeFrame` at `setDemoHold(true)` was tried and REMOVED — see the next point.
- **`seedIdle` was a BAD diagnostic and is gone.** It was computed as
  `probeFrame - demoSeedBase` across that reset boundary, which made it read
  NEGATIVE (−34, −37, −1 in stored runs) and it was briefly used as evidence.
  A diagnostic that can read as nonsense is worse than none. Do not reset a
  running counter to fix a phase problem.

**THE BLOCKER — AND ITS FIRST HYPOTHESIS IS NOW FALSIFIED TOO.** With parity
held, the seed pinned, the sim render-locked and the dispatch count identical, the
gather's dynamic layer still differs between two boots. The obvious read was "so
it must be the gather's INPUTS", and a third layer now tests that directly by
hashing the packed bone capsule instances (`readInstances`). Result (run dir
`sdf-demo-hash-inst2`):

| layer | across two boots |
| --- | --- |
| `instances` | **IDENTICAL — same hash `3080687726`, count 35, on ALL samples** |
| `probeDyn` | 0 shared digests, 3 distinct per boot |
| `marchTarget` | differs on every sample |

**So the inputs are identical and the gather still diverges.** The inputs are
excluded; so are the seed (pinned), the schedule (36 dispatches both boots), the
sim state (render-locked) and the readback (bit-stable). What remains is state
INSIDE the gather or its neighbours that these layers do not cover: the gather's
own GPU-side accumulation across dispatches, the room probe grid baked in a
WORKER at boot, `frameSeed`'s consumer in the kernel, or the march's own per-frame
state other than the four things already pinned. **The room-probe worker bake is
the best next candidate** — it is async, it lands whenever it finishes, and
nothing in a recording pins WHEN.

**AND THE DISPATCH COUNT IS NOT IT EITHER** (`sdf-demo-hash-rate4`, rate 4 → 18
dispatches vs 36): the march still alternates between exactly TWO digests at held
parity, `instances` is STILL byte-identical across boots, and `probeDyn` still
shares ZERO digests. One run went fully STABLE on `probeDyn` (three samples, one
digest) while its march kept alternating — so the two layers vary independently,
and neither tracks the dispatch count.

**THE DIVERGENCE IS LOCALISED, AND IT IS A TWO-STATE ENGINE.** Per-tile digests
settle what a whole-frame number cannot. Across every boot recorded
(`sdf-demo-hash-novhs`, `-bake`, `-rate4`, `-inst2`):

| tiles | behaviour |
| --- | --- |
| 0,1,2,3,8,11 | **BIT-IDENTICAL in every run and every boot** (`1109108741`) |
| 4,5,6,7,9,10 | vary — and only here |

Tiles are 4×3 over the 800×300 march target, so the stable tiles are the outside
columns and the bottom row, and the varying ones are the central band where the
BODIES are. The LEVEL renders bit-identically every time; the divergence is
entirely in body pixels. The `max` stat takes one of exactly two values across all
these runs (13.3995 or 0.981266) — a **13.7x** difference, i.e. a body is either
lit or not, not a rounding wobble.

**The engine boots into one of TWO states, and everything downstream follows.**
Two different boots in the SAME stored run reuse digests seen in earlier runs
(`1193645989`, `562205572`, `2732454371` recur across separate invocations), and
within one boot the values are stable. So this is a discrete branch chosen at
boot, not continuous noise — which is why every "pin one more clock" attempt
failed and why the right move is to find the BRANCH, not to keep freezing time.

**THE BRANCH IS NOW CHARACTERISED, NOT JUST DETECTED.** Sampling the SAME march
pixels across FOUR independent boots (2 distinct digests; 1 branch hit once, the
other 3 times) gives, at one body pixel:

| channel | branch A | branch B | delta |
| --- | ---: | ---: | ---: |
| R | 0.875281 | 0.846257 | −3.3% |
| G | 0.752314 | 0.702719 | −6.6% |
| B | 0.585664 | 0.514960 | −12.1% |
| A | 0.969916 | 0.969916 | **identical** |

Three things follow, and they are sharp. **Alpha is bit-identical**, so this is not
coverage, not a missing/extra body and not vertex position — the same surface is
hit at the same depth. **RGB scale down unequally (3.3% / 6.6% / 12.1%, blue
worst)**, which is a LIGHTING/colour difference and not exposure (a uniform gain
would move all three equally). And a CONTROL pixel in tile 0 reads
`[0.008023, 0.009134, 0.01096, 1]` in **all four boots** — so the level is genuinely
identical and the branch lives entirely in body shading. A blue-weighted shortfall
of that shape points at the lighting path that feeds the body — the probe/dynamic
layer's contribution — rather than at geometry.

Also note the branch is a MINORITY event: 1 boot in 4 took branch A. So a two-run
A/B has a ~5-in-8 chance of drawing two different branches, which is why "record
twice and compare" failed so reliably.

**Everything now excluded, each by a measurement rather than an argument:**

| candidate | how it was excluded |
| --- | --- |
| readback / digest | bit-stable across no-step re-reads |
| sim state | render-locked (`setRenderLock`) |
| field parity | recorded per sample and held constant |
| gather seed | pinned to 0 while a demo is held |
| dispatch schedule | 36 vs 35 vs 18 dispatches → same divergence |
| gather inputs (bone capsules) | `instances` BYTE-IDENTICAL across boots, count 35 |
| camera | logged: `[-7.4, 1.62, -7.4]` in both boots, to 6 dp |
| post-fx (VHS) | `setVhs(null)` changes nothing |
| room-probe worker bake | gated with `roomProbesReady` (new seam) — still diverges |

**What that leaves, stated as a shape rather than a guess.** Inputs identical,
scene locked, seed pinned, schedule identical, readback proven stable, and the
output still differs between boots. So the difference enters somewhere none of
those layers observe — the strongest remaining candidate is the GPU-side state the
gather accumulates across dispatches, or the async room-probe grid baked in a
WORKER at boot, whose completion frame nothing pins. **The worker bake is the
cheapest thing to pin next**: pin its completion to a recorded frame index (the
same fix the plan already calls for on the chunk-bake worker, and for the same
reason — it lands whenever it finishes).

**Method note, because it already bit twice:** the four `hashFrame` call sites had
drifted apart — two grew `readInstances` and two did not — so a whole layer
silently vanished from a run with no error, and the first "instances test" proved
nothing. They now share ONE `frameHashDeps` object. A hash whose layer set depends
on which call site asked is not a hash.

**Also unexplained, and INDEPENDENT of the gather:** with `setProbeDynamic(0,0)`
the march still varies between exactly two digests (`nogather`), and the two
boots do not share them. So a second, period-2, gather-independent mechanism
exists — field jitter phase is the candidate, since the interlaced field's own
jitter advances per frame. Fix that one too; it will still be there afterwards.

**THE BENCH-LEVEL GATE NOW FIRES ON REAL DATA.** `endHash` is wired into the
page's bench deps and the harness reports frame-hash drift beside census drift.
Run `BENCH_LEGS=baseline,occluder-off BENCH_ROOMS=3 BENCH_REPEATS=2
BENCH_PASSES=1` (2026-09-10) and it reports **all four leg-runs drifting, on BOTH
layers**, with the numbers:

| leg/room | marchTarget rep0 → rep1 | max |
| --- | --- | --- |
| baseline/room3 | 2990198133 → 1661108024 | 11.13 → 12.55 |
| occluder-off/room3 | 2461999575 → 2852495086 | 8.54 → 12.44 |

probeDyn drifted too (3173156444 → 2428443327, etc.). **So the census gate alone
was not the whole story: two repeats of one leg do not merely COUNT different
things, they RENDER different frames.** Stage 1 fixed the census-visible part of
the drift; this is the part it could not see, and it is why every A/B measured
across those repeats was measuring the scenario.

**Order the evidence points in:** (1) hash the gather's inputs to find where the
divergence enters; (2) the gather-independent period-2 mechanism; (3) `.dem`
serialization (stage 3), which needs a green hash. Two things worth banking:
the gather's **−33%** and the cost split survive regardless (they rest on
within-leg pass rows, not frame-level comparisons); and the instrument already
earns its keep by having turned "determinism is hard" into four falsified
hypotheses and one precise open question.

## Merging these branches (HISTORICAL — already merged, kept for provenance)

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
- **Cadence (`probeGatherRate` 2→4): RESOLVED, and it is the largest frame-level
  win demonstrated this session.** The "VOID, needs one re-run" entry below was
  settled by `f845c71b` on merged `main`: **−5.2% (room 3, both legs' spreads
  tight and resolved)**, ~−8% nominally in room 4 (66% spread from one outlier),
  matching the ~6–7% the arithmetic predicts. It is a ONE-VALUE change with no new
  code, sitting behind a look trade (dynamic-layer flash-response latency), so it
  is an **owner call, not a measurement one** — see open question 2. Its run is
  also the first where the census gate announced itself in-line (`⚠ CENSUS DRIFT:
  26 field(s)`), which is why the room-3 result rests on tight spreads rather than
  on a clean workload. Result:
  `docs/dev-notes/2026-09-10-probe-gather-cost/cadence-result.md`.
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

**1. The frame hash — owner-directed, and the highest-value item on this list.**
Full design guidance, the existing primitives to reuse, the freeze list and the
hazards are in **"The next thing: the frame hash"** above. Plan:
`docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md` (stage 2). It
is a prerequisite for trusting anything else measured, which is why it moved to
the top: **0 of 4 stored bench runs had a repeatable workload.**

**2. Deeper interlace (top perf lever).** Plan:
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

**3. R1 — widen the gather's dispatch.** `probe-gather-compute.ts` dispatches
`compute(call, 400, [64])` = **7 workgroups / 448 threads** on an M3 with 1280
ALUs. Now backed by the measured 56% shadow share for the R2 alternative.
Two verified WebGPU constraints pin the design: **no `atomic<f32>`** (gpuweb#4894)
and **no global memory barrier between workgroups in one dispatch** (gpuweb#3774),
so use either a two-dispatch ray buffer (~410 KB) or a workgroup shared-memory
tree (~2.5 KB). A two-dispatch reduction also keeps summation order fixed, which
matters for the frame-hash gate below.

**4. R2 — sample the shadow map the gather already has.** `dungeon-lighting.ts`
already enables `SHADOW_HULL_LAYER` on the spotlight and `deferred-shadows.ts`
renders a map with level geometry + inflated character proxies; the gather binds
nothing. Caveats: one-frame-old map, bodies only via inflated hulls, muzzle-flash
lights must keep the analytic path.

**5. Finish demo determinism — `.dem` serialization after the hash.** Plan:
`docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md` (stage 3).
Stage 1 is DONE and merged into `main`: sim clock for the cull dwell
(`92636fae`), fire path on the seeded LCG (`a51c42e1`), plus the tested boot-param
parser (`ebb78150`). Remaining before stage 3: the **frame hash** (item 1) and the
residual walls listed in that section — notably `view.setTime` still on
`performance.now()`.

**6. Re-aim far-body LOD before building it.** The spec'd version
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
- **RESOLVED 2026-09-10 (later): the harness pins are RESYNCED TO SHIP TRUTH.**
  `setOccluder(false)` and `setHullExitBound(true)` are now what the harness
  pins, matching the game (`setOccluderEnabled(false)`, `GAME_HULL_EXIT_BOUND =
  1`). The `BENCH_PRELUDE='__sdfGame.setOccluder(false);__sdfGame.setHullExitBound(true)'`
  workaround is a NO-OP from now on — kept here for provenance, because every
  stored run in this directory predates the flip and was measured with one extra
  pass the game does not run and a bound it has switched OFF. **Those runs stay
  internally consistent but are not comparable to a run taken after the flip.**
  This also retires open question 1 below.
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

**Re-verified on merged `main` (2026-09-10):** `expected 17 to be 19`, 1 failed /
11 passed. Still exactly as described — the next agent does not need to
re-diagnose it, and should not assume it was caused by anything they did.

## Open questions for the owner

1. ~~Re-sync the harness ship-truth pins, or keep them?~~ **DONE 2026-09-10** —
   resynced to ship truth; see "Measurement discipline".
2. Is `probeGatherRate` 2→3/4 an acceptable look trade (~1 ms of mean GPU work)?
   **This is now the biggest demonstrated frame-level win of the session
   (−5.2% room 3, resolved) and it is waiting on this answer alone** — the
   measurement is done, so it is a look call, not a numbers call. Test it with
   `?proberate=4` on the live game.
3. Repair or retire the `HULL_FIELD` chain?
4. Far-body LOD: build the re-aimed version, or drop it?
5. **Frame hash: should it be wired into the bench as a pass/fail gate, or stay a
   tool the owner runs on demand?** Gating it means every legitimate visual change
   (wound look, probe tuning) requires a re-baseline — that is a real cost, and it
   is the reason the plan asks for first-divergent-frame + per-region diff counts
   rather than a bare number.
