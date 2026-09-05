# Close-up task 4 — the goo layer is the blood cost

**Date:** 2026-09-04 · **Branch:** `dispatch/2026-09-04-closeup-task-4`
**Status:** in progress
**Base:** main `8078f0a` (task 1b merged)

## What this task is

Phase 0: attribute the goo frame per pass (density / blur ×2 / surface
composite) as a function of covered area, not particle count, plus the idle
fixed cost. Then the three items, each behind a seam, each benched on/off,
each look-judged unfrozen:

1. **Surface composite at full canvas res** → shade at density res and
   upsample (`setSurfaceAtDensityRes`).
2. **Density-pass overdraw** → skip sub-texel quads (`setMinTexelRadius`) and
   fill the cap by projected area (`setAreaPriority`).
3. **Splats never age out** → fade the density contribution of the oldest
   ranks (`setSplatFadeTail`), billboards untouched.

## Implementation shape (as landed)

- Item 1 reuses the EXISTING shading graphs — `shadeOf()`/`makeOverlayMat()`
  are resolution-independent fullscreen-quad node graphs. The low path adds:
  a density-res RGBA16F `surfaceLow` target (no depth attachment), a
  `makeLowDepthMat` variant that packs the reconstructed depth into the
  colour ALPHA (the shading pass must not depth-test — its own depth buffer
  would be empty; the hardware depth test moves to the upsample, per output
  pixel), and one tiny WGSL fn (`GOO_UPSAMPLE_WGSL`, nearest `textureLoad`,
  NO flipY — target-to-target is orientation-preserving; the shading pass
  already paid the canvas-boundary flip when it read the density field).
  Cleared alpha 0 is the empty sentinel the upsample discards on.
- Item 2 is sync()-side only. `projectedTexelRadius()` is the projected-size
  test the sim size cannot make (mistMaxSize sees the droplet, not the
  distance); area priority fills droplets+splats from ONE pool ranked by
  projected area (also fixes silent splat starvation at the cap: splats were
  filled after droplets, so a full roster erased every pool).
- Item 3: `Splat` has no age, but the 256-ring is `push`+`shift`, so ring
  position IS recency — no blood-sim change. The weight rides a new
  `fallMask` instanced attribute multiplying ALL accumulated channels
  equally (g/r depth ratio and b/r gut ratio survive, same invariant as the
  blur's uniform weights). ×1.0 is IEEE-exact, so seam-off is bit-identical.
  The fade engages only once the ring holds MORE than `fadeTail` splats — a
  young pool must not thin.
- Diagnostic: `setPassGate({density,blur,surface})` — skips passes so a bench
  can time them apart; a gated frame is WRONG on purpose. The blur gate
  skips only the blur RENDERS; the surface still reads the blurred texture,
  so a gated surface leg times the same shader.
- Page seam: `__sdfGame.setGooPerf(o)` + the `goo.perf` getter. Deliberately
  NOT in setGooTuning (the goo panel's copy button emits tuning keys; a perf
  lever there would let a tuning paste silently move a bench seam).
- Harness: `runInterleaved` gained `L.legJs` (per-leg seam application, the
  exitBound precedent), `L.benchArgs` (per-leg bench opts), all-segment rows
  (`row.segs.walk/fire/gib`), and `evaluate` in the onRow context.

## Findings so far

- **The pass-A "ALPHA 0, explicitly" comment is stale.** `Color4.set(color)`
  defaults alpha to 1, so the shipped `setClearColor(0x000000)` actually
  clears the density target's alpha to 1 — and has all along. Harmless: the
  gut mask moved to `.b` (organs r3) and no shader reads `.a`. Left untouched
  (the code is shipped-correct); recorded here because the surfaceLow clear
  DOES need real alpha 0 and gets it explicitly: `setClearColor(0x000000, 0)`.
- The game page ships `blurPx 0` (owner: "we can remove the blur") and
  `mode 'depth'` — the spec's "already blurred by sigma 2.5" mitigation for
  item 1 does NOT hold on the game page; the field is raw half-res sums.
  The nearest-upsample choice is the conservative response: identical field
  data, only sub-texel ray variation lost.
- Content size on the bench canvas: 800×600 (4:3 cap) → density target
  400×300, surface composite 480k px → item 1 shades 120k px.

## Phase 0 — per-pass attribution (pending bench)

(tables to land here)

## Items — A/B and look (pending bench + captures)

(tables to land here)

## Verdicts

(pending)
