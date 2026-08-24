# Shell-March Spike — rasterised-hull bounded sphere tracing

**Date:** 2026-08-25 · **Branch:** `dispatch/shell-march-spike`
**Standalone page:** `sdf-shell-spike.html` + `src/lab/sdf-zombie/webgpu/shell-spike-main.ts`
**Reference (unchanged):** `sdf-lab-webgpu.html` + `src/lab/sdf-zombie/webgpu/lab-main.ts`

## Verdict

**The look survives: yes, at the geometry level.** Rendering the zombie via
rasterised inflated-hull depth + a bounded shell march reproduces the reference
silhouette, the smooth-min blends, and the gradient normals at **all 8 yaws**.
The wall-clock win is real but smaller than the marketing version for a single
hero, because a full march's sphere tracing already skips the empty space in
front of a lone body cheaply. The actual win is where cost is counted: the
shell marches **the body's real footprint** (~30k pixels) instead of the whole
proxy box (~285k pixels), which is a **~14x reduction in field evaluations
(mapBody calls)** per frame — the number that compounds for a crowd.

The trade is fidelity at **thin features**: the +3 cm hull inflation bridges
sub-3 cm detail, so the hands read as smooth mittens and the face is gone.
Shading is spike-grade (simplified lambert), so it is much flatter and paler
than the reference (no spec/fresnel/AO, no face projection, no per-prim paint
colours, no wounds/gore).

| Look property        | Result |
| -------------------- | ------ |
| Silhouette           | ✅ preserved (all 8 yaws) |
| Smooth-min blends    | ✅ preserved (same field) |
| Gradient normals     | ✅ preserved (same field) |
| Thin features (fingers, face) | ❌ lost (hull inflation) |
| Shading parity       | ⚠️ simplified, much paler |
| Holes / cracks at silhouette | ✅ none seen in the body |

## What this spike builds

1. **Standalone page** loads `zombie.blob`, builds the body with the **same**
   modules the lab uses (`parseBlob → compileBlob → buildBody`), and samples the
   CPU field `sdBody` (validate.ts) — the mirror of the GPU `mapBody`.
2. **Hull mesh on CPU** — marching **tetrahedra** (not cubes) over
   `sdBody(p) − 0.03` at ~72 cells/axis. Crossing vertices are memoised per
   lattice edge, so triangles share vertices and the mesh is watertight
   (verified: 0 boundary edges on a unit-sphere probe). Rendered **twice** into
   two Float targets: `FrontSide + depth-near` = *entry*, `BackSide +
   depth-far (GreaterDepth)` = *exit*. R channel = ray distance.
3. **Shell march** — a WGSL `shellTrace` that **imports** the field via the
   `HELPERS` chain from `march.wgsl.ts` (so the definition cannot drift), reads
   the per-pixel entry/exit, and sphere-traces `mapBody` only inside
   `[entry, exit]`, budget 16 steps. Writes the step count back so it can be
   read (`readRenderTargetPixelsAsync`).

## Numbers (measured, 1100×700, dev MacBook Apple GPU)

Stable across 3 runs; step counts are deterministic.

| Metric | Shell (bounded, 16) | Full march (96 budget) |
| ------ | ------------------- | ---------------------- |
| Avg steps over **surface** pixels | **3.30** (22,814 px) | 8.02 (22,847 px) |
| Avg steps over **traced** pixels | **4.56** (30,121 px) | 6.79 (285,296 px) |
| Max steps | 16 | 65 |
| Estimated `mapBody` evals/frame | **~137k** | ~1.94M (**~14x more**) |
| Frame time (steady) | **~16 ms** | ~29 ms |

- **Hull build:** 20,852 tris / 10,428 verts in **~0.5–0.6 s** (one-time at
  load; varies 0.42–1.04 s across runs).
- **Frame-time caveat:** WebGPU wall-clock frame time is noisy. The steady
  state (after warmup) is shell ~16 ms vs full ~29 ms; the first measurement
  after load includes pipeline-compile stalls (+~15 ms) and should not be
  quoted. The per-mode comparison is apples-to-apples (both run the same hull
  depth passes; only the march budget/interval differs).

## Per-angle visual notes (reference vs spike, judged by eye)

