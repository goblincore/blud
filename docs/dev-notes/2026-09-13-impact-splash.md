# Impact splash — procedural slug crown — 2026-09-13

**Status: geometry/material REDESIGNED after the parent's first WebGPU
visual review; CPU tests + typecheck pass. VISUAL ACCEPTANCE IS STILL
PENDING and this branch is NOT accepted.** No GPU work, no browser, no shader
compilation, no captures and no benchmark were performed in this dispatch
(training window / parent coordinates visual QA). Nothing below claims the
crown renders, compiles, looks like the reference, or is fast. The only images
in this dispatch's evidence are CPU ASCII projections, which are geometry
proxies, not renders.

This branch adds a **supplementary** effect beside the accepted "Current" slug
path. It does **not** replace, retune or re-tune `IMPACT_GOUT`, `WOUND_BLEED`,
`stepBlood`, `spawnImpactGout`, the original renderer or the user-liked Smooth
reconstruction. It mutates none of those shared globals (pinned by test).

## Reference

- Animated WebP `/Users/donny/Pictures/bloodreerence/blood_Fx_ue5_niagara (1).webp`
  (120 frames @ 31 ms, ~3 bursts) plus the parent's contact sheet
  `/tmp/blood-reference-contact.png`.
- Approximate envelope measured from the animation (image statistics, not
  physical simulation): compact irregular mass emerging, broad ragged
  connected body by ~0.25–0.5 s, breaking into fragments/spray by ~0.6–0.8 s,
  mostly detached by ~1 s. Silhouette solidity (blood area / closed hull)
  stays ~0.75–0.83 through the crown and falls to ~0.36 late. Mass loses
  continuity before it falls; direction follows the outward wound normal, not
  always ground-up.
- Notes: `docs/dev-notes/2026-09-13-impact-animation-reference.md`.

## Parent review that this commit answers

The parent rendered the previous implementation in **actual WebGPU** at the
default seed 12345 / event t = 0.30 s with the front-facing wound normal. The
shader compiled and rendered, but the look was **rejected**:

- ~4–7 enormous angular pointed petals with large empty gaps between them —
  "foil or shattered glass radiating from a point".
- Pale gray/pink broad flat highlights; surfaces washed out rather than dark
  wet red.
- Tear pattern coarse and almost **no holes at t = 0.30**.
- Too few, too large detached pieces.

## Root causes (previous implementation)

1. **Isolated lobes.** The crown was 4–7 independent azimuthal surface patches
   each spanning a small angle, so the azimuthal gaps between them *were* the
   "petals". A lobe fan cannot read as a connected web no matter how the
   material is shaded.
2. **Coarse, planar facets.** `angularSegments: 7` per lobe gave ~7 angular
   samples across a whole petal, and the surface was close to a ruled strip,
   so triangle normals read as flat metal facets.
3. **Dissolve almost inert at the crown moment.** Holes came from
   `floor(uv * vec2(7.0, 5.0))` cells hashed to a scalar, thresholded by
   `cut = 0.06 + dissolve * 1.20`. At t = 0.30 `dissolve ≈ 0.001`, so
   `cut ≈ 0.06` and essentially no material fell below it. The coarse cell
   hash also produced blocky, non-organic openings.
4. **Spec/fresnel washed the surface.** `pow(dot(n,H), 96) * (0.9 + 1.7 * wet)`
   contributed up to ~2.6× the key colour, plus a `fres * 0.30` rim, over
   broad flat normals — hence the pale foil.
5. **Sparse droplets.** 12–26 per event, size up to 0.03 m, so late frames
   were a few large beads rather than a trailing spray.

## Corrections

### A. Geometry — one connected crown web, not lobes

`src/lab/sdf-zombie/webgpu/impact-splash.ts` now builds **3 continuous 2π
swept shells** (no azimuthal seam, no gap between lobes). Each shell has its
own radius/height/phase and its own deterministic seed, so they overlap in
radius and height and read as layered sheets.

- Grid: `radialSegments: 12`, `angularSegments: 192` (was 7 per lobe).
- **Rim profile** per shell/angle: a smooth 6-harmonic periodic noise
  (`splashRimNoise`) plus 10–20 narrow wrapped Gaussian **fingers**
  (`splashFingerField`). Radius fingers and height fingers use independent
  seeds/counts, so slender tips do not coincide with rim bulges. The height
  multiplier has a floor (`heightFloor: 0.30`), producing deep notches between
  fingers.
- **Continuity is structural:** both multipliers are strictly positive and
  periodic in θ, so the finger term only pushes the rim out/up and can never
  detach a lobe. A test checks that every shell ring closes and that the
  in-plane gap between consecutive angular samples stays small (a lobe fan
  would show a gap of order the lobe width).
