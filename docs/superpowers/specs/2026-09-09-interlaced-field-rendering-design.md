# Interlaced field rendering for the SDF layer — design

**Date:** 2026-09-09 · **Status:** approved in brainstorm · **Supersedes:** the
half-rate (C2) default flipped on earlier today.

## Why

Measured, from two owner gameplay captures plus the pass attribution:

- `sdf:march` is **75–83%** of the GPU frame. Everything else combined is under
  1.5 ms; `sdf:polys` (the whole polygonal scene, skeleton meshes included) is
  **0.69 ms**.
- The close-up spike is an **interaction**: a body covering 55–100% of the
  screen with <40 wounds is **0.0%** over budget (n=412); 140+ wounds at <15%
  coverage is **0.9%** (n=222); both together is **11–16%**. Cost is covered
  pixels *in the near-wound zone* × per-pixel near-wound cost.
- Every per-pixel wound lever is spent with evidence: per-ray wound list ~0
  (parked), bounded regions +9% slower, early-out nil, step multiplier already
  at its fastest, and for **soldiers** the inside-flesh gate never fires at all
  (35 bones, **zero** organs).

So the only remaining lever is **fewer marched pixels**. Half-rate was tried
first and fails on look, for a reason that is now understood.

## Why not half-rate

Half-rate holds the whole marched frame and reprojects it. Two problems, both
observed by the owner in play:

1. **It desyncs from full-rate polygons.** Skeleton meshes, kit armour and the
   held prop ride the same rig but draw as polygons. Owner screenshot: a
   skeleton standing outside its own body. Fixed in `794e1ea2` by holding their
   pose — but only the *animation* half of the desync.
2. **The reprojection half remains.** The held flesh is *warped* to the current
   camera while polygons are *rendered exactly* at it. Standing still they
   agree; **strafing they do not**, and the error grows with camera motion.
   That is a ceiling on hold-and-reproject, not a bug to fix.

Note this was not a flaw in the original C2 work. When half-rate was built and
judged (2026-08-31) bones were rows **inside** the marched field and held with
it. The 2026-09-08 mesh migration moved them to polygons and silently
invalidated that verdict.

## Why field rendering instead

Every pixel drawn this frame is drawn **now**, at the current camera and the
current pose. There is no held camera and no reprojection, so the entire
camera-motion error class disappears by construction rather than being reduced.
Same ~50% saving on the dominant pass.

And the artifact is the point: the owner wants the interlacing look of old
digital video — alternate fields captured at different instants. That is the
same mechanism, so the cost and the aesthetic are the same thing.

## Scanlines, not checkerboard

**Performance is identical; implementation is not.**

**THE TRAP:** you cannot save GPU time by `discard`ing alternate pixels in a
full-resolution pass. GPUs shade in 2×2 quads; both patterns leave live pixels
in every quad, so every quad still executes and nearly full cost is paid. The
saving only exists if **fewer pixels are rendered** — into a smaller target.

- **Scanlines**: render into a **half-height** target, alternating a half-texel
  vertical offset per frame, interleave on composite. `setScale` already
  reallocates these targets, so the mechanism exists.
- **Checkerboard**: needs quincunx addressing, per-frame sub-pixel jitter and a
  pattern-aware reconstruction pass. Materially more work, and its artifact
  reads as shimmer, not interlacing.

Checkerboard's only advantage is reconstruction quality (4 neighbours vs 2),
which is explicitly not being optimised for here.

## Architecture

In `sdf-layer.ts`, beside the existing half-rate state:

- **`fieldMode: boolean`** — alternative to `halfRate`, not additive. Enabling
  one disables the other; both on is a configuration error the layer refuses.
- The march target is allocated at **half height**. Each frame renders field
  `frameIndex % 2`; ray generation carries a half-texel vertical offset so the
  two fields sample different scanlines rather than the same ones twice.
- **`prevField`** target retains the other field from the previous frame.
- The composite interleaves per output row: rows belonging to the current field
  sample the fresh target, the others sample `prevField`.
- **`combStrength` uniform, 0..1** — `1.0` holds the stale field verbatim
  (maximum comb, full interlace look); `0.0` blends toward a vertical
  interpolation of the **current** field only (soft, no comb, at the cost of
  vertical detail). Live knob: `__sdfGame.setFieldComb(x)`.

Seams, following the `setHalfRate` / `setOccluder` convention:
`__sdfGame.setFieldMode(on)`, `setFieldComb(x)`, `fieldMode`, `fieldComb`.
A bench leg `field-on` so the win is measured, not asserted.

Telemetry records `fieldMode` and `combStrength` in the capture metadata and
per-frame state, so a recording says what it was testing — the same gap that
made the first two captures ambiguous.

## Known interaction: the meshes stay full-rate on the first cut

Skeleton meshes render full-res every frame in the forward scene, so on
alternate rows one-frame-stale flesh sits against current bone.

This is deliberately accepted for the first cut. It is the same class of
disagreement as the half-rate desync, but reduced from "the whole flesh, plus
reprojection error" to "half the rows, exactly one frame, no warp" — and it
should read as interlacing rather than as the skeleton-outside-body artifact.

**It is also the most likely reason the first cut looks wrong.** If it does,
the fallback is to give the meshes the same field discipline. Rendering them at
lower resolution is NOT the fix — `sdf:polys` is 0.69 ms, so there is no
meaningful time there; the reason to move them is coherence, not cost.

## Testing

Pure (vitest, no GPU): field parity — the two fields together must cover every
output row exactly once, with no row sampled twice and none skipped, at both
even and odd frame indices and across a target resize.

GPU/bench: a `field-on` leg against baseline on a quiet machine, judged against
each leg's own repeat spread. Room 5 needs 3+ repeats (it spread 55% at 2).

Owner gate: a gameplay capture, judging (a) whether the comb reads as
intentional, (b) whether flesh/bone row disagreement reads as interlacing or as
a bug, and (c) whether it feels smoother than half-rate did.

## Risks

| Risk | Mitigation |
| --- | --- |
| Discard-based implementation saves nothing | Half-height target is the design, not an optimisation; the bench leg proves it |
| Flesh/bone row disagreement reads as a bug | Accepted for cut 1, fallback specified above |
| Comb too strong at speed | `combStrength` is a live uniform, tunable in play |
| Vertical detail loss at low comb | Documented as the trade at the `0.0` end |
| Half-rate and field both on | Layer refuses the combination |
