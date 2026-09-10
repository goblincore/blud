# GPU probe gather — dynamic layer

**Goal:** Per-frame compute gather of a dynamic probe layer (muzzle-flash
radiance + body visibility) read by the march next to the static grid. Spec:
`docs/superpowers/specs/2026-09-09-gpu-probe-gather-design.md`.
**Architecture:** House pattern: pure TS twin (`probe-dynamic.ts`) for the
kernel maths and the CPU-side packing, tested in vitest; the compute kernel and
the evaluator as WGSL strings (`webgpu/probe-dynamic.wgsl.ts`) pinned by
source-text and parse tests; a compute binding module modelled on
`tile-bin-compute.ts`; two march slots positionally last.
**Tech Stack:** TypeScript, vitest, WGSL, three.js WebGPU `compute()` + `storage()`.

### Task 1: probe-dynamic.ts + the kernel and evaluator WGSL + tests

**Files:**
- Create: `src/lab/sdf-zombie/probe-dynamic.ts`
- Create: `src/lab/sdf-zombie/probe-dynamic.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/probe-dynamic.wgsl.ts`
- Create: `src/lab/sdf-zombie/webgpu/probe-dynamic.wgsl.test.ts`

Read first: `src/lab/sdf-zombie/probe-grid.ts` (import `fibonacciSphere`,
`hitEnclosure`, `hitAabbEntry`, `projectL1`, `irradianceL1`, `probePosition`;
do not copy), `src/lab/sdf-zombie/webgpu/probe-grid.wgsl.ts` (the static
evaluator; the dynamic one mirrors its trilinear), `src/lab/sdf-zombie/webgpu/tile-bin-compute.ts`
lines 175–260 (how a compute kernel is written: `fn kX(... ptr<storage, array<vec4<f32>>, read_write> ..., gi: u32) -> void`
with `if (gi >= count) return;` first) and its test's "kernel sources" block,
`src/lab/sdf-zombie/webgpu/bone-instancer.ts` lines 24–60 (`INSTANCE_FLOATS`,
the a/b/c/r1/r2/scale layout the capsules are packed from).

**Buffer layouts (pin each with a test that packs and re-reads):**
- `boxes`: vec4 count `[n,0,0,0]`, then per box 3 vec4: `min.xyz, kind` (kind
  0 = enclosure, ray exits it; 1 = occluder, ray enters), `max.xyz, 0`,
  `albedo.rgb, 0`. Export `packBoxes(enclosure: Box, wallAlbedo: Vec3, occluders: {box: Box; albedo: Vec3}[], out: Float32Array): number`.
- `capsules`: vec4 count, then per capsule 2 vec4: `a.xyz, r`, `b.xyz, 0`.
  Export `packCapsulesFromBoneInstances(ab: Float32Array, count: number, margin: number, out: Float32Array, max: number): number`
  producing capsules a–b and b–c per instance with `r = max(r1, r2) * max(scale) + margin`.
- `lights`: vec4 count, then per light 2 vec4: `pos.xyz, intensity`, `color.rgb, 0`.
  Export `packLights(lights: {pos: Vec3; color: Vec3; intensity: number}[], out: Float32Array): number`.
- `probeDyn`: 4 vec4 per probe as the spec says. Export `DYN_VEC4_PER_PROBE = 4`.
- `cfg` vec4: `x probeCount, y raysPerProbe, z frameSeed (0..1, rotates the
  ray set), w blend (0..1, weight of the NEW estimate)`; `grid` two vec4s:
  `min.xyz, 0` and `invExtent.xyz, 0` plus `dims` vec4 — pass exactly what the
  static evaluator uses.

- [ ] **Ray–capsule.** Export `hitCapsule(origin, dir, a, b, r): { t, point, normal } | null`
  (nearest positive entry; standard quadratic against the swept sphere with
  the two sphere caps). Tests: hit a capsule head-on at the right t; miss a
  parallel offset ray; a ray starting inside returns the exit or null —
  choose null and document it (an occluder you are inside blocks nothing).
- [ ] **CPU gather twin.** Export `gatherProbeDynamic(probeIndex, grid: {dims, min, max}, scene: {boxes: Float32Array; capsules: Float32Array; lights: Float32Array}, cfg: {raysPerProbe, frameSeed}): { radiance: number[12]; visibility: number[4] }`
  implementing the spec's per-ray rule exactly, using `fibonacciSphere` with
  the seed folded into the ray rotation (rotate every direction about Y by
  `frameSeed * 2π`, documented). Tests: an empty room with one light — the
  wall facing the light is bright, visibility is exactly full (evaluate
  `irradianceL1(V, n)/π ≈ 1` for six normals within 2%); a capsule wrapping
  the probe from above halves visibility from the top and leaves the bottom
  ~1; a capsule between the light and the lit wall shadows that wall's
  radiance to ~0; no light → radiance 0 everywhere; all outputs finite.