- **Curvature:** radial and height exponents vary per angle
  (`radialPow 0.6–1.5`, `heightPow 0.55–1.15`), so fingers flare late and the
  sheet is genuinely curved, not a cone.
- **Normals/tangents** are central differences of the *drawn* world surface
  (including the gravity sag), oriented consistently by the outward radial
  direction. A unit radial tangent attribute (`splashTangent`) is emitted for
  the fragment-stage micro-normal. The angular profile is precomputed once per
  angular sample and reused by all finite differences, which keeps the build
  fast (one event = 3 × 13 × 193 = 7,527 verts).
- The gravity/curl gains were reduced (`gravityGain 0.55`, `curlGain 0.50`) so
  the late sag cannot fling the crown out of its small bounded region (pinned
  at t = 0.25/0.6/0.95, maxR < 1 m).

### B. Tear/dissolve — multiscale material-space noise, back-loaded ramp

- Holes come from a **3-octave Perlin field** built with three's own
  `mx_noise_float` TSL node, sampled on a circle —
  `vec3(cos(2πv)·k, sin(2πv)·k, u···)` — so it is genuinely periodic in the
  angular coordinate and has **no seam**. Weights 0.50 / 0.28 / 0.14 give
  broad connected openings plus finer raggedness; no cell quantisation.
- The field is thresholded with a smooth band and biased by a high-frequency
  **ragged rim** term near `u → 1` and a **thinning foot** term near `u → 0`.
- **Per-event dissolve** is now a vertex attribute (`splashDissolve`) instead
  of a single shared uniform, so several live events at different ages each
  get their own dissolve (a shared uniform applied the oldest event's
  dissolve to every crown).
- `IMPACT_SPLASH_DISSOLVE_POINTS` is a monotonic, smooth, **back-loaded**
  ramp (`[0.12,0] [0.26,0.12] [0.39,0.20] [0.52,0.34] [0.70,0.58]
  [0.87,0.95] [1,1]`): the mass stays mostly connected through the crown
  window and only then loses continuity.
- CPU check against the same field maths (per-vertex sample, a **proxy**, not
  a render): hole fraction ≈ 0.05 at t = 0.10, **0.13 at t = 0.30**,
  0.23 at 0.45, 0.48 at 0.60, 0.87 at 0.80, 1.0 at 1.00 — matching the
  reference solidity envelope instead of the previous "almost no holes".

### C. Material — dark saturated wet red, focused highlights

Built entirely from TSL nodes (no custom WGSL string) so the noise is three's
own tested emitter output:

- `baseCol ≈ vec3(0.34, 0.013, 0.020)`, `deepCol ≈ vec3(0.05, 0.0016,
  0.0045)`, mixed by the wetness mask; diffuse dominates.
- Specular reduced ~4× (`0.26` gain vs `0.9–2.6`) and multiplied by a
  material-space **gloss noise**, so the lobe breaks into small wet glints
  instead of a broad pale wash. Fresnel rim reduced ~5× (`0.055`).
- A **micro-normal** perturbs the shading normal along the per-vertex radial
  tangent using another material-space Perlin term, so roughness/normal
  variation is coherent and moves with the sheet (never world-space).
- Still not flat emissive: the surface shades through `ndl`.

### D. Droplets / fragments

- 60–140 per event (cap 160), size 0.005–0.018 m, born across 0.16–0.98 s so
  late droplets trail the tear.
- Each droplet records its launch velocity; the layer stretches the instance
  `dropletStretch: 2.4`× along flight and shrinks later droplets, so they read
  as fine fragments rather than beads.

### E. Alpha plumbing (validated against installed three, not just maths)

The sheet stays an **opaque alpha-tested cutout**: `transparent = false`,
`alphaTest = 0.5`, `depthWrite = true`, `depthTest = true`. The computed alpha
is wired to the **explicit `opacityNode`**, and `colorNode` is
`vec4(rgb, 1.0)` so no alpha is smuggled through a channel three might
reinterpret.

Checked against `node_modules/three` (r185) rather than assumed:
`src/materials/nodes/NodeMaterial.js#setupDiffuseColor()` builds
`diffuseColor.a = colorNode.a * opacityNode`, runs
`diffuseColor.a.lessThanEqual(alphaTestNode).discard()`, and only **then**
forces `diffuseColor.a = 1.0` when `NodeBuilder.isOpaque()`
(`transparent === false && blending === NormalBlending && alphaToCoverage ===
false`). The discard therefore already tests the real alpha; the later force
only affects the unused blend alpha. Discarded fragments write no depth, so
holes do not occlude what is behind them. A CPU test pins `opacityNode !==
null`, `alphaTest === 0.5`, `transparent === false`, `depthWrite/depthTest`.

