# Blood surface quality and comparison — 2026-09-13

**Status: implementation complete on CPU tests; VISUAL ACCEPTANCE PENDING.**
This dispatch ran inside a training window, so **no GPU work, no browser, no
captures, no builds, no benchmarks, no shader compilation** were performed.
Nothing below claims a shader compiles, renders, matches the baseline, or is
fast. The owner decides after training whether the candidate keeps the liked
appearance; there is **no automatic promotion**.

This revision fixes the concrete defects the reviewer found in `53588cc9`.

## What the review asked for, and what changed

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `renderVariant` never called `gooLayer.sync`, so the instancer count stayed 0 and no blood rendered | Extracted `renderVariantFrame(deps, variant, extras, target)`; every variant now sets reconstruction/extras, refreshes camera world matrices, `sync`s the **same** sim+camera, then renders. A **mock test** asserts the exact call order and object identity. |
| 2 | Page omitted `createBloodView`; game mist/splats were missing | Page now builds the production view with the game's options (`dropletDepthWrite`, `dropletViewScale: 0.5`, stretch `{k:0.5,max:3.5,thin:true}`, `mist`, `ribbons`), shows **mist + splats** and hides beads/ribbons, syncs it per frame and disposes it. Independent `goo`/`mist` toggles added for attribution; mist is **not** blanked. |
| 3 | Density sized from 800x600 output, not the game's 400x300 march; split squashed both frames into half a canvas | Source grid is a **separate control** (default **400x300**, the game march) and `gooLayer.setSize(sourceW, sourceH)` feeds the 0.5 density scale; the fixed output stays 800x600. Diagnostics label source, density and output separately. The side-by-side squash was replaced with a **full-size wipe** (`left = B`, `right = A`, adjustable position) so both sides keep equal aspect and pixel size. Wipe targets get an explicit first clear after (re)allocation. |
| 4 | Proximity fallback fused adjacent unrelated wounds | Streams are now **strict stable ids**. `Droplet.stream` is stamped at every emission site (wound via `woundStreamId`, impact gout, trail source via `trailStreamId`, gut rope via its wound) with **no RNG**. `blood-connections` groups strictly by stream equality and **rejects untagged nodes** (`untaggedRejected`); there is no proximity union. Tests cover adjacent unrelated emitters and mixed tagged/untagged input. |
| 5 | Sheet holes used `hash01(world xyz)` / `valueNoise3(world xyz)`; AABB axes flipped | Holes/noise are indexed by **(stream id, grid col, grid row)**; the patch frame is **stream-local** (flow + principal perpendicular spread) instead of sorted world AABB; a `sheetLifeFadeSec` fade prevents popping. Sheets are **OFF BY DEFAULT** and labelled experimental. Tests pin translation invariance and a widest-axis crossing. |
| 6 | Bilinear field mixed foreground/background depth into a phantom | `sampleGooField` and the WGSL now compute occupied-corner depth bounds (weight-aware) and, when the spread exceeds `GOO_FIELD_DEPTH_REL` × the nearer layer (`GOO_FIELD_DEPTH_MIN` floor), take the depth/gut ratios from the densest occupied corner instead of the blend. Normal-neighbour guards reuse the same tolerance and zero the difference when both sides are rejected. |
| 7 | Coverage ramp was one **density** texel regardless of output scale | Coverage converts the density-texel distance to **output pixels** first (`coverageTexels` uniform = density texels per output pixel), so the feather is one output pixel wide at any density scale. Density-gradient shaping and normals are unchanged. |

## A. Smooth reconstruction (candidate, default original)

`GooLayer.setReconstruction('original' | 'smooth')`, default `'original'`. The
original surface pass, its uniforms, its material table and the whole density
and blur chain are **source-unchanged**. Whether the original branch renders
**bit-identically** is **NOT verified** — that needs a same-build GPU capture
the training window disallowed; it is a deferred acceptance item, not a claim.

What the candidate does:

1. **Continuous field reconstruction before thresholding.** Each entry point
   inlines a shared block of **five bilinear fetches**; each fetch performs
   **four `textureLoad` calls** (centre plus the four corners of its cell,
   manually weighted — no sampler). That is **20 texture loads per shared
   field block**. The block is used by **both** the surface shading pass and
   the separate coverage pass, so a smooth pixel issues **40 texture loads
   across the two invocations**, not five.
