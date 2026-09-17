# Rupture slough + optical refraction — Task 1 implementation

Commit base: `f3526b2c` (branch `codex/rupture-slough-refraction-task-1`, created by
dispatch as an isolated worktree; not pushed/merged). Node `v22.22.1`.

This note records what was implemented, the measurements that drove the two
changes, the exact commands/results, and — explicitly — what has NOT been
verified. **No browser/GPU capture was run in Task 1; visual acceptance belongs
to Task 2.** Nothing here is an owner-acceptance claim.

## 1. Owner corrections this task answers

The preceding task (`23497213`) claimed a head fix and shipped a refraction. The
owner rejected both:

- the chest still enveloped the head in manual play — the "fix" was more head
  translation around an independent **0.3 m cranial chest peel**;
- `?blastdistort=1` was indistinguishable from off.

So Task 1 does **not** amplify or relabel either. It replaces the rigid peel
with a non-rigid endpoint slough and replaces the refraction feed that could not
be seen.

## 2. Non-rigid slough (gib-tear.ts, gib-parts.ts, game-main.ts)

### What changed

- **The rigid cranial chest peel is deleted.** `TearTuning.chestPeelM`, the
  `peel` block in `ruptureOffsets`, and the 0.3 m lift are gone; a test pins
  `'chestPeelM' in TEAR_TUNING === false` so no param can restore it. The
  planner's `GibPiece.peel` survives as the ribcage-band **weight** for the new
  slough (`1 + peelSloughK * peel`: chest ×1.4, abdomen/pelvis ×0.72).
- **Every FLESH endpoint is displaced individually** (`sloughSample`,
  `sloughPrim` in `gib-tear.ts`): outward from the blast and world-down, with an
  exponential distance falloff (`sloughFalloffM` 0.7 m) and a front-dependent
  start so the near side leads (`sloughLead` 0.55). A capsule whose two ends are
  driven differently **stretches**, and its radius thins as `1/sqrt(stretch)`,
  floored at `1 - sloughThinK` (0.45).
- **Point blobs are drawn into short strands.** The zombie torso is mostly
  spheres (`a == b`); a sphere has no two ends, so it previously only slid as an
  unchanged ball. Each point blob is now elongated along the pull by up to
  `sloughStretchM` (0.08 m) at its own weight and thins by the same volume
  argument. This is the visible half of the non-rigid silhouette change.
- **The head keeps almost none of it** (`sloughHeadKeep` 0.12) and **bones keep
  almost none** (`sloughBoneKeep` 0.06): the skeleton stays near the pose and
  the flesh pulls off it. That gap — not a separate reveal timer — is the rib
  exposure.
- **The release carries the drawn geometry.** `rupturePosed` now returns
  `deformedPrims`/`deformedBones` (the sloughed source arrays, before rigid
  motion) and `game-main` runs
  `retargetGibPieces(q.plan.pieces, frame.deformedPrims, frame.deformedBones)`
  before `displaceGibPieces`, so a spawned chunk's sourced flesh/bone prims are
  the geometry that was last drawn. No snap back to the clean pose. The
  appended `sub` cut caps have no source index and keep their own geometry,
  as before. `retargetGibPieces` also recomputes each piece's `radius` from the
  drawn geometry so broad-phase bounds/support stay valid.
- **A/B control:** `?tearslough=0` multiplies the out/sag/stretch terms to zero,
  giving the old rigid-region motion (with the head attachment intact) as the
  honest comparison. Default is 1.

### Measurements (zombie, `gibPlan`, side blast, falloff 1, age = 0.2 s)

- 23 flesh prims (9 capsules, 14 point blobs); 10–11 prims change their own span
  by > 1 cm / > 2 %.
- Max capsule stretch **1.015–1.051**; max endpoint displacement **0.179 m**;
  thinning observed (≤ `sloughThinK`).
- Head: max endpoint displacement < 0.05 m, span change < 5 % — face intact in
  the CPU model.
- Skeleton: `bone.cage` moves < 0.03 m while the chest flesh moves > 0.08 m
  (≥ 4×), i.e. the cage is left standing.
- Release/union residual (point-sample miss over the drawn solid, see
  `gib-rupture.test.ts`): **rigid-only 0.073**, **slough 0.117** (same 40³
  sampling, total > 8 500). The extra ~4 points are smooth-union (smin)
  bridging between regions whose stretched prims now reach further; the test
  calibrates against the rigid frame rather than a magic constant and bounds the
  delta at +0.05. This is a quantified residual, not an asserted exact union.

### Tests updated/added

- `gib-tear.test.ts`: removed the rigid-peel expectation (replaced with the
  field-is-gone pin), added the `non-rigid slough` block (identity at onset/zero
  falloff, shape change, outward+down+leading, head coherence, skeleton lag,
  non-rigid region, degeneracy/determinism), and re-based the "rotates rigidly"
  check on `deformedPrims`.
