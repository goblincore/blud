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

---

# Follow-up 2: proxy-box occupancy — the shell march's market, measured

## Method

March debug mode 4 (`debugCfg.x == 4`) returns raw counters **before** the
miss-discard: `r` = steps this ray took, `g` = 1 if it hit flesh, `b` = 1
always (this fragment was rasterised and marched). One frame is rendered and
the float target is read back and summed — `__sdfGame.occupancy()`.

**This is a counter, not a timer**, which matters enormously here: it is
immune to the background load that made every timing sweep unresolvable. Two
independent runs agree closely.

Two traps worth recording. The readback is **row-padded** (`bytesPerRow`
aligned to 256), so walking it as a dense `w*h*4` array reads progressively
misaligned rows and still yields a plausible percentage. And the debug return
must sit *above* `if (!hit) { discard; }`, or miss pixels write nothing and
occupancy reads as 100% by construction.

## Result (800x600 SDF target, two runs)

| room | bodies on screen | coverage | occupancy (hit / marched) | mean steps: hit | miss | share of all steps spent on misses |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1 | 100% | **17.1% / 17.6%** | 18.6 / 18.5 | 13.7 | 78% / 78% |
| 3 | 3 | 100% | **18.0% / 15.5%** | 18.9 / 18.4 | 7.9 / 5.9 | 66% / 64% |
| 4 | 8 | 77% / 75% | **8.9% / 7.5%** | 18.4 / 18.5 | 8.1 / 8.0 | 82% / 84% |

(Room 1 reads zero — the known bench-placement bug, not a measurement fault.)

## What it says

**82-92% of every pixel the march rasterises hits nothing.** The proxy boxes
cover 75-100% of the SDF target, while flesh occupies 7.5-18% of it. Those
wasted pixels carry **63-84% of all march steps**.

Also: **no ray comes near the step budget.** Hits average ~18.5 steps against
a budget of 96, misses 6-14. That fully explains the step-budget sweep's null
result — cutting the cap from 96 to 16 cannot help work that never exceeded 19
steps. The sweep measured the *cap*, not the step count.

## This corrects the previous follow-up

Follow-up 1 concluded from the budget sweep that "miss pixels are already
cheap" and that the shell-march premise was **not supported**. That inference
was wrong, and this measurement is the direct evidence.

Miss rays are individually cheaper than hit rays (≈8 vs ≈18.5 steps), but
there are **five to eleven times more of them**, so in aggregate they are
where most of the marching goes. The spec's original instinct was right; the
budget sweep was simply the wrong instrument for the question, and reading a
null from it as "misses are free" over-corrected.

## Where that leaves the shell march

Its addressable market is now measured rather than asserted, and it is large:

- **Pixels**: from 75-100% of the target down to the body footprint, 7.5-18%.
  A pixel outside the hull is never rasterised, so it pays no per-pixel setup,
  no tile-list read, no shading — and the baseline showed cost is dominated by
  per-pixel work (quartering pixels bought −54%).
- **Steps**: deletes the 63-84% of stepping currently spent on rays that hit
  nothing.
- **Hit rays too**: the spike measured bounded hit rays at 3.30 steps against
  8.02 unbounded. Here hits run ~18.5, so there is headroom on the pixels that
  *do* matter as well.

**Recommendation: proceed with the shell march.** The remaining risk is not
whether the win exists but whether per-limb posed hulls can be built cheaply
enough to keep it — the hull must follow the skeleton by rigid per-cluster
moves, since the spike's single rest-pose mesh took ~0.5 s to build and cannot
be rebuilt per frame.

Do not use the occupancy figure as a predicted speed-up. It bounds the work
that can be removed; the hull passes have their own cost, and that trade is
what a crowd A/B has to settle.

---

# Follow-up 3: per-limb posed hulls — built, and the coverage win measured

## What "per-limb posed hulls" turned out to mean

The 2026-08-25 spike built its hull by marching tetrahedra over the CPU field:
one rest-pose world-space mesh, ~0.5 s to build. Its own notes named per-limb
posed hulls as the biggest missing piece for an animated body.

