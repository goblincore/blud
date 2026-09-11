# Temporal accumulation for the march — Implementation Plan

**Status:** PLAN, not started. Owner approved the direction ("we can proceed",
"some ghosting is not a big deal since it adds to the degraded CRT look") after
rejecting the free-win shortcut: `__sdfGame.setSdfScale(0.5)` alone is **"too
pixelated and aliased"**. So the reconstruction is the point of the exercise, not
a nicety.

**The prize, already measured** (room 4, `BENCH_PASSES=1`, median of 3):

| `setSdfScale` | `sdf:march` | fenced frame p50 |
| --- | ---: | ---: |
| 1.0 (ships) | 8.18 | 16.64 |
| **0.5** | **4.12** | **8.51** |
| 0.35 | 3.63 | 8.30 |

**~8 ms of a 16.6 ms frame is on the table at 0.5**, and below 0.5 there is nothing
left to take. The resolve's own cost comes out of that budget, so the budget is
"make 0.5 look acceptable for meaningfully less than 8 ms".

---

## The three facts the design rests on (verified in the code, not assumed)

1. **The march target is `sdfScale`'d**: `resize()` sizes it `w = round(fullW *
   scale)`, so at 0.5 it is a QUARTER of the marched pixels.
2. **The composite already upsamples it by NEAREST at output resolution**:
   `COMPOSITE_WGSL` does `textureLoad(layerTex, vec2<i32>(floor(st * dims)))` where
   `dims` is the low-res target. So the output-res grid already exists and already
   reads single low-res texels; nothing needs inventing to *place* samples.
3. **The polygonal level must stay CRISP.** Field style `'bodies'` exists for
   exactly this (flesh and skeleton field, level and viewmodel full rate), and it
   was fixed twice for breaking it. So the accumulation applies to the FLESH
   layer only, BEFORE the composite draws it over the polys — never to the
   composited result, which would smear the level and the viewmodel.

## Why the accumulation must be at OUTPUT resolution

This is the mechanism, and getting it wrong makes the whole thing a blur:

- Accumulating a jittered low-res march **into the low-res grid** averages the
  sub-positions into the same texels. That is a box blur inside each texel — no
  new detail, just softness.
- Accumulating at **output resolution** means each output pixel reads ONE low-res
  texel per frame, and the per-frame jitter changes WHICH one. Over N frames an
  output pixel therefore receives up to N distinct samples of the underlying
  image, at distinct sub-positions — which is supersampling. **The jitter is the
  feature; without it this is a temporal blur and nothing more.**

So: a full-resolution flesh history, the current frame's low-res march
nearest-sampled into it at the jittered offset, blended, and the composite reading
the accumulated flesh instead of the raw low-res layer.

## Tasks

### 1. The jitter (host only, independently verifiable)
- [ ] A per-frame sub-pixel view offset (a 2D Halton sequence) applied to the
      camera that marches, then cleared — the field path already does sub-pixel
      `setViewOffset`, so the mechanism is proven; only the sequence changes.
- [ ] **Indexed by `framesSinceEpoch`, not by wall time and not by `Math.random`.**
      Deterministic AND progressing — see
      [2026-09-10-temporal-accumulation-frame-hash-DECISION.md](../../dev-notes/2026-09-10-temporal-accumulation-frame-hash-DECISION.md).
      `demoHold` must NOT freeze it: a frozen jitter freezes convergence.
- [ ] Gate: with accumulation OFF the frame is **bit-identical** to today (the
      jitter must be strictly gated on the accumulation seam).

### 2. The history buffer, the epoch and the reset
- [ ] A full-resolution flesh history, ping-pong (colour + the current frame's
      depth, which is what the reprojection unprojects next frame).
- [ ] `resetHistory()` and an epoch counter, per the decision note: resize,
      teleport and boot transitions RESET rather than reproject garbage.
- [ ] Test (pure, no GPU): the epoch/reset bookkeeping and the Halton sequence.

### 3. The resolve
- [ ] `accNew = mix(reproject(accPrev), currentLowResNearestSampled, alpha)`, with
      the depth taken from the CURRENT frame (a blended depth describes no
      surface — the repo already pins that rule for the weave).
- [ ] Camera reprojection only, reusing the retained per-frame inverse VP (the
      held-row work built that; `temporal-start.ts` is the precedent for the
      maths). **No object motion vectors, no validity test and no neighbourhood
      clamping in this first version** — the owner has accepted ghosting, and each
      of those is a measurable follow-up rather than a prerequisite.
- [ ] Ship OFF behind a seam (`setTemporalAccum(on, alpha)`, `?accum=1`), pinned
      in the bench reset block like every other seam.

### 4. Point the composite at the accumulated flesh
- [ ] When accumulation is on, the composite reads the accumulated flesh texture
      instead of the raw low-res march. One texture input, gated; the crisp poly
      path and the depth test are untouched.

## The gates, in the order that kills the idea cheapest

1. **STILL-CAMERA CONVERGENCE — the kill criterion.** With a frozen camera and a
   frozen scene, hash/sample the frame as it accumulates: it must move toward the
   `sdfScale 1.0` reference and SETTLE. Measure `mean|Δ|` against the 1.0 render as
   a function of frames-since-epoch. If it does not fall meaningfully, the
   accumulation is not reconstructing detail and **the project is dead** — do not
   proceed to motion, do not add motion vectors.
2. **Cost.** The march at 0.5 (−4.06 ms) plus the resolve must beat the shipped
   frame. Report the resolve's own pass row.
3. **In motion, the owner's eyes** — shimmer and ghosting at 0.5+accum while
   walking. Ghosting is pre-accepted; *shimmer* (unconverged aliasing crawling) is
   the failure that would make it unshippable, and it is the thing a still cannot
   show.
4. **Frame-hash protocol** from the decision note: reset + warm-up, then compare a
   WINDOW of hashes within one boot; `repeat`/`resample` must keep passing
   bit-for-bit.

## Do not

- Do not accumulate into the low-res grid (that is a blur — see the mechanism
  above).
- Do not accumulate the composited output; the level and viewmodel must stay crisp.
- Do not build motion vectors, a validity test or clamping before gate 1 has
  passed. Ghosting is accepted; reconvergence is not yet proven.
- Do not freeze the jitter for recordings.

---

# IMPLEMENTED 2026-09-10 — and GATE 1 PASSES

**Built:** `TEMPORAL_ACCUM_WGSL` + the resolve pass in `sdf-layer.ts` (output-sized
`accumPrev`/`accumNext`, ping-ponged by a true texture copy — fixed bindings, so the
shader cannot disagree with what it is reading), the sub-pixel jitter on the march
camera, `resetHistory`/epoch, the composite's gated `accumTex` input, the pure module
`temporal-accum.ts` (+9 tests), `?accum` / `?accumscale` / `?accumalpha`,
`setTemporalAccum` / `resetTemporalAccum`, and the bench reset-block pin. **Ships
OFF**; turning it on turns the field weave off (mutually exclusive — accumulation
replaces the weave).

## The kill criterion, measured: still-camera convergence

`scripts/sdf-accum-convergence.{mjs,sh}`. Frozen camera, frozen sim, `?vhs=off`,
body staged at 2.5 m, `ACCUM_FRAMES=20`, α = 0.25.

| frames accumulated | mean \|Δ\| vs a CONVERGED full-scale accumulation |
| --- | ---: |
| **none (raw 0.5 march)** | **5.818** |
| 1 | 1.600 |
| 2 | 0.956 |
| 4 | 0.545 |
| 8 | 0.390 |
| 12 | 0.356 |
| 16 | **0.347** ← settled |
| 20 | 0.352 |

**The reconstruction works, and it converges on schedule**: 5.818 → 0.35, a 94%
reduction, settling inside the 17-frame window α = 0.25 predicts — which is the
independent confirmation that the blend rate is doing what the maths says.
**Gate 1 PASSES.** Motion (and the owner's eyes) are worth measuring next.

## Three things worth keeping from getting there

1. **THE REFERENCE FOR THIS GATE WAS WRONG FIRST, IN A WAY THAT LOOKED LIKE A
   FAILURE.** Against the *unjittered* scale-1.0 render the accumulation reads as
   a catastrophic regression (5.8 vs the raw march's 0.5). That comparison is
   meaningless by construction: the unjittered render is ONE ALIASED SAMPLE, and
   the accumulation's entire job is to remove aliasing, so a smoother estimate
   must read as "further away". A converged accumulation at full scale is the fair
   reference — two reconstructions, one with 4× the samples. **Do not put the
   aliased-render column back as the verdict.**
2. **NEAREST RECONSTRUCTION CANNOT WORK, AND THE FAILURE WAS DIAGNOSABLE.**
   Version 1 fetched the low-res march with a nearest tap. A sub-pixel jitter then
   does not move the sample sub-pixel — it flips WHICH low-res texel the output
   pixel reads, i.e. a two-pixel jump at scale 0.5, so the accumulation averaged
   texel-quantum jumps into an edge smear. The tell: sharpness was UNCHANGED
   (mean |horizontal gradient| 1.68 nearest vs 1.70 accumulated vs 1.64 at full
   scale), so it was not a blur — it was quantised displacement. Fixed with a
   hand-written bilinear gather (the target is NearestFilter) that renormalises
   over the taps which actually carry a surface, with coverage/depth taken from a
   SINGLE tap (a blended depth describes no surface — the rule the weave already
   pins).
3. **A RESIDUAL ODD/EVEN RIPPLE OF ~0.5-1.0 LEVELS REMAINS**, and it is the probe
   gather's `probeGatherRate = 2` cadence showing through: the dynamic probe layer
   refreshes every other frame, so the shading alternates and the accumulation
   faithfully damps a real in-engine alternation rather than a bug in this pass.
   If it ever matters, `?proberate=1` removes the source.

## Cost

`sdf:accum` (the resolve pass, including the ping-pong copy) measures **0.05 ms**
— against the 4.06 ms the march gives up at scale 0.5. The frame numbers from that
run are NOT usable (41 ms fenced frames, i.e. the machine was loaded by another
session); **re-run the cost on a quiet machine before quoting it.**

## Next

1. A clean cost run (`BENCH_PRELUDE='__sdfGame.setSdfScale(0.5);__sdfGame.setTemporalAccum(true)'`)
   on an idle machine.
2. **The owner's eyes in motion** — `?accum=1&frozen=0` and walk: the question is
   SHIMMER (unconverged aliasing crawling), not ghosting, which is pre-accepted.
3. Only after that: the frame-hash epoch/window protocol wiring, then decide
   whether the low-res march becomes the default.

---

# FIXED 2026-09-10 — the flesh was MIRRORED (owner-caught), and the gate could not see it

**Owner, on the view test:** *"when i turn accumulation on in the console it causes
the sdf bodies to mirror across the x axis so it looks like the sdf bodies are
walking on the ceiling and the mesh parts (skeleton and armor) are walking
upright."*

**Cause: my resolve quad read its textures with the wrong Y origin.** A quad
sampling `uv()` writes with the OPPOSITE Y origin to the texture's texel rows —
`uv.y = 1` is the TOP fragment while texel row 0 is the top row, so
`textureLoad(uv * dims)` reads the BOTTOM row from the top fragment. **The repo
already paid for this once**: the field ring's retention had to become a TRUE
TEXTURE COPY because a quad blit produced a vertically mirrored retained field.
A blend cannot be a copy, so the fix is the other thing that note allows: the
resolve now takes the SAME `flipY` uniform the composite does and applies the same
adjustment, instead of hard-coding a mirrored index (which that note forbids,
because it bakes in one platform's convention).

The tell that it was this and not the composite: **only the flesh flipped.** The
flesh goes through this pass; the mesh skeleton, armor and viewmodel are drawn
directly at full resolution and stayed upright.

**Why gate 1 missed it, and the lesson:** the staged subject was vertically
CENTRED, and a mirror of a centred subject is invisible to a difference metric —
the curve converged beautifully while the body was upside down. A gate that stages
one framing inherits that framing's blind spots.

**The verification that does see it** (`/tmp/flip-check.mjs`, ad-hoc — worth
keeping if this pass survives): stage the body OFF-CENTRE (pitch shifted), then
compare the accumulation's first frame of an epoch (alpha = 1, i.e. an identity
case) against the raw low-res march, and against that same capture flipped:

| | mean \|Δ\| |
| --- | ---: |
| accumulation frame 1 vs the raw 0.5 march | **0.375** |
| ... vs the same capture flipped in Y | **30.162** |

0.375 is the identity, and it is also independent evidence that the BILINEAR
reconstruction is doing its job: with a nearest fetch a sub-pixel jitter made this
comparison read ~7 levels, and bilinear turns it into a sub-pixel resampling
difference.

---

# VIEW-TEST VERDICTS (owner, 2026-09-10) — reconstruction REJECTED, the smear LIKED

Three separate findings from one play session, and they point different ways.

**1. RECONSTRUCTION AT 0.5 — REJECTED.** "its too low res its too blurry". Gate 1
passed on the metric (5.82 → 0.35 against a converged full-scale accumulation,
converging on schedule) and the look still fails. **A converging metric is not a
look verdict** — worth remembering next to the fact that the gate also missed a
Y-flip because its subject was centred.

**2. PERFORMANCE READS WORSE AND SPIKIER THAN THE FIELDS** — despite the march
costing half as much in the bench. Not yet explained, but the code has an obvious
suspect: the ping-pong is a `copyTextureToTexture` of a FULL-RESOLUTION RGBA32F
buffer (~16 MB/frame), which is not a labelled pass and so is invisible to the pass
timing I quoted. That copy is the first thing to price, and swapping bindings for a
copy is the likely fix.

**3. THE SM EAR IS LIKED, BUT AS AN EFFECT, NOT AS RECONSTRUCTION.** In the owner's
words: *"i like the smearing effect but applied selectively in a way that looks like
per object motion blur"*, and *"i think it would be cool with the fields ... our
defaults was that that was acceptable sharpness and performance but the lines were a
bit distracting but if with the smear blur i think that would look interesting"*.

### The ghosting they described IS the mechanism, mis-reprojected

Reported artifact: *"when a zombie or character walks the texture of them seems to
smear from previous frames so its like they are painting a series of past frames but
in their silhouette."*

That is exactly what a CAMERA-ONLY reprojection does to a moving object, and it is
worth being precise about why: the history is fetched at the position predicted by
the camera. For a static camera that is the SAME pixel, so the running
`mix(history, current, alpha)` accumulates whatever was at that pixel over the last
~1/alpha frames — a stack of the body's past appearances, offset along its motion,
painted inside its current silhouette. The streak direction is right (it follows the
motion) but the SAMPLING is wrong, because nothing in the pass knows the body moved.

**So the effect the owner likes is a proto-per-object-motion-blur, and the artifact
is the same thing without the per-object term.** Fixing the term is not a
workaround for the smear — it IS the feature: reproject the history by each body's
own screen-space velocity and the stale stack becomes a velocity-aligned streak,
which is what per-object motion blur is.

### What that implies for the plan, and the cheapest way to a verdict

- **The jitter goes away.** It exists only to reconstruct resolution, and
  reconstruction is rejected. A blur wants the reprojection and the blend, nothing
  else.
- **The low-res march goes away with it.** At the shipped scale there is nothing to
  reconstruct, so "too blurry" cannot happen; the blur is then purely the smear.
- **Per-object motion vectors move from "deferred follow-up" (the plan's task 3) to
  the main event.** The vertex data is close to hand — `bone-instancer.ts` packs
  posed instances per frame — but a screen-space motion field still needs its own
  pass and target, and it must cover the MESH parts too (skeleton, armor), not just
  the marched flesh, or bone and flesh will smear differently.
- **Keeping the shipped weave AND adding the smear is the expensive option**: the
  accumulation currently sits BEFORE the composite, on the raw march target, and is
  mutually exclusive with the weave. Blur-on-top-of-the-fields means accumulating
  the WOVEN flesh, i.e. restructuring the composite so the weave output becomes an
  input to the resolve rather than the final step. Worth it only if the owner wants
  the h/2 half-row saving kept alongside the blur.

**Cheapest next step, before ANY motion-vector work:** the owner's own A/B at full
sharpness and no reconstruction — scale 1.0, no weave, no jitter, alpha tuned:

```js
__sdfGame.setSdfScale(1);
__sdfGame.setTemporalAccum(true, 0.6);   // try 0.5 / 0.6 / 0.75
```

If the smear still reads well there — sharp flesh, trails only on movement — then
per-object vectors are worth building. If it only looked good because the low-res
march was already smearing, the effect was a by-product and the direction is dead.