### F. Comparison page — frozen candidate, honest matched time

`sdf-blood-compare.html` → `blood-compare-main.ts`:

- **Default is the new Impact splash, frozen at the representative crown
  moment** `SPLASH_CROWN_SEC = 0.30 s` (the parent's reviewed moment), with
  Current one select away.
- **One shared `eventTime` drives both shapes.** Entering `current` forces the
  one-shot **burst** scenario and rebuilds the slug from t = 0 at a fixed
  1/60 s to exactly `eventTime` (`simulateCurrentTo`), so a shape flip is
  never "jet frame 30" vs an unrelated 0.3 s crown. Play steps one clock and
  re-simulates/re-poses both sides at the same t.
- The elapsed-time scrubber is labelled **`event t (both shapes)`**; `Reset to
  crown t` returns to 0.30 s.
- `filter` is labelled **`filter (Current only)`**, is **disabled** in splash
  mode, and both the diag panel and the status indicator state explicitly
  whether the filter is ACTIVE or INACTIVE.
- `__bloodCompare.state()` now carries `eventTime`, `filter`,
  `filterApplies` and the splash state.

## Tests and commands run

```
npx tsc --noEmit
# clean (no output)

npx vitest run \
  src/lab/sdf-zombie/webgpu/impact-splash.test.ts \
  src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts \
  src/lab/sdf-zombie/blood-sim.test.ts \
  src/lab/sdf-zombie/webgpu/goo-layer.test.ts \
  src/lab/sdf-zombie/webgpu/goo-presets.test.ts \
  src/lab/sdf-zombie/webgpu/blood-connections.test.ts \
  --maxWorkers=1 --minWorkers=1
# 6 files, 232 tests passed

npx vitest run \
  src/lab/sdf-zombie/webgpu/fisheye.test.ts \
  src/lab/sdf-zombie/webgpu/occluder-hull.test.ts \
  src/lab/sdf-zombie/webgpu/free-aim.test.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/game-actor.test.ts \
  src/lab/sdf-zombie/webgpu/game-deferred-lights.test.ts \
  src/lab/sdf-zombie/webgpu/post-aa.test.ts \
  src/lab/sdf-zombie/entrails-gates.test.ts \
  src/lab/sdf-zombie/explosion-aoe.test.ts \
  src/lab/sdf-zombie/fpv-mode.test.ts \
  --maxWorkers=1 --minWorkers=1
# 10 files, 492 tests passed
```

New `impact-splash.test.ts` (24 tests) adds, beyond the previous contracts:
shell continuity (ring closure + no in-plane azimuthal gap), a narrow-tip
count on the rim, unit tangents, a monotonic/back-loaded dissolve ramp, the
explicit `opacityNode`/`alphaTest` plumbing, many small trailing droplets with
recorded velocities, and the late-time bounded-region check.
`blood-compare-main.test.ts` grew to 28 tests covering the splash default, the
shared event clock, the burst-preference on shape switch, and the
explicit/disabled filter state.

## NOT RUN / NOT CLAIMED

- TSL/WGSL compilation of the new node graph; the crown has never been
  rendered. The perlin/TSL composition is built from three's own emitted
  nodes, but that is not a compile or a visual.
- Visual read vs the reference (silhouette, sheet fingers, holes, wet
  highlights, droplet sparsity, scale at close framing). The parent must
  render in WebGPU.
- Game smoke / gameplay / performance; no benchmark. The per-event geometry is
  now ~7.5 k verts × 8 events worst case, and the layer reuses preallocated
  buffers, but no frame cost was measured.
- Baseline parity of the Current slug: source-unchanged and the shared tables
  are test-pinned as unmutated, but pixel parity is NOT proven.

## Deferred acceptance checklist (owner / reviewer)

- [ ] Open `/sdf-blood-compare.html`: it now **opens on Impact splash, frozen
      at t = 0.30 s**. Confirm the crown reads as a connected torn web — no
      petal fan, no large azimuthal gaps, dark wet red with small focused
      glints, and visible irregular holes at this moment.
- [ ] Flip `shape` to `Current slug` and confirm the scenario snap to `burst`
      and that the status line shows the SAME event t; confirm the camera does
      not move.
- [ ] Play the loop and scrub `event t` 0.15 → 1.1 s: broad ragged sheets
      early, growing webbed holes, then mostly detached fine fragments; mass
      loses continuity before it falls.
- [ ] Verify the alpha plumbing on the GPU: torn edges must be crisp cutouts
      that write depth, with no depth-occlusion of the discarded regions.
- [ ] Only then attempt `?impactsplash=1` in the game and decide whether the
      supplementary crown earns a default. No automatic promotion.

Not accepted until the rendered crown is visible and parent/user compare it in
lab, then game.
