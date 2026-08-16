# SDF lab LOD pass — what it bought, and why the target needs compute

**Date:** 2026-08-16
**Task:** `X1.4` · follows [the WebGPU parity note](2026-08-16-sdf-lab-webgpu-parity.md)
**Machine:** Apple M3, 960x540, 15 bodies, 23 primitives, WebGPU backend

The goal was 15 bodies from ~36.8 ms to ~16 ms — a 2.3x cut. **LOD does not get
there, and the measurements say no amount of quality reduction would.** This
note records what was measured, what shipped, and what the remaining gap
actually needs, so the next attempt starts from evidence instead of from the
same guesses.

---

## First: the measurement itself

**Wall-clock frame time was hiding everything.** It pins to the vsync interval
the moment there is any headroom, so it cannot tell "twice as fast" from "still
60 fps". One body reads 16.7 ms wall — and 10.9 ms GPU.

`WebGPURenderer({ trackTimestamp: true })` plus `resolveTimestampsAsync()` gives
real GPU pass time, and the lab now shows it. Every number below is GPU time.

Two things that bit while measuring, both of which silently invalidated a run:

- **The browser pane resizing changed the pixel count between readings.** Cost
  is close to linear in pixels, so the same configuration read 63.8 ms at one
  pane size and 141.2 ms at another. Every benchmark now pins
  `renderer.setSize(960, 540, false)` first.
- **Running the test suite on the same machine.** One sweep showed a 78% spike
  on a repeat of an identical configuration. Measure with nothing else running.

Repeatability with both controlled is about **±4%**, so anything under ~8% is
not a result.

---

## What each lever is worth

15 close-packed bodies, full quality baseline, one lever at a time:

| Lever | GPU delta |
| --- | --- |
| March steps 96 → 40 | −15% |
| 23 primitives → 6 (coarse stand-in) | −11% |
| Silhouette noise off | −8% |
| Surface noise / scatter / AO / face, individually | within noise |
| **Everything at once, maximally coarse** | **−24%** |

The step-count result is the surprising one, and it reframes the problem:
cutting the limit by 58% bought 15% because **few rays ever reach the limit**.
They hit the surface or leave the proxy box first. Raising or lowering the cap
mostly changes what the worst pixels do.

### Why it is fill-bound

Sweeping resolution at fixed everything else fits cleanly:

| Pixels | GPU |
| --- | --- |
| 518k (960x540) | 141.2 ms |
| 130k (480x270) | 49.4 ms |
| 32k (240x135) | 26.7 ms |

That is **18.6 ms fixed + 0.237 ms per 1000 pixels** (the fit predicts 26.2 ms
at 32k against 26.7 measured). Cost tracks the number of fragment invocations,
not the work inside each one — which is why shrinking that work barely moves it.

And cost rises **linearly with body count even when bodies hide behind each
other**, because the shader writes `frag_depth` and calls `discard`, which
defeats early-Z. An occluded body marches every one of its pixels anyway. This
is exactly the regression the WebGPU spec flagged when it noted that WGSL has no
equivalent of `EXT_conservative_depth`.

---

## What shipped

- **`lod.ts`** — pure, tested level table. Levels are picked by **projected
  screen height in pixels**, not distance: the same body at the same metres
  deserves different detail at 540p and 1080p, or through a 60° lens versus a
  90° one, and a distance-keyed table cannot express that. Hysteresis (8%)
  stops a body on a boundary strobing between levels.
- **`simplify.ts`** — coarse stand-in, one capsule per limb.
- **Shader guards** — silhouette noise, surface noise, scatter and AO now
  branch out instead of being multiplied by zero. Without the guards, turning a
  feature "off" still paid for it in full; the silhouette fbm runs ~100 times
  per pixel.
- **A tight AABB proxy box** instead of a cube. A standing body is about
  0.6 x 1.8 x 0.35, so the cube covered roughly three times the screen area it
  needed to.