They are cheaper than that. The body is made of **primitives**, and the rig
already poses them every frame — so a hull built from `posed().prims` follows
the skeleton for free, with no re-meshing at all. `occluder-hull.ts` has been
doing exactly this for the INNER hull the whole time, rebuilt per frame at
~300 instances.

`shell-hull-outer.ts` is that machinery mirrored. Every sign flips:

| | inner (occluder) | outer (shell) |
| --- | --- | --- |
| scale | `min(scale)` — largest sphere that FITS | `max(scale)` — smallest that CONTAINS |
| wounds | must DROP spheres a wound hollowed | ignored: subtraction only shrinks |
| shellAmp | subtract (dent side escapes) | add (bump side escapes) |
| coverage | two end spheres per prim is fine | needs a sphere CHAIN — see below |

## Two bugs the containment tests caught before any GPU work

**The blend width convention.** `smin` works internally in `kk = k * 4`
(`validate.ts`), so `min(a,b) - h*h*kk*0.25` undercuts by up to `kk/4 = k`.
The surface therefore sits up to a **full blendK** outside the raw primitives —
not `k/4`, which is what the design assumed. Solving for where the folded value
reaches zero gives `k` for `smin` and `2k` for `sminChamfer`. The blended-bulge
test failed by **49 mm** on the wrong constant.

**A sphere chain is not a bounding sphere.** `assignClusters` can fit a
bounding sphere to `{a, ctrl, b}`, because a sphere containing the control
polygon contains the Bezier inside it. A *chain* threaded through those three
points does not: the curve bows away from its control polygon and the middle of
the arc falls outside. Measured on a 0.12 m bend, the surface escaped by
**17 mm**. The spine is now the tessellated curve.

Both were found by ray-cast containment against the **shipped zombie** — 900
inward Fibonacci-distributed rays, deterministic so a failure reproduces. That
test is also what guards the SEQUENTIAL fold: the analytic bound covers one
fold, and the zombie folds 23 primitives.

## The coverage win, measured without touching the march

`__sdfGame.hullCoverage()` rasterises the hull and counts covered pixels;
`occupancy()` already reported what the proxy boxes cover. The gap is the work
a bounded march deletes — and it needed no change to `march.wgsl.ts` to get.

| room | bodies | proxy-box coverage | outer-hull coverage | actual flesh | hull / box |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 7 | 84.0% | **17.5%** | 13.2% | **0.21x** |
| 4 | 4 | 100.0% | **36.6%** | 16.2% | **0.37x** |

**2.7-4.8x fewer rasterised pixels**, and the hull hugs tightly: room 3's 17.5%
against 13.2% of real flesh means occupancy *inside* the hull rises from ~16%
to ~75%. 731-734 instances for a ten-body crowd, no buffer overflow.

## Remaining work

The march does not consume entry/exit yet — the hull ships **default OFF**,
because until it does, rasterising it is pure cost. What is left:

1. A `shellFetch` in `zombie-gpu.ts` and two more parameters into `MARCH_BODY`.
   **Mind the HELPERS chain**: giving every WGSL helper all previous helpers as
   deps is quadratic and once cost 57 s of boot (`zombie-gpu.ts` header).
2. In the march: discard when entry is 0 and exit is 0 (no hull covers this
   pixel — no flesh can be there); start at `max(startT, entry)`; clamp `tMax`
   by exit. The entry/exit split exists precisely so "no hull" and "camera
   inside the hull" stay distinguishable.
3. A visual gate before it defaults on. Containment is proven against the CPU
   field and the GPU hull is the same spheres rasterised, but a sizing or
   instance-budget slip renders as HOLES, so this needs eyes on it — the same
   failure mode the wound-hull work chased for a day.
4. Then the crowd A/B: hull passes have their own cost, and coverage bounds
   removable work rather than predicting a speed-up.

---

# Follow-up 4: the hull wired into the march — parity, one bug, one discovery

## Wiring