2. **Depth-discontinuity guard** (defect 6): occupied corner depths are
   compared; an incompatible foreground/background pair does not blend into an
   intermediate phantom depth. Density itself still interpolates (it is
   additive); only the depth/gut ratios fall back.
3. **Antialiased coverage** (defect 7): the signed density distance is divided
   by `coverageTexels` before the one-pixel ramp. Flat field still degenerates
   to a hard 0/1.
4. **Normal audit:** the depth-derived surface normal rejects a neighbour below
   a quarter of the threshold **or** beyond the layer tolerance on either side;
   if both sides of an axis are rejected the difference is zeroed so the cross
   product degenerates to the gradient-normal fallback. The min-difference and
   NaN fallbacks remain.
5. **Alpha/depth strategy (candidate-only):** overlay keeps no depth test/write
   and alpha = coverage; depth keeps `depthTest` on and `depthWrite` off. Smooth
   does not combine with `setSurfaceAtDensityRes`; the full-res composite is
   forced and reported.

**Material/emission values are copied verbatim** from the baseline shading body
(base colour, Beer-Lambert vector, spec/gloss/rim aliases, shadow floor, legacy
gamma); `blurPx` is untouched.

`GooLayer.densityDiagnostics` now reports, separately: density W/H,
**source** W/H (the march grid), **output** W/H (the composite destination),
`densityScale`, density texels per source pixel, and density texels per output
pixel.

## B. Optional connected blood (default off)

`blood-connections.ts` derives extra density quads from the droplet array; no
particles are pushed into `BloodSim`, no RNG is drawn, and the input is never
mutated.

- **Provenance is strict.** A node participates only if it carries a finite
  `stream`. Grouping is exactly by stream id. Untagged nodes are counted in
  `untaggedRejected` and skipped — they are never assigned an identity by
  proximity. A unit test places two differently tagged wounds 0.25 m apart and
  asserts no strand or blob bridges them; another test mixes tagged and
  untagged nodes.
- **Game tagging.** `game-main.ts` tags each wound's per-frame droplets, its
  impact gout, each chunk trail and each gut rope with a stable id; the ids are
  allocated once (a `WeakMap` on the wound reference) and consume no RNG and
  change no physics. `Droplet.stream` is not read by `stepBlood`.
- **Strands.** Tapered, budgeted paths within one stream, oldest-first
  nearest-neighbour linking under the node, length, spacing and age budgets.
- **Sheets (experimental, default OFF).** A sheet is a sparse grid patch in a
  **stream-local frame**: hole/radius noise is hashed from
  `(stream id, col, row)`, never a world position, so translating the stream
  leaves the pattern unchanged and moving blood cannot make holes swim. The
  frame no longer uses the sorted world AABB (which flipped when extents
  crossed). A remaining-life fade thins the sheet instead of popping it.
  Whether a patch reads as a **sheet** rather than a thicker rope is exactly
  what the deferred visual pass must decide; it is labelled experimental and
  kept off in the game and page until then.
- **Scope honesty:** the unit tests prove the *builder* never connects
  different streams and that the game's tagging compiles; they do **not**
  prove the game scene looks right. That is a visual item.

## C. Comparison page and game opt-in

**Page:** `/sdf-blood-compare.html` → `blood-compare-main.ts`. One canvas, one
`BloodSim`, one sim frame per variant render:

- `Original`, `Original + connections`, `Smooth`, `Smooth + connections`.
- Single view, or a **full-size wipe**: each variant renders its own full
  800x600 target, then B wipes over A at an adjustable fraction. The sim never
  advances between variants.
- The production blood view runs alongside the goo layer with game visibility
  (mist + floor splats on, beads/ribbons off).

Controls: variant, wipe + A/B + position, scenario (`burst`, `jet`, `overlap`,
`landing`), seed + Replay, Play/Pause/Step, speed, strands/sheets toggles,
**goo/mist layer toggles**, obstacle fixture, background, **source grid**,
density scale. The page **starts paused**.

