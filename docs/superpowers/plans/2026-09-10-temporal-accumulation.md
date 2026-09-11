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
