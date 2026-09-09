# Static probe grid spike (lighting P3, step 1)

**Goal:** Replace the lab's flat fill with a directional ambient read from a
static irradiance probe grid, gathered ONCE on the CPU at room setup against
the enclosure's six walls only (no bodies, no dynamic lights). Behind a
`probeCfg.x` weight that is bit-identical to today at 0. Lab only.
**Architecture:** House pattern (see `ambient.ts` / `ambient.wgsl.ts`): the
maths lives twice — a pure TS module that vitest property-tests, and a WGSL
string pinned by source-text + parse-contract tests. The probe data rides a
RGBA32F DataTexture (3 texels per probe = L1 SH, 4 coeffs × RGB) and the
march evaluates it with a manual trilinear over the 8 surrounding probes.
Background: `Claude Notes/Research/2026-09-09-sdfddgi-vs-blud-lighting.md`
(SDFDDGI, arXiv 2007.14394) and the P1–P5 roadmap in
`docs/superpowers/specs/2026-08-24-environment-lighting-design.md`.
**Tech Stack:** TypeScript, vitest, WGSL (three.js WebGPU `wgslFn`).

### Task 1: probe-grid.ts — the pure gather, the SH evaluator, and the WGSL twin

**Files:**
- Create: `src/lab/sdf-zombie/probe-grid.ts`
- Create: `src/lab/sdf-zombie/probe-grid.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/probe-grid.wgsl.ts`
- Create: `src/lab/sdf-zombie/webgpu/probe-grid.wgsl.test.ts`

