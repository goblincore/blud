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