All 8 yaws of the reference (`/tmp/ref-turntable`) and the spike
(`/tmp/spike-turntable`) were read as side-by-side pairs. Framing differs
slightly (the spike renders the body a touch larger — the spike's fixed target
height vs the lab's `focusBody`); silhouettes were read accordingly.

| Yaw | Reference | Spike | Silhouette | Blends | Notes |
| --- | --------- | ----- | ---------- | ------ | ----- |
| 0° | dark red, face+eyes, fingers, coat | pale pink, faceless, mittens | ✅ match | ✅ | shading much flatter; surface-noise normal lumps read coarse |
| 45° | front three-quarter | same | ✅ match | ✅ | framing offset; no fan/neck gap artefact |
| 90° | profile | profile | ✅ match | ✅ | head/arm/leg outline matches |
| 135° | back three-quarter | same | ✅ match | ✅ | back bundle visible in both |
| 180° | back | back | ✅ match | ✅ | head/shoulders/arms/legs/back hump match |
| 225° | back three-quarter | same | ✅ match | ✅ | clean |
| 270° | profile (other side) | profile | ✅ match | ✅ | spike loses the coat (single-base-colour shading) |
| 315° | front three-quarter | same | ✅ match | ✅ | clean |

**Honest notes from the detail crops** (3x): the spike head is a smooth blob
with no face; the reference has eyes/mouth. The spike arms end in rounded
mitten stumps; the reference hands show finger separations — the **thin-feature
failure mode** (below).

## Failure modes hit

- **Thin features fall outside the shell (HIT).** The +3 cm inflation is larger
  than the gap between fingers, so the hull bridges over them and the shell
  silhouette becomes a mitten. Same story for the face — the face is painted on
  the skull via the march's face projection, which the simplified shader skips,
  so the head reads as a blob regardless. A smaller iso would preserve the
  notches at the cost of a thinner (riskier) shell; it should be swept, but the
  honest read is that **iso inflation is a hard lower bound on preserved
  feature size**.
- **Entry/exit depth precision.** ~24% of hull-footprint pixels (7,307 of
  30,121) did not converge to a surface within the 16-step shell budget — these
  are grazing silhouette edges and concave recesses where the `[entry, exit]`
  interval is a few-millimetre sliver. They resolve to background (the trace
  exits without a hit), which thins the silhouette a little at grazing angles.
  Reducing the hit epsilon / raising the budget buys these back at cost.
- **Silhouette mismatch from coarse hull + under/over-inflation.** The marching
  tetra hull is ~2.8 cm cells, so fine detail is already absent from the hull
  outline; a pixel-exact outline would need a finer grid (and the per-frame cost
  that comes with it).
- **No shell-borne holes** were seen in the main body at any yaw; the
  watertight hull and the shared-field trace are consistent.

## What productionising would need

- **Posed hulls via per-part meshes.** The current hull is a single
  world-space mesh built from the rest pose. A rigged/animated body needs a
  hull **per limb part** that follows the skeleton (re-mesh or rigidly move
  cluster hulls), so the entry/exit stay tight as the character moves. This is
  the biggest missing piece for the hero/animated path.
- **Wound re-carving inside the shell.** The shell traces the primitive field,
  which already carries carves, but the hull is built from the **uncarved**
  field — so a crater deep enough could fall outside the rastersised shell and
  the shell would sample a field the hull doesn't bound. Rebuild the hull (or
  carve its bounds locally) after a wound lands.
- **Crowd path.** The real win is crowd cost: the shell limits each body's march
  to its own silhouette instead of its proxy box. The hull depth passes are a
  per-body add, so measure hull+raster vs the march saving across N bodies
  before committing.
- **Shading parity.** The spike uses a plain lambert. To judge "the look"
  properly the shell trace needs the march's spec/fresnel/translucency/AO,
  the face projection, and per-prim paint colours — all of which are reachable
  since the field and normals are already shared.
- **Hull build time / resolution.** 20.8k tris at ~0.5 s is fine once, not per
  frame. For animated hulls, lower the resolution (fewer cells) and/or build
  per-part; keep the watertight-memoised-tet approach.

## Files

**New (standalone; nothing existing was modified):**
- `sdf-shell-spike.html`
- `src/lab/sdf-zombie/webgpu/shell-spike-main.ts`
- `src/lab/sdf-zombie/webgpu/shell-spike.wgsl.ts`
- `src/lab/sdf-zombie/webgpu/shell-hull.ts` (+ `shell-hull.test.ts`)
- `scripts/shell-turntable.mjs`

**Run:** `npx vite --port 5325 --config .vite-shell.config.ts`, then open
`/sdf-shell-spike.html`. Capture with
`node scripts/shell-turntable.mjs 5325 /tmp/spike-turntable 8 9223`.
`window.__shellSpike.measure(1100, 700)` returns the step/frame-time numbers.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run src/lab` — **77 files / 1510 tests pass** (1508 existing +
  2 new hull tests).
- Reference lab and existing march files untouched.