- **Change-detection on the uniform writes.** Applying LOD uniforms every frame
  made the close-packed case ~6% *slower* than no LOD at all, because each write
  dirties a uniform buffer that then has to be re-uploaded. Uniforms are now
  written only when the decision changes.
- **Instrumentation** — GPU ms in the panel, per-lever override buttons, a
  crowd-spread control, and `__sdfLab.stats()` / `resetStats()` for scripted
  sweeps.

### One quality failure worth recording

The first coarse body used the cluster's **bounding radius** as the limb's
thickness. A cluster's bounding sphere spans the limb end to end, so every limb
came out as fat as it was long and the body rendered as a **featureless
mitten** — visibly worse than the level beside it at the same size on screen,
which is the exact pop LOD exists to avoid. Thickness has to come from the
primitives (`radius x min(scale)`, matching what `sdPrim` computes); only
length comes from the bounds. Fixed, and the constant carries the warning.

---

## What LOD is actually worth

LOD can only pay where bodies are small enough to demote:

| Scene | LOD off | LOD on | Delta |
| --- | --- | --- | --- |
| Close pack (all ≥150 px, nothing to demote) | 93.4 ms | 95.2 ms | none |
| Mid spread (levels 0–1) | 68.7 ms | 67.7 ms | within noise |
| Distributed crowd (levels 0–2 in play) | 46.3 ms | 41.5 ms | **−10%** |

The distributed row is three alternating repeats of each condition with nothing
else running; all three "on" readings sit below all three "off" readings, so
the separation is clean even though the effect is close to the noise floor of a
single pair.

An earlier sweep of the same scene showed −19%, and that number is **wrong** —
it was measured against the mitten-shaped coarse body described above. The fat
stand-in was cheaper because it converged in fewer steps, so the extra saving
was paid for entirely in the quality failure. −10% is the figure with a coarse
body that actually looks like the thing it replaces.

This is honest rather than flattering: in the shoulder-to-shoulder bench scene
the whole crowd is close and large, LOD correctly chooses full quality for all
fifteen, and it changes nothing. It earns its keep in a real encounter, where
most of the crowd is at a distance.

---

## Raymarching techniques not yet used

