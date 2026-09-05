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

## Retry-brief instrument fixes (2026-09-05, before any benching)

The implementation was already green on this branch; the retry session's job
was benching. Four instrument fixes landed first:

- `goo-smoke*.mjs` deleted. The seam verification the smoke scripts existed for
  is 12 SINGLE-LINE evals through `connectGame` (defaults, each seam on/off via
  `setGooPerf`'s return value, passGate off/restore, `gooProbe` typeof, bleed
  readback) — all pass.
- **`L.benchArgs` leaked into the page eval as bare JS** (`sdf-closeup-stage.mjs`):
  `...(L.benchArgs ?? …)` inside the template reached the page where `L` does
  not exist → `ReferenceError` on the first real bench rep, before any number
  existed. Interpolated node-side. This is exactly the failure class the
  smoke scripts were supposed to catch — and why a smoke that never runs is
  worth nothing.
- **Top-level `await` inside `Runtime.evaluate` is a syntax error**, and the
  gooProbe readback's `.catch(() => null)` swallowed it as `cov ?` on every
  row. Wrapped in an async IIFE; single-line discipline kept.
- Bench JSON filenames now carry the staging mode — phase0-close overwrote the
  room-4 phase0 JSON (printed summary survived in the log).

## What the room-4 firefight says (phase 0, first run)

5/5/5/5/4/5 kept rows (18 load-rejects during a sibling vitest storm, 3
makeup reps), interleave rotation intact, `uptime`/load quoted per row in the
JSON. The clock basis drifts 2.25x WITHIN one run (same leg: 17.1 → 7.6 ms as
GPU clocks ramp), so medians-of-raw-p50 are meaningless; the deltas below are
medians of WITHIN-REP deltas (all legs of rep k share a clock window).

| segment | ship p50 | whole goo (ship−goooff) | surface (ship−nosurface) | density (ship−nodensity) | blur (bluron−ship) |
|---|---|---|---|---|---|
| walk (idle, no blood) | 7.61 | 0.26 [n4, 0.03..0.57] | −0.09 [−0.78..0.28] | 0.17 [−2.30..0.22] | 0.55 [−0.09..1.23] |
| fire | 14.01 | 0.54 [−4.14..0.87] | 1.94 [−2.62..3.36] | 0.16 [−1.11..2.14] | 0.36 [−2.92..4.81] |
| gib | 11.56 | 0.07 [−0.12..0.85] | −0.19 [−0.21..0.27] | −0.22 [−0.42..−0.03] | 0.28 [−0.06..0.45] |

Coverage at gameplay range: **cov 1.05%** (ship/nosurface/bluron), bigblobs
1.31% — there is almost no goo on screen at room-4 range, and the whole chain
is worth ~0.1–0.5 ms of an 11–20 ms frame. The idle answer is already here:
whole goo at idle ≈ 0.26 ms — the idle-frame early-out is confirmed a non-win.

**The premise does not reproduce at gameplay range.** The spec's claim was
written from code reading and marked "a bench must confirm"; at the range the
firefight benches, the goo layer is noise-level. The spec's own scene — the
close-up — is where the question had to go next.

## Coverage reality-check (drives the close-range staging)

Manual trajectory of the 1.1 m burst staging (frozen boot, manual steps,
`gooProbe` after each):

| step after staging | 0 | 6 | 12 | 18 | 24 | 36 | 48 | 72 |
|---|---|---|---|---|---|---|---|---|
| cov % | 1.29 | 1.61 | 1.99 | 1.52 | 1.56 | 1.34 | 0.87 | 0.52 |
| droplets | 166 | 151 | 128 | 105 | 82 | 63 | 43 | 23 |
| splats | 13 | 34 | 61 | 89 | 124 | 149 | 173 | 201 |

Even point-blank, one slug's burst peaks at **~2% density coverage** — the goo
is streaks, not a flood. Binary coverage cannot see additive overdraw (N quads
on one texel count once), which is why the per-pass attribution still matters.
Two further instrument findings:

- **The bench's default warmup (120) + 240-frame window samples only the dead
  tail** of a burst that decays in ~1.5 s (first close run: droplets 2, cov
  0.1%). Close legs pin `warmup 10, closeupFrames 80` — the peak-to-early-
  decay window.
- **`stampWoundAt` never bleeds.** It carves + spills but does not enter the
  bleed ledger — 8 stamps + 2400 steps → droplets 0, splats 0, on frozen AND
  live pages. The ledger is fed by real SEVERS (fireSlug → stump gush
  emitter). The capture spec's stamp-built "accumulated floor" scene was dead
  on arrival; rebuilt around 3 point-blank slugs + hold until the 256-ring
  saturates (cov 6.18% looking down at the pool — the real heavy state).

## Phase 0 — close-up and floor attribution

(pending: close burst at cov ~2%, floor pool at cov ~6%)

## Phase 0 — per-pass attribution (pending bench)

(tables to land here)

## Items — A/B and look (pending bench + captures)

(tables to land here)

## Verdicts

(pending)