- [ ] **Blend.** Export `blendDynamic(prev: Float32Array, next: Float32Array, blend: number, out: Float32Array)` (per-float lerp). Test: 0 keeps prev, 1 takes next.
- [ ] **Evaluator twin.** Export `sampleProbeDynamic(dyn: Float32Array, grid, p, n): { radiance: Vec3; visibility: number }`
  — trilinear over the 8 probes on the packed 4-vec4 layout (blend
  coefficients then evaluate; `visibility = clamp(irradianceL1(V, n)/π, 0, 1)`,
  radiance clamped ≥ 0). Test: at a probe position it returns that probe's own
  values; a fully-visible buffer returns visibility 1 everywhere.
- [ ] **WGSL kernel, `webgpu/probe-dynamic.wgsl.ts`.** Export
  `K_PROBE_GATHER` = a string whose FIRST declaration is
  `fn kProbeGather(boxes: ptr<storage, array<vec4<f32>>, read>, capsules: ptr<storage, array<vec4<f32>>, read>, lights: ptr<storage, array<vec4<f32>>, read>, probeDyn: ptr<storage, array<vec4<f32>>, read_write>, cfg: vec4<f32>, gridMin: vec4<f32>, gridInvExtent: vec4<f32>, gridDims: vec4<f32>, gi: u32) -> void`
  followed by helpers (`kdFibonacci(i, n, seed) -> vec3`, `kdHitBox`,
  `kdHitCapsule`, `kdShadowed`). Mirror the CPU twin line for line; the
  Fibonacci constants and the SH constants must be the same literals as the
  TS (export them and pin). The FIRST statement of the kernel is
  `if (gi >= u32(cfg.x)) { return; }`. Rays per probe is `u32(cfg.y)`, capped
  at 64 by a `min`. Loop over capsules and boxes with the counts read from
  element 0. NO textures, NO field evaluations.
- [ ] **WGSL evaluator.** Export `PROBE_DYNAMIC_WGSL` whose FIRST declaration is
  `fn probeDynamic(p: vec3<f32>, n: vec3<f32>, probeDyn: ptr<storage, array<vec4<f32>>, read>, probeMin: vec3<f32>, probeInvExtent: vec3<f32>, probeDims: vec4<f32>) -> vec4<f32>`
  returning `(radiance.rgb, visibility)`; trilinear exactly as
  `probeIrradiance` in probe-grid.wgsl.ts but reading the 4-vec4 storage
  layout. Helpers prefixed `probeDyn*`.
- [ ] **Tests, `webgpu/probe-dynamic.wgsl.test.ts`:** both strings start with
  `fn ` (the ^fn parse contract, as tile-bin-compute.test.ts does); the
  kernel's first statement is the count guard; `new WGSLNodeFunction(PROBE_DYNAMIC_WGSL)`
  parses with 6 inputs in order; the literal pins; neither string contains
  `mapBody`, `sdPrim`, `textureLoad`, `textureSample`.
- [ ] Run `npx vitest run src/lab/sdf-zombie/probe-dynamic src/lab/sdf-zombie/webgpu/probe-dynamic`
  and `npx tsc --noEmit -p .`; paste output.

### Task 2: compute binding + march slots + game wiring (interactive, GPU)

`webgpu/probe-gather-compute.ts` modelled on tile-bin-compute.ts: storage
attributes for boxes/capsules/lights/probeDyn at worst-case sizes, `wgslFn(K_PROBE_GATHER)`
+ `compute(call, MAX_PROBES, [64])`, `update(frame)` packing this frame's
scene and dispatching, `readback()` for tests, a read-only `probeDynNode`
for the march. March: two slots after `bounceSpotCfg` (`probeDyn` storage
read, `probeDynCfg` vec4); compose per the spec; pins to 95. Game: the
player's room's boxes, the bone instancer's `ab` array as capsules, the
muzzle flash as the light (world position of `flashLight`, intensity
`55 * flashEnvelope(flashAge)`, colour 0xffcf95); dispatch before the layer
render; bind to actors in the player's room; `__sdfGame.setProbeDynamic(radianceGain, visStrength)`,
`?probedyn=0`. Verify in real Chrome.