`MARCH_BODY` takes `shellIn` / `shellOut`. `shellFetch` mirrors `occFetch` as a
standalone `wgslFn` passed as a parameter, so the HELPERS chain — and its
documented quadratic-dependency trap — is untouched. With the shell off the
fetches return `0` and `1e9`, which are exact identities, so a material built
without a shell source marches bit-identically.

Consumption is two lines: discard-and-return when `shellOut <= 0` (no hull
covers the pixel, so no surface can be there), and start at
`max(startT, shellIn)`.

## The bug the visual gate caught

Folding `shellOut` into `tMax` looked obviously right and was wrong. `X1.15`
made the relaxed tracer take a **clamped final sample at `tMax`** so an
overshoot could still retract. Clamping `tMax` to the hull's back face
therefore puts that final sample *on the hull* — a surface sitting
`blendK + shellAmp + chain inflation` outside the flesh — and the AA epsilon
(`t * aaCfg.x`, which grows with distance) accepts it as a hit.

On screen: a bright halo hugging every silhouette, and distant bodies
collapsing into ghost outlines of their own hulls, worst far away where the
epsilon is largest. Nothing is lost by dropping it — the exit bound only
tightened a far clamp the occluder already provides, and the entire win comes
from the discard and the entry start. Regression-guarded.

(A second error never reached a run: the first edit patched `CONE_MARCH`'s
`var t = clamp(startT, 0.0, tMax)` — the same line, in a function with no
`shellIn` in scope. A shader compile error, caught by the duplicate-line check.)

## Parity, and the cost win

Deterministic — zero drift across alternating legs.

| room | OFF | ON | delta |
| ---: | ---: | ---: | ---: |
| 3 | 104183 hits | 104184 | **1 px** |
| 4 | 46224 hits | 46225 | **1 px** |

| room | rasterised OFF -> ON | occupancy OFF -> ON |
| ---: | --- | --- |
| 3 | 480000 -> 168291 (**2.85x**) | 23.0% -> 65.7% |
| 4 | 367213 -> 75314 (**4.88x**) | 7.1% -> 48.4% |

## The discovery: the game page never got X1.10's relaxation default

Chasing an apparent +37% hit delta led somewhere unrelated and more valuable.
`woundCfg2` defaults to `y = 1.0`, and the march tests `relax = woundCfg2.y >
1.0` — so **the game page marches UN-RELAXED at omega = marchCfg.y = 0.6**.
Only `lab-main` exposes a `setRelax`; the game page never received the default
`X1.10` measured and flipped (**1.4**, worth ~5% and 14.89 -> 9.31 ms at ten
bodies).

It is not only a speed cost. At omega 0.6 with a 96-step budget the march
leaves resolvable flesh unresolved at distance — room 4 measured **27171 hit
pixels at 0.6 against 46224 at 1.4**, i.e. roughly 40% of the flesh the same
field can resolve. The shell's head start was recovering about half that gap
on its own, which is exactly why the delta looked like a shell effect until
relaxation was controlled for.

**Recommended, but NOT done here**: set the game page's relax to 1.4. It is
strictly better on both axes by measurement, but it changes what renders, and
a rendering change deserves its own visual gate rather than being slipped in
at the end of a session.

## Where the shell stands

Correct and cheap, still **default OFF**. Remaining before it defaults on:

1. The relaxation question above, settled first — it changes the baseline the
   shell would be measured against.
2. A crowd frame-time A/B. Every number above is a pixel or step count; the
   hull's own two rasterisation passes cost something, and only a timing A/B
   on a quiet machine settles the trade.
3. Wounds and severing under the shell. The hull ignores wounds by design
   (subtraction only shrinks), but severed clusters drop out of the hull via
   the live-cluster filter, and that path has not been exercised on screen.

---

# Follow-up 5: three instruments walk into a wounded room — two were lying

## The owner's report

Manual pass (2026-08-31): visual glitches at relax 1.4 (confirmed — box-shaped
washes, reverted) AND with `setShell(true)` — missing body parts. The console
history shows the shell test ran **while relax was still 1.4**, a combination
already known broken. But the report forced a rigorous look at shell-at-1.0,
and that look caught two lying instruments.