Three from the literature, prompted by
[batchmarching](https://github.com/maximecb/batchmarching/) and
[the partial-evaluation post](https://pointersgonewild.com/2016/05/08/optimizing-ray-marching-through-partial-evaluation/).
ARBM itself is a CPU algorithm and does not port, but its references do.

**1. Relaxed sphere tracing — DONE.** ([Keinert et al. 2014;
Bálint & Valasek 2018](https://people.inf.elte.hu/csabix/publications/articles/eurographics-2018-shortpaper.pdf).)
Plain sphere tracing advances by the full unbounding radius; over-relaxation
advances further and backtracks when the new sphere fails to reach the
previous one. This shader was doing the *opposite* — `stepMul` 0.6, i.e.
**under**-relaxation costing ~1.67x the textbook iteration count — because the
silhouette fbm breaks the Lipschitz bound and a full step can tunnel through
the surface. So the relaxation is conditional on the noise being off, which is
already true of every distant body under LOD. Tunable via `woundCfg2.y`.

**2. Partial evaluation — DONE, worth ~20%.** The blog's own proposal is
to specialise the shader per frustum quadrant as the camera moves, and the
author is openly unsure that recompiling on every camera move is viable. It is
not, for us. But the *idea* applies in a form that suits this code far better:
specialise on the body's **structure** rather than on the camera.

The inner loop currently does three `textureLoad`s per primitive per step,
under dynamic loop bounds, with a branch to skip carves. All of that is
interpreter overhead over data that barely changes: which primitives exist,
which are carves, and the cluster ranges change only on a sever or a rebuild.
Generating WGSL with that loop **unrolled and the carve decisions baked in**
removes the branches, the bounds checks and the indirection, leaving only the
endpoint fetches — and those could become uniforms. Regenerate the shader on
structural change, which is rare; the per-frame rig jiggle changes endpoint
VALUES, not structure, so it does not trigger a rebuild.

MEASURED at 10 bodies, full resolution, alternating repeats: GPU 232 ms
generic against 185 ms specialised, **−20%**, with both specialised readings
below both generic ones. Wall clock agrees at −11%. Only nine of the ten
bodies were specialised — the hero stays generic — so the per-body saving is a
little better than the headline.

`specialise.ts` generates it; `structureKey()` says when it must be
regenerated. Deliberately NOT regenerated on a sever: the alive flag is still
read at runtime, so a limb coming off costs no pipeline compile.

**3. Cone marching / multi-resolution — DONE, worth ~22%.** Bálint & Valasek's
second contribution, and what ARBM builds on. A cheap low-resolution pre-pass marches
with a cone radius equal to the pixel footprint and records a conservative
starting `t` per tile; the full pass starts from there instead of from the
camera. This subsumes the "start at the proxy box entry" idea — it starts at
the last provably-empty distance, which is much further along — and it
composes directly with the half-resolution layer already built, since that
pass is a natural place to hang the pre-pass off.

MEASURED at 10 bodies, full resolution: GPU 222 ms without against 173 ms
with, **−22%**, and it is the tightest measurement of the whole exercise —
repeats within a condition differ by 2% (219.9/224.1 against 171.9/173.8).

The CONE is the entire safety argument. A ray marched at tile centre gives a
distance valid for that one ray; a neighbour in the same tile might have
geometry nearer and would tunnel straight through it. Marching a cone whose
radius grows to cover the tile's footprint, and stopping when the field comes
within that radius, gives a distance conservative for every ray in the tile.
Where proxy boxes overlap, the pre-pass writes its distance as depth too, so
the hardware depth test resolves to the NEAREST start — the one value safe for
all of them. `CONE_TILE` is 8 and worth sweeping: bigger tiles make the
pre-pass cheaper but the cone wider, and a wider cone stops earlier.

## ARBM, and what it says about our cone pass

[The recursive-algorithm post](https://pointersgonewild.com/2026-03-06-a-recursive-algorithm-to-render-signed-distance-fields/)
is the writeup behind the batchmarching repo. It starts from a single ray for
the whole viewport, advances every ray in a patch together by a distance
computed conservatively from a centre ray, and subdivides only when uniform
advancement stops being safe. He reports 3-4x fewer rays per pixel and a
tripled frame rate, and notes himself that it parallels GPU cone marching.

**Our cone pass is the single-level version of his recursion.** Three things
follow, and the third is actionable.

**His 3-4x will not transfer.** It is a CPU number, and on a CPU every ray
skipped is work saved. A GPU already marches coherent rays in lockstep across
SIMD lanes, so the saving only materialises where a whole tile agrees — which
is exactly the part a tile pre-pass already captures. Measured here: 22%.

**His own caveat matches our measurement.** He expects less benefit "for
crowded scenes with minimal empty space", and a shoulder-to-shoulder crowd of
overlapping bodies is precisely that. 22% in the worst case is consistent, and
a sparse encounter should do better.

**A finer second level was built, MEASURED, and turned off again.** The
reasoning that led to it was half right, and the half that was wrong is the
interesting part. A narrower cone does travel further before touching, so a
finer level genuinely hands the full march a longer proven-empty distance —
that part held. What it ignored was the COST of the level: pre-pass cost grows
as 1/tile², so halving the tile quadruples it. The 8x8 level is a
sixty-fourth of the pixels and nearly free. A 2x2 level is a QUARTER of them,
which is most of a full march.

Measured at 10 bodies, repeats within 3%: the 2x2 second level made the frame
**~30% slower** (112 ms to 146 ms) than the single level alone. Off by
default, kept tunable via `setConeFineTile()` — tile 4 was never cleanly
measured, because the sweep that would have settled it drifted 60% on its own
control and was thrown out.

**Why it does not pay, and this is the general lesson:** ARBM's recursion is
ADAPTIVE — it subdivides only the patches that need it. A uniform finer level
pays full cost across the whole screen to help the few tiles that had further
to travel. Porting a recursive CPU algorithm as a fixed pyramid loses the one
property that made it work.

**Interpolated shading is the one idea we have no analogue for.** He terminates
early where all four corners of a patch are inside an object with aligned
normals, and interpolates across patches up to 10x10 — under one sample per
pixel. Our half-resolution layer is the crude cousin: uniform undersampling
rather than adaptive. His is better quality per unit cost in principle, but it
undersamples flat regions and keeps detail at silhouettes, whereas the layer
approach undersamples everything evenly — and on a game that already renders
960x540 through `image-rendering: pixelated`, even undersampling is closer to
the intended look than smart flat-shaded patches would be. Worth knowing about;
not obviously worth adopting here.

## Prior art we should have read first

[research.tektite.studio/topic/ray-marching](https://research.tektite.studio/topic/ray-marching/)
catalogues the field, and two 2025 Computer Graphics Forum papers turn out to
describe — with proofs and published numbers — most of what this session
arrived at by measurement.

**[Accelerating Signed Distance Functions](https://onlinelibrary.wiley.com/doi/10.1111/cgf.70258)**
(Hubert-Brierre et al.) embeds *optimization nodes* directly in the
construction tree, avoiding external structures like octrees, while preserving
the Lipschitz/conservative property. Its pieces map almost one-to-one onto
what was built here:

| Their node | Ours |
| --- | --- |
| Proxy nodes | `simplify.ts`, one capsule per limb (−11%) |
| Continuous level-of-detail nodes | `lod.ts` — but DISCRETE, hence the hysteresis and the visible swap |
| Normal warping | nothing yet — and this is the important one |

**[Lipschitz Pruning](https://wbrbr.org/publications/LipschitzPruning/)**
(Barbier et al.) — **read in full, and it is very probably NOT for us.** An
earlier draft of this note said "read before committing to polygonisation";
that was written from the abstract and over-sold it. Three reasons, in order
of how badly each bites:

1. **Our tree is far too small.** The paper positions itself against methods
   "limited to a few dozens to hundreds of nodes" and renders scenes of
   *thousands*. We have 23 primitives under 6 clusters. We are already inside
   the regime it treats as the easy case.
2. **We measured our own insensitivity to tree size.** Cutting 23 primitives
   to 6 via `simplify.ts` bought −11%. A technique whose entire payoff is
   reducing active primitives per evaluation cannot do much better than that
   ceiling here. Our cost is fragment invocations and steps-to-hit, not tree
   complexity.
3. **Our field animates every frame.** Pruned trees are built per grid cell
   over a dense spatial partition, with a large GPU allocation up front. The
   rig moves every primitive endpoint every frame, so the whole structure
   would need rebuilding per frame per body — and the authors list *partial
   update* of the pruning structure as future work, not a solved problem.

The mechanism is elegant and worth knowing: two traversals per region, the
first marking each node inactive / skipped / active, the second rewiring
parents to drop pruned subtrees, with complementary flags tracking sign
inversions. The Lipschitz bound is what lets a single evaluation at a region
centre bound the operands across the whole region — the same property our
noise breaks. They also note interval arithmetic is more general but costlier,
with similar pruning power in practice, and that scenes with many primitives
close together (their fluid) prune *worst* — which is our crowd, too.

### The insight that connects the whole session

**Normal warping is the missing piece, and the reason is the Lipschitz bound.**

Silhouette noise is the most expensive term in this shader — it runs inside
`mapBody`, so ~100 times per pixel — and worse, it BREAKS the Lipschitz
property. That single fact caused three separate compromises here: `stepMul`
sat at 0.6 (under-relaxation, ~1.67x the textbook iteration count),
over-relaxation had to be gated to bodies where LOD had already switched the
noise off, and `validateBody` needs a check tying noise amplitude to step
multiplier.

Hubert-Brierre's normal warping adds surface detail as a NORMAL perturbation at
negligible cost, leaving the field itself conservative. Adopt it and the noise
leaves the field entirely, which means: the term costing ~8% disappears,
over-relaxation becomes safe on every body rather than distant ones, and
`stepMul` can go from 0.6 to 1.0 or beyond. Those compound — plausibly 2x on
step count — and the polygonisation spec already wanted the same change for its
own reasons (§5, silhouette noise aliases at 2 cm voxels).

**Revised conclusion after reading the pruning paper in full:** the two papers
are not equally relevant, and only one of them should shape the next session.
Lipschitz Pruning targets a problem we do not have (huge static trees).
Hubert-Brierre's normal warping targets one we demonstrably do (the noise term
is our most expensive, and it is what breaks the Lipschitz bound). Do normal
warping; do not build a pruning hierarchy.

Proxy and continuous-LOD nodes remain worth reading before polygonisation,
since they attack the crowd problem from inside the raymarching paradigm — but
on the evidence of our own `simplify.ts` measurement (−11%), expect them to
be worth less here than they are in the paper's scenes.

## The remaining gap

Quality LOD tops out at −24%. Reaching 16 ms needs **fewer fragment
invocations**, not cheaper ones. In rough order of effort:

1. **Render distant bodies at reduced resolution** into a separate target and
   composite by depth. Cost is linear in pixels, so a half-res crowd pass is
   close to a 4x cut on everything it covers — and it follows directly from the
   resolution fit above. This is the cheapest thing with a real shot at the
   target, and it does not need compute.
2. **Compute-based polygonisation** (marching cubes / surface nets). Turns the
   field into a mesh, which gets early-Z, instancing and hardware LOD for free
   — and early-Z is precisely what the raymarcher gives up. This is the reason
   the migration happened; it is still unwritten.
3. **GPU culling**, so occluded bodies stop paying at all.

`EXT_conservative_depth` would have helped and has no WGSL equivalent, so the
occlusion problem cannot be solved in the fragment path. That is a real cost of
the migration and it is now measured rather than predicted.

---

# Update, same day, second session

Two things happened here. The second is the result; the first is the reason
nothing above it should be trusted.

## The measurement was broken, and that is most of this note's history

Everything above was measured through `renderer.info.render.timestamp`,
sampled from the animation loop. That readout had **three independent faults**,
each of which produced a confident number.

1. **`setAnimationLoop` is requestAnimationFrame, and rAF stops when the page
   is not composited.** Every automated run drives the lab from a browser pane
   that is hidden between tool calls. A fifteen-second sample window collected
   under twenty frames; `stats()` returned null while the on-screen median
   showed whatever the last burst happened to hit.
2. **With the cone pre-pass on, one frame is THREE `renderer.render` calls,
   and the loop's resolve is fire-and-forget.** three sums timestamp durations
   per frame id, so *which pass a reading described* depended on when the
   resolve landed. The same configuration could read like the full march or
   like the composite blit alone. This is very probably the real source of the
   "absolutes ranged 2x on identical configurations" recorded above and blamed
   on thermals.
3. **A hidden document has no swapchain texture.** The passes do nothing and
   resolve to ~0.065 ms — which reads as a 70x speedup.

The bench now owns the frame clock: animation loop stopped, frames stepped by
hand at a fixed timestep, and any frame stepped while `document.hidden` is
counted and reported as **INVALID** rather than averaged in. Press **B**; a
keypress is the one trigger that leaves the pane visible.

**Per-pass timestamps had to be abandoned too.** Awaiting a resolve after every
frame swung 13.6 / 36.2 / 21.2 ms across three back-to-back runs of an
identical config, because draining the queue every frame leaves the GPU idle
between frames and it clocks down. The metric is now wall-clock per frame over
a chunk of 20 frames submitted back-to-back, with one resolve at the chunk
boundary — the resolve is what makes it measure execution rather than
submission — medianed over 12 chunks. **That repeats to ~1%.**

### Fresh baseline

960x540, cone on, SDF scale 1.0, LOD off, `stepMul` 0.6:

| bodies | ms/frame |
| --- | --- |
| 1 | 3.07 / 3.08 |
| 10 | 22.44 / 22.68 / 22.40 |

Nowhere near the numbers this note reasons about above (10 bodies read 112 ms
"cooled" and 222 ms "hot"). **Treat every absolute recorded before this section
as unsourced, and every ratio as suspect unless both sides came from the same
pass.**

### Thermals are real, and this bench provokes them

The saturated queue means no vsync idle, so back-to-back runs heat the GPU
fast. One uninterrupted sequence drifted its own control from 22 ms to 61 ms.
Every comparison below cools to one body at 0.3x scale for ~30 s between runs
**and re-measures the control inside the same sequence.** A ratio quoted
without an interleaved control is not a result.

## Normal warping: the prediction was right

Implemented per Hubert-Brierre et al. — see the prior-art section above, which
called this the missing piece and the Lipschitz bound the reason.

The silhouette fbm is out of the marched field. `mapBody` still applies it, but
the march and the cone pre-pass pass `0.0` and only `calcNormal` passes a real
amplitude, so it runs four times per **hit** pixel instead of ~100 times per
pixel. Leaving it expressed as a field displacement that only `calcNormal`
differentiates is what keeps it exact: `calcNormal` returns
`normalize(grad(d + h))`, which is precisely the normal the displaced surface
had. Shading is unchanged; only the silhouette and the hit position give up
the detail.

Then the part that pays: the field is conservative again, so the relaxed-tracing
gate drops its `marchCfg.z <= 0.0` condition and over-relaxation applies to
**every** body rather than only the distant ones LOD had already stripped.

| config (10 bodies) | ms/frame | vs control |
| --- | --- | --- |
| HEAD — noise in field, relax gated off | 22.40 | control |
| warped, relax off | 20.18 | −10% |
| **warped, relax 1.6** | **13.48** | **−40% (1.66x)** |

1.66x is almost exactly the 1.67x that under-relaxation at `stepMul` 0.6 was
theorised to be costing.

**A mid-session reading said relaxation was a loss** (18.5 with, 17.1 without).
It was taken while throttling; that sequence's control had drifted to 61 ms by
the end. Cold, against a re-measured control, it is the largest single win on
the branch. This is the concrete case for the interleaved-control rule.

Visual checks, in the places a broken bound shows first: close-up flesh, deep
everted blast craters, severed stumps, and a 10-body crowd. No holes, speckle
or banding. A same-camera A/B against the old shader shows slightly cleaner
edges and otherwise identical mottling.

## Where that leaves the target

10 bodies now sits at ~13.5 ms — **inside 16 ms**, without LOD, at full SDF
scale. The gap the section above describes as needing compute is smaller than
it was measured to be, and part of it was never real.

Still open, and now worth re-deriving rather than inheriting:

- **Every LOD number above needs re-measuring.** `silhouetteNoise` was the top
  lever at −8%; it is now nearly free in the march, so the lever mostly buys
  nothing while still costing the mottling on distant bodies.
- **`validate.ts` still enforces the noise-vs-`stepMultiplier` Lipschitz
  guard**, correctly, because `march.glsl.ts` still has the noise in its field.
  The WebGL lab is now one technique behind the WGSL path.
- **Relaxation factor was never swept.** 1.6 was picked before it could be
  measured honestly; 1.8 and 2.0 are untested.
- **Polygonisation Phase 0's premise has moved.** It was scoped against a
  raymarcher that could not reach 16 ms. Re-read its cost argument against
  13.5 ms before building a marching-cubes compute pass.