Diagnostics: `__bloodCompare.state()` returns seed, frame, scenario, playing,
speed, variant/wipe, layer toggles, reconstruction, connections, extra blob
count, droplet/splat counts, **source + density + output sizes**, camera and
backend.

**Game opt-in (baseline default):**

- `?goorecon=smooth` — continuous reconstruction + AA silhouette composite.
- `?gooconnections=1` — strands (sheets additionally need `?goosheets=1`).
- `?goosheets=1` — experimental sheets.
- Live: `__sdfGame.setGooCandidate({ reconstruction, connections, strands,
  sheets })`.

Applied *after* the shipping defaults; existing URLs are unchanged.

## Commands run and results

```
npx vitest run \
  src/lab/sdf-zombie/blood-sim.test.ts \
  src/lab/sdf-zombie/webgpu/fisheye.test.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/game-actor.test.ts \
  src/lab/sdf-zombie/webgpu/occluder-hull.test.ts \
  src/lab/sdf-zombie/webgpu/free-aim.test.ts \
  src/lab/sdf-zombie/webgpu/game-deferred-lights.test.ts \
  src/lab/sdf-zombie/webgpu/post-aa.test.ts \
  src/lab/sdf-zombie/entrails-gates.test.ts \
  src/lab/sdf-zombie/webgpu/goo-layer.test.ts \
  src/lab/sdf-zombie/webgpu/goo-presets.test.ts \
  src/lab/sdf-zombie/webgpu/blood-connections.test.ts \
  src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts \
  --maxWorkers=1 --minWorkers=1
# 13 files, 607 tests passed
```

Per-file additions/coverage of interest:

- `blood-sim.test.ts`: 41 passed (5 new stream-provenance tests; RNG call-count
  equality with and without a stream tag).
- `goo-layer.test.ts`: 114 passed (depth-discontinuity TS + WGSL, coverage
  footprint TS + WGSL, source/output diagnostics).
- `blood-connections.test.ts`: 21 passed (strict provenance incl. adjacent
  emitters and mixed tagged/untagged, translation invariance, widest-axis
  crossing, sheet life fade, sheets-off-by-default).
- `blood-compare-main.test.ts`: 17 passed, including a **mock** test pinning
  `renderVariantFrame`'s call order (`setReconstruction → setExtraBlobs →
  setOutputTarget → camera.updateMatrixWorld → sync → render`) with object
  identity for sim and camera.

Parse check (syntax only, no typecheck, no build), per edited file:

```
node_modules/.bin/esbuild <file> --format=esm --outfile=/dev/null
# all nine edited/created TS files parsed clean
```

## NOT RUN (training window)

- WebGPU shader compilation of the new WGSL (`gooSurfaceSmooth`,
  `gooCoverageSmooth`). **Not compiled, not run.** The WGSL is pinned by text
  assertions and its constants are matched to the TS mirrors, but a text test
  is not a compiler.
- Visual parity / appearance, texture swimming, silhouette quality, sheet read,
  depth-discontinuity behaviour at a real foreground/background silhouette.
- Same-scene game test at 800x600 with post effects and obstacle occlusion.
- Gameplay and performance; no benchmark.
- TypeScript typecheck (`tsc --noEmit`) and `vite build`: treated as disallowed
  heavy builds. `esbuild` parse only, so type errors are possible.

## Deferred acceptance checklist (owner / reviewer)

- [ ] Shader compile of the two new WGSL entry points.
- [ ] Baseline parity (`?` unparameterised vs pre-change). **Source-unchanged,
      not proven pixel-identical.**
- [ ] Smooth depth compositing against walls/bodies and the deferred/post chain
      (the candidate does not write goo depth).
- [ ] Two-layer silhouette: no phantom depth bridging separate blood masses.
- [ ] Coverage feather is one output pixel and does not change with the density
      slider.
- [ ] Wipe at equal output size and seed; same scene in-game.
- [ ] Connections: adjacent unrelated wounds stay separate **in the game scene**
      (unit tests only prove the builder; the game tagging is reviewed, not
      seen).
- [ ] Sheets: off by default; only judge after the visual read, then decide
      whether they earn a default.
- [ ] Quiet, separate full-frame benchmark (not in this dispatch).

Reviewer/user decides whether the candidate retains the liked appearance; no
automatic promotion.