## Instrument 1: the occupancy counter — lies in crowds

`occupancy()` reported +9-10k hits with the shell ON, deterministically. The
cross-tab (`shellDiag()`) showed those "extra" hits fire after 8-15 real steps
(not first-sample), the OFF march burned only 0-15 steps at those pixels (not
budget exhaustion), shared-hit t identical to 7 decimals, and — the tell — the
ON-only hits sit NEARER than the shared-hit mean.

Cause: **in debug mode 4, misses do not discard.** A near proxy box's miss
fragment writes its end-t as depth and can WIN the depth test over a far
body's real hit, hiding it in the OFF buffer. The shell discards those miss
fragments before they write, unmasking hits that were always in the real
image. The counter was diffing its own depth pollution.

Caveat now attached to the tool: occupancy() is sound for single-body scenes
and for coverage fractions; per-pixel hit attribution in CROWDS is unreliable
wherever proxy boxes overlap.

## Instrument 2: capture pairs across a freeze — the smear settles

The "pink rim" I reported earlier came from comparing two captures taken a few
steps apart. On a frozen scene, two captures of the IDENTICAL off state differ
by **7.9% of pixels** — the post-AA temporal smear is still converging after
the freeze. Capture comparisons are only valid between SETTLED states, with a
same-state pair as the noise floor.

## The verdict, from the one honest protocol

Frozen frame, settled, A/B/A/B with same-state noise floors:

| pair | differing >8 | >32 |
| --- | ---: | ---: |
| off vs off (noise floor) | 7.9% (settling) / 0.015% (settled) | — |
| **off vs on (the effect)** | **0.012%** | **11 px** |
| occluder on vs off | 0.000% | 0 px |

**Shell at relax 1.0 is real-render parity — below the same-state noise floor —
wounds included.** And the occluder contributes zero pixels to the image.

## The frame-time win

`BENCH_LEGS=baseline,shell-on`, 3 repeats, spread 2-9%:

| room | baseline | shell-on | delta |
| ---: | ---: | ---: | ---: |
| 3 | 23.28 ms | **10.82 ms** | **−54%** |
| 4 | 15.89 ms | **9.50 ms** | **−40%** |

Net of the hull's own two rasterisation passes. This is the largest measured
win of the investigation, and it lands exactly where the occupancy measurement
predicted the market was.

## Status

Shell remains **default OFF** pending the owner's manual pass at the correct
settings — `__sdfGame.setShell(true)` with relax LEFT AT 1.0. The earlier
manual pass never actually tested this combination.

---

# Follow-up 6: the stale-hull mask, and the ship

## The owner's catch

With the shell on, a **walking** zombie shed its own render — flesh scraps
floating where the body used to be; "like the shell doesn't move with the
model." Exactly right. The hull's instance matrices updated every frame; the
RENDER didn't. The entry/exit passes shared one material flipped between them
(side + depthFunc + `needsUpdate`, twice per frame), and on the WebGPU backend
`needsUpdate` forces a pipeline rebuild — a pass whose pipeline is mid-rebuild
renders stale bounds. The occluder never hits this because its material is
never touched after creation.

**Why every automated gate missed it:** they all froze the wanderers first,
and a stale hull is indistinguishable from a fresh one on a frozen body. The
owner's live walk was the one scenario never scripted. It is scripted now.

## Fix and gate

Two `InstancedMesh`es with fixed materials — front/LessEqual on `SHELL_LAYER`,
back/GreaterDepth on `SHELL_EXIT_LAYER` — instance data written to both,
nothing mutated per frame. Gate: shell on, 300 frames of live walking,
mid-walk capture (bodies intact), then freeze-settle A/B — same-state noise
floors exactly 0.000%, shell effect 0.062%/0.016%, residue isolated
single-pixel silhouette grazes.

## Shipped

Owner passed the live walk on 2026-08-31. **Shell defaults ON**: −54% / −40%
frame time at parity. Bench baseline now carries the shell; the `shell-off`
leg measures the cost of turning it off. `__sdfGame.setShell(false)` is the
kill switch.