Read first: `src/lab/sdf-zombie/ambient.ts` (the model you extend: `Box`,
`EnclosureWalls`, `Vec3`, `luminance`), `src/lab/sdf-zombie/ambient.test.ts`
(test style), `src/lab/sdf-zombie/webgpu/ambient.wgsl.ts` and its test (how a
WGSL string is pinned), and `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
near its `WGSLNodeFunction` import (the parse-contract pattern).

**Light model, matching the lab exactly** (zombie-gpu.ts uniforms):
`lightDir` is a unit vector TOWARD a directional key light (default
(0.45, 0.72, 0.53) normalised), `keyColor` linear RGB, `lightCfg.x` =
keyIntensity (2.4), `lightCfg.y` = fillIntensity (0.06). The enclosure is an
axis-aligned box (default min (-2,0,-2), max (2,3.2,2)) with six linear-RGB
wall albedos; `posY` is the ceiling.

- [ ] **Types and grid layout.** Export
  `interface ProbeGridOptions { dims: [nx, ny, nz]; raysPerProbe: number; bounces: number; inset: number }`
  with defaults `dims [8,4,8]`, `raysPerProbe 128`, `bounces 2`, `inset 0.15`
  (metres — probes sit inside the box by this margin so none lies on a wall).
  Export `interface ProbeGrid { dims; min: Vec3; max: Vec3; sh: Float32Array }`
  where `sh.length === nx*ny*nz*12` and probe `(i,j,k)` is at index
  `i + nx*(j + ny*k)` (x fastest), storing `[L00.rgb, L1-1.rgb, L10.rgb, L11.rgb]`
  (12 floats). Export `probePosition(grid, i, j, k): Vec3` (linear in the
  inset box).
- [ ] **Directions.** Export `fibonacciSphere(n, seed): Vec3[]` — n unit
  directions, deterministic, roughly uniform. Test: mean direction ≈ 0 and
  every |d| = 1.
- [ ] **Ray vs enclosure interior.** Export
  `hitEnclosure(origin, dir, box): { t, wall: keyof EnclosureWalls, point, normal } | null`
  for an origin INSIDE the box: the nearest positive slab exit. The normal
  points INTO the room. Test all six walls from the centre, plus a diagonal.
- [ ] **Wall radiance.** Export
  `wallRadiance(wall, albedo, normal, light: { dir, keyColor, keyIntensity, fillIntensity }, bounce: Vec3): Vec3`
  = `albedo * (keyIntensity * keyColor * max(dot(normal, dir), 0) + fillIntensity * keyColor + bounce)`.
  No shadowing (a convex box cannot self-shadow a directional light). Test:
  a wall facing away from the light gets only fill + bounce.
- [ ] **SH projection and evaluation.** Export `projectL1(samples: {dir, radiance}[]): number[12]`
  using the standard real SH basis (Y00 = 0.282095, Y1-1 = 0.488603·y,
  Y10 = 0.488603·z, Y11 = 0.488603·x) with the 4π/N Monte-Carlo weight, and
  `irradianceL1(sh: ArrayLike<number>, offset: number, n: Vec3): Vec3` using
  the cosine-lobe convolution (A0 = π, A1 = 2π/3):
  `E = A0·Y00·L00 + A1·(Y1-1(n)·L1-1 + Y10(n)·L10 + Y11(n)·L11)`.
  Test: a uniform radiance sphere of value c gives irradiance ≈ π·c for every
  n (within 2%); a single bright direction gives an irradiance that peaks for
  n along it and is ~0 opposite it (clamp negatives to 0 in the evaluator).
- [ ] **Trilinear sample.** Export `sampleProbeGrid(grid, p, n): Vec3` — clamp
  p to the inset box, find the 8 surrounding probes, trilinear-blend their
  SH coefficients THEN evaluate irradiance (blend coefficients, not results).
  Test: at a probe position it equals that probe's own irradiance; midway
  between two probes it is their mean (for a grid where only those two are
  non-zero).
- [ ] **The gather.** Export
  `buildProbeGrid(box, walls, light, opts?): ProbeGrid`. For `bounces + 1`
  iterations: for every probe, for every direction, `hitEnclosure`, radiance
  = `wallRadiance(...)` with `bounce` = the PREVIOUS iteration's
  `sampleProbeGrid(prev, hitPoint, hitNormal)` (zero on the first iteration),
  project to L1. Deterministic (fixed direction set). Tests:
  - a neutral grey room (all walls 0.5) with fill only (keyIntensity 0):
    irradiance at the centre is the same for every n within 5%, and equals
    the analytic value for a closed grey box under fill f: with one bounce
    it is π·0.5·f·(1 + 0.5 + …) — assert monotone increase with `bounces`
    and convergence toward `π·0.5·f / (1 - 0.5)` within 10% at 4 bounces.
  - a red wall on -X: at a probe near it, irradiance for n = (-1,0,0) is
    redder (r/(g+b) larger) than for n = (+1,0,0).
  - every coefficient finite, every irradiance channel ≥ 0 across a sweep of
    positions and normals.
  - `dims [8,4,8]`, 128 rays, 2 bounces completes in under 500 ms
    (`performance.now()` around the call; assert < 500).
- [ ] **Packing.** Export `packProbeTexture(grid): { data: Float32Array; width: number; height: 1 }`
  where texel `t = probe*3 + c` holds `sh[probe*12 + c*4 .. +3]` as RGBA
  (i.e. the four coefficients of ONE colour channel? NO — keep colour
  together: texel c ∈ {0,1,2} holds coefficient c's... Use this layout and
  document it: texel 0 = (L00.r, L00.g, L00.b, L1-1.r), texel 1 =
  (L1-1.g, L1-1.b, L10.r, L10.g), texel 2 = (L10.b, L11.r, L11.g, L11.b)).
  Test: round-trip `unpack(pack(grid))` equals `grid.sh`.
- [ ] **WGSL twin, `webgpu/probe-grid.wgsl.ts`.** Export
  `PROBE_GRID_WGSL` = a string whose FIRST declaration is
  `fn probeIrradiance(p: vec3<f32>, n: vec3<f32>, probeTex: texture_2d<f32>, probeMin: vec3<f32>, probeInvExtent: vec3<f32>, probeDims: vec4<f32>) -> vec3<f32>`
  (probeDims = (nx, ny, nz, 0)), followed by a helper
  `fn probeLoadSh(probeTex, index: i32) -> array<vec4<f32>, 3>` (three
  `textureLoad(probeTex, vec2<i32>(index*3 + c, 0), 0)`) and
  `fn probeIrradianceL1(...)` mirroring `irradianceL1`. Manual trilinear over
  the 8 probes exactly as `sampleProbeGrid` (blend coefficients, then
  evaluate, clamp ≥ 0). Same constants as the TS (0.282095, 0.488603, π,
  2π/3) written as literals. Export the constants from the TS module and
  have the wgsl test assert each literal appears in the string (the
  ambient.wgsl.test.ts pattern). ZERO field evaluations: the string must not
  contain `mapBody`, `sdPrim` or `applyWounds` — assert that.
- [ ] **Parse contract, `webgpu/probe-grid.wgsl.test.ts`:**
  `new WGSLNodeFunction(PROBE_GRID_WGSL)` parses; pin `inputs.length === 6`
  and the ordered parameter names.
- [ ] Run `npx vitest run src/lab/sdf-zombie/probe-grid src/lab/sdf-zombie/webgpu/probe-grid`
  and `npx tsc --noEmit -p .`; paste output.

### Task 2: lab wiring (interactive session, needs a GPU)

**Files:** `webgpu/zombie-gpu.ts` (uniforms `probeCfg`, `probeMin`,
`probeInvExtent`, `probeDims`, texture node `probeTex`; march params),
`webgpu/march.wgsl.ts` (compose: `amb = mix(amb, probeIrradiance(...) * probeCfg.y, probeCfg.x)`
right after the `ambientAt` line, plus `PROBE_GRID_WGSL` in the helper chain),
`webgpu/lab-main.ts` (build the grid from the enclosure + light uniforms at
boot and on wall/light change; upload as a RGBA32F DataTexture; panel toggle
+ gain slider next to the bounce A/B), `march.wgsl.test.ts` (binding pin).
Verify on GPU: probeCfg.x = 0 bit-identical (parity capture), then A/B
screenshots at 1 with gain ~0.25.
