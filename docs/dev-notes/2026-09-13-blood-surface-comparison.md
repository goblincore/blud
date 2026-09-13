# Blood surface quality and comparison — 2026-09-13

**Status: implementation complete on CPU tests; VISUAL ACCEPTANCE PENDING.**
This dispatch ran inside a training window, so **no GPU work, no browser, no
captures, no builds, no benchmarks** were performed. Nothing below claims a
shader compile, visual parity, gameplay or performance result. The owner
decides after training whether the candidate keeps the liked appearance; there
is **no automatic promotion**.

## Goal

Keep the preferred dynamic, small, stretched, glossy blood, remove the
block-shaped reconstruction, and add *optional* cohesive tapered strands and
occasional ragged sheets — all behind an honest, synchronized comparison page
and off by default in the shipping game. Shutter blur is explicitly deferred.

## Files

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/goo-layer.ts` | Opt-in smooth reconstruction (WGSL + materials + branch), extra connection-blob channel, density-resolution diagnostics, pure interpolation/coverage math |
| `src/lab/sdf-zombie/webgpu/goo-layer.test.ts` | 31 new tests (pure math + WGSL/source tripwires) |
| `src/lab/sdf-zombie/webgpu/blood-connections.ts` | **New.** Deterministic, budgeted tapered strands + sparse ragged sheets as density-blob placements |
| `src/lab/sdf-zombie/webgpu/blood-connections.test.ts` | **New.** 16 tests |
| `src/lab/sdf-zombie/webgpu/goo-presets.ts` | **New.** The game's goo defaults, importable without booting the game |
| `src/lab/sdf-zombie/webgpu/goo-presets.test.ts` | **New.** Drift gate against `game-main.ts` |
| `src/lab/sdf-zombie/webgpu/blood-compare-main.ts` | **New.** The comparison page |
| `src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts` | **New.** 11 source/import tripwires |
| `sdf-blood-compare.html` | **New.** Page shell |
| `vite.config.ts` | Registers the page as a build entry (`sdfBloodCompare`) |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Opt-in candidate wiring + diagnostics only; **shipping defaults unchanged** |

`blood-sim.ts` was **not modified**. No new RNG is consumed anywhere in the
shipped simulation path.

## A. Smooth reconstruction (candidate, default original)

`GooLayer.setReconstruction('original' | 'smooth')`, default `'original'`. The
original surface pass, its uniforms, its material table and the whole density
and blur pass chain are untouched; the candidate is a **parallel** material
table and a branch after `between()`. With no flag, the frame is the pre-change
frame.

What the candidate changes:

1. **Continuous field reconstruction before thresholding.** The baseline floors
   the texture coordinate and reads one nearest texel. The candidate bilinearly
   fetches the field at the continuous texel-centre coordinate (five fetches:
   centre plus four neighbours, all `textureLoad`, no sampler). `.r` density,
   `.g` density·viewDepth and `.b` gut-weighted density take the *same* weights,
   so `g/r` is a density-weighted mean depth and `b/r` a density-weighted gut
   share. Nothing is interpolated across the empty background: density rides in
   every denominator, so an empty neighbour contributes zero weight to it. The
   pure mirror is `sampleGooField()` (tested).
2. **Antialiased silhouette coverage from the field gradient.** The per-texel
   gradient magnitude (central difference of the bilinear samples) turns the
   signed density distance `(dens − thresh) / |grad|` into *texels*; a one-texel
   ramp around the isocontour becomes the blend alpha. A flat field degenerates
   to a hard 0/1 so no full-frame translucent sheet can appear. Pure mirror:
   `silhouetteCoverage()` (tested).
3. **Normal audit.** The gradient normal now comes from the smooth field, and
   the depth-derived surface normal rejects a neighbour below a quarter of the
   threshold (`GOO_NEIGHBOR_MIN_FRACTION`) — the baseline's `1e-4` empty test is
   meaningless on an interpolated field, where a silhouette neighbour's depth is
   a ratio of two small numbers. The min-difference fallback and the NaN
   fallback are kept. The baseline gradient/surface normal pair remains
   separately selectable via `setSurfaceNormals`/`normalMode` for A/B.
4. **Alpha/depth strategy (the one architectural change, candidate-only).**
   - Overlay: unchanged contract (no depth test/write), alpha = coverage.
   - Depth: alpha = coverage, `depthTest` **on** (walls and bodies still
     occlude it), `depthWrite` **off**. A partially covered fringe must not
     stamp a depth that would reject the opaque scene behind it. The cost is
     that the candidate does not write goo depth into the canvas depth buffer;
     nothing renders after the goo composite in this pipeline, but the
     deferred/post chain is **unverified** and must be part of acceptance.
   - The candidate is **not combined** with `setSurfaceAtDensityRes` (a perf
     seam): the low target's single alpha slot already carries depth in depth
     mode, and silently sharing it would be a wrong frame. Smooth always
     composites at full output resolution;
     `densityDiagnostics.smoothForcesFullResComposite` reports it.

Material/emission values are unchanged: the candidate copies the baseline
shading body verbatim (base colour, Beer-Lambert vector, spec/gloss/rim
aliases, shadow floor, legacy gamma). `blurPx` is not touched.

**Density-resolution diagnostic** independent of output size:
`GooLayer.densityDiagnostics` = density target W/H, SDF (output) W/H,
`densityScale`, and density texels per output pixel X/Y.

## B. Optional connected blood (default off)

`blood-connections.ts` derives **extra density quads** from the droplet array
the sim already owns. No particles are pushed into `BloodSim`, no RNG is drawn,
and the input array is never mutated. Feeding them through the density
instancer is what gives them the existing wet goo shading — there is no second,
flat ribbon material, and the whole particle population is not doubled.

- **Streams.** An explicit `stream` tag on a droplet is authoritative: two
  differently tagged emitters never connect. Untagged emitters fall back to a
  deterministic union of nodes that are within `maxLinkDist` **and** within
  `maxAgeDelta` — the two-wounds case stays apart. Union-found groups are
  iterated in a deterministic order.
- **Strands.** Oldest-first nearest-neighbour path within one stream, with a
  node budget (`maxStrandNodes`), a world length budget (`maxStrandLength`), a
  minimum length (degeneracy), and a radius envelope that tapers toward the
  newest end. Blobs are spaced by local radius.
- **Sheets.** Sparse grid patches over one stream's bounding box (two widest
  axes), with an attachment gate (a cell must have a node nearby, so no floating
  sail), seeded holes (`hash01`) and smooth value-noise radius modulation
  (`valueNoise3`) for ragged break-up. Collinear/too-small patches are rejected.
- **Budgets.** `maxStrands`, `maxStrandBlobs`, `maxTotalBlobs`,
  `maxSheetPatches`, `maxSheetBlobs`, `maxNodeAge` and a live/remaining-life
  test; `budgetClamped`/`degenerateRejected`/`nodesRejected` are reported.
- **Toggles.** `enableStrands` and `enableSheets` are independent in the builder
  and in the page UI / `__sdfGame.setGooCandidate`.

**Known limitation, stated plainly:** `blood-sim.ts` was left untouched, so the
game's wound/trail emitters do **not** stamp stable stream ids. In game the
streams are derived by proximity + age, which merges two *adjacent* wounds of
one body into one stream (visually defensible — one wound area) but could in
principle bridge two unrelated wounds that are close in space and age. Explicit
tags are supported by the builder and are used by the comparison page (one tag
per emitter), but wiring wound ids into the game emitters is left for the owner
to judge after seeing the result. Sheets are a genuine density-field patch, but
whether they *read* as sheets rather than a thicker rope is exactly what the
deferred visual pass has to decide; they are labelled experimental.

## C. Comparison page and game opt-in

**Page:** `/sdf-blood-compare.html` → `blood-compare-main.ts`. One canvas,
one `BloodSim`, one sim frame per render. Variants are re-renders of that same
frame:

- `Original`, `Original + connections`, `Smooth`, `Smooth + connections`.
- Single view, or **split A/B**: each variant renders into its own offscreen
  target and both are blitted side by side with a scissor — the sim does not
  advance between them.

Controls: variant, split + A/B, scenario (`burst`, `jet`, `overlap`,
`landing`), seed + Replay, Play/Pause/Step, speed, strands/sheets toggles,
obstacle occlusion fixture, dark/neutral background, density-scale slider. The
page **starts paused** and only calls `setLoopRunning(false)` after one present;
the loop restarts only from the two explicit Play paths. Orbit is drag + wheel.

Production functions are reused: `createGooLayer`, `createBloodSim`, `burst`,
`spawnWoundDroplets`, `spawnImpactGout`, `stepBlood`, `connectionBlobsForSim`,
and the game defaults via `applyGameGooDefaults` (`goo-presets.ts`). Only the
scene is a fixture (grey-box floor, body proxy, obstacle).

Diagnostics: `__bloodCompare.state()` returns seed, frame, scenario, playing,
speed, variant, split, strands/sheets, reconstruction, connections, extra blob
count, droplet/splat counts, density target + output size, camera and backend.
`screenshot instructions` are in the UI hint and
`__bloodCompare.captureInstructions()`.

**Game opt-in (baseline default):**

- `?goorecon=smooth` — continuous reconstruction + AA silhouette composite.
- `?gooconnections=1` — strands + sheets derived from the same sim.
- Live: `__sdfGame.setGooCandidate({ reconstruction, connections, strands,
  sheets })`; `__sdfGame.goo.candidate` reports the active state and density
  diagnostics.

Applied *after* the shipping defaults, so a flag can only opt in. Existing URLs
and the training renderer contracts are unchanged.

## Commands run and results

```
npx vitest run \
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
# 12 files, 546 tests passed
```

- `goo-layer.test.ts`: 105 passed (31 new).
- `blood-connections.test.ts`: 16 passed.
- `goo-presets.test.ts`: 4 passed (safe on the game-main source scan).
- `blood-compare-main.test.ts`: 11 passed (includes a module-import smoke test
  that proves the page's top-level syntax and imports resolve without a GPU).

Parse check (syntax only, no typecheck, no build), per edited file:

```
node_modules/.bin/esbuild <file> --format=esm --outfile=/dev/null
# all five edited/created TS files parsed clean
```

## NOT RUN (training window)

- WebGPU shader compilation of the new WGSL (`gooSurfaceSmooth`,
  `gooCoverageSmooth`). **Not compiled, not run.**
- Visual parity / appearance, texture swimming, silhouette quality, sheet read.
- Same-scene game test, 800x600 with post effects, obstacle occlusion in-game.
- Gameplay and performance; no benchmark.
- TypeScript typecheck (`tsc --noEmit`) and `vite build` were treated as
  disallowed heavy builds. `esbuild` parse only.

## Depth / alpha risks a reviewer must check

1. Smooth **depth** mode blends coverage and does not depth-write. If any pass
   after the goo composite reads canvas depth, the candidate's fringe (and the
   whole mass) will not appear in it. The deferred/post chain is the place to
   look first.
2. Coverage alpha is derived from the density gradient. A very steep gradient
   away from the true silhouette could produce a narrow or slightly clipped
   edge; a very flat field falls back to a hard edge by construction.
3. The extra connection blobs share the density instancer's cap with droplets
   and splats and are posed last, so at peak droplet load connections are
   dropped before the sim's own particles. The page reports `extraBlobs`.
4. `sampleGooField`'s TS mirror assumes the field's `.g` is density·depth and
   `.b` is gut-weighted density. The WGSL and the mirror must move together.

## Deferred acceptance checklist (owner / reviewer)

- [ ] Baseline image parity (`?` unparameterised vs pre-change) — the default
      branch must be pixel-identical.
- [ ] Shader compile of the two new WGSL entry points.
- [ ] Isolated mist/goo attribution (mist still visible, beads/ribbons still
      suppressed while goo is on).
- [ ] Same-frame comparison at equal resolution and equal seed from the
      comparison page.
- [ ] Stationary and moving cameras.
- [ ] Against body and against the obstacle fixture (occlusion respected).
- [ ] No texture swimming.
- [ ] Same game scene at 800x600 with the real post effects.
- [ ] Quiet, separate full-frame benchmark (not in this dispatch).

Reviewer/user decides whether the candidate retains the liked appearance; no
automatic promotion.