- `gib-rupture.test.ts`: the hand-off test now proves the drawn frame is
  `slough → region rotate/translate`, and that the released piece prims are the
  same sloughed geometry (not the clean pose); the union test calibrates the
  residual against the rigid frame and includes bone pieces.
- `gib-parts.test.ts`: `retargetGibPieces` maps sourced flesh/bone by index and
  keeps unsourced caps.
- `game-actor.ts`/`character-view.ts` needed no change: `stepTear` already
  uploads `frame.body`, and the view is transparent to how the prims were made.

## 3. Optical refraction (blast-refraction.ts, post-aa.ts, game-main.ts)

### Diagnosis before touching strength

The shader was not the problem; the **feed** was, in two measurable ways:

1. **Size.** The shell radius was `0.3 × burst.heightM`. `burst.heightM` after
   `scaleBurstVisual` is ~0.83 m (the rendered fireball half-height), so the
   band radius was ~0.25 m — the entire band lived **inside the opaque
   fireball**. There was no visible background at that radius to bend. The
   ring/waveform, UV flip and composition were already correct (v-up before the
   entry flip), so they were left alone.
2. **Life + decay.** 0.3 s with a squared decay put the band at 25 % by 0.15 s
   — gone before the fireball cleared.

### What changed

- New pure module `src/lab/sdf-zombie/blast-refraction.ts` owns the world
  radius, growth, decay, strength and projection:
  - birth radius `1.25 × heightM` (≈1.03 m, just outside the fireball), growing
    to `1 + 2.0` × by end of life;
  - life **0.55 s**, fast attack (10 % of life) then a linear fade, so the band
    is still at 0.6 strength at 40 % of life — the frame after the flash;
  - peak UV offset `0.020 + 0.012 × heightM` ≈ **0.030** (old effective
    ~0.022), capped 0.035; summed-offset cap raised from 0.02 to 0.035.
- `post-aa.ts` now stores each blast by **world position + birth radius** and
  **reprojects every frame** against a camera handed over once
  (`setBlastDistortCamera`), so a camera that moves during the 0.55 s life keeps
  the band on the blast. Projection is analytic (`0.5 · P[5] · r / w`) and drops
  behind-camera/off-screen blasts. No new render target, no per-blast pipeline,
  still four unrolled slots.
- The WGSL waveform is now `sin²` (broad shell) instead of `sin⁴` (hairline);
  the growth/decay moved out of the shader so they are CPU-testable and the
  shader only draws the radial profile.
- **Default remains OFF.** `?blastdistort=1&bdstrength=<0..4>` is the toggle;
  the shipped frame is untouched until Task 2 judges it.

### Tests added

- `blast-refraction.test.ts` (13 tests): birth radius clears the fireball at
  3–6 m; monotonic expansion over a life > 0.3 s; attack-then-decay with real
  strength after the flash; bounded height-scaled strength; broad symmetric
  waveform (band(0.25) > 0.4, old sin⁴ was 0.25); projection shrinks with
  distance, is aspect independent, and returns null behind the camera.
- `post-aa.test.ts`: refraction block rewritten for the world-position API
  (bounded 4-ring, sim-time aging, non-finite/degenerate drops, broad-shell
  WGSL guard, inert gate, strength clamp).

## 4. Verification run

```
node --version                       -> v22.22.1
npx tsc --noEmit                     -> exit 0
npx vitest run src/lab/sdf-zombie    -> 263 files, 4581 tests passed (112.6 s)
npm run build                        -> tsc clean + vite built in 2.99 s
```

Focused suites: `blast-refraction` 13, `gib-tear` 33, `gib-parts` 29,
`gib-rupture` 7, `post-aa` 42 — 124 passed.

## 5. Limitations / what is NOT verified

- **No visual evidence.** Task 1 ran no browser or GPU job. Whether the slough
  reads as tearing (rather than sagging) and whether the refraction band is
  visible at normal speed are **unverified** and belong to Task 2's native-vision
  review. The CPU numbers above are geometry and projection, not a look.
- The slough residual against the partition union is 11.7 % by point sampling
  (rigid 7.3 %); the visible pop, if any, is unmeasured. Task 2 must inspect the
  release frame.
- Wounds ride their region **rigidly** (`refreshWounds`/`WoundPointTransform`
  use the region offset + spin); a crater does not follow the local endpoint
  deformation. The mismatch is bounded by the slough distance (centimetres) but
  is not corrected here.
- The refraction is still not depth-gated (a wall between camera and blast is
  warped) — unchanged, documented in `post-aa.ts`.
- `retargetGibPieces` recomputes piece `radius` from the drawn prims; the
  bounded-pool/reserve arithmetic is unchanged, but no live run has confirmed
  the support/bake behaviour with sloughed chunks on the GPU.
- `game-main`'s `?gib=pieces`/`?gib=clusters` control modes recompute pieces
  from `planned.body`, which is the `frame.body` the rupture drew, so they carry
  the slough through the body array rather than through `retargetGibPieces`;
  only the default `parts` path goes through the explicit retarget.
