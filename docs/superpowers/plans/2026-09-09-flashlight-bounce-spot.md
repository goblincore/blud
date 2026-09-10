# Flashlight bounce spot (lighting P4, step 1)

**Goal:** The flashlight is the game's dominant light and bounces nothing. Add
ONE dynamic bounce light per frame: the beam's lit patch on the level, found
on the CPU, added to the march's ambient as an analytic disc light. Behind
`bounceSpotCfg.x` (0 = bit-identical). A zombie's back gets lit by the wall
glowing behind it.
**Architecture:** House pattern. A pure module `src/lab/sdf-zombie/flashlight-bounce.ts`
(no three) computes the spot from the beam's own falloff math (mirrored from
MARCH_BODY_LIGHT) and evaluates the disc irradiance; a WGSL twin string is
pinned by source-text + parse tests; four uniform slots ride the march
positionally last; game-main computes the spot in the per-frame flashlight
block and copies it to every actor.
**Tech Stack:** TypeScript, vitest, WGSL.

### Task 1: flashlight-bounce.ts + WGSL twin + tests

**Files:**
- Create: `src/lab/sdf-zombie/flashlight-bounce.ts`
- Create: `src/lab/sdf-zombie/flashlight-bounce.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/flashlight-bounce.wgsl.ts`
- Create: `src/lab/sdf-zombie/webgpu/flashlight-bounce.wgsl.test.ts`

Read first: `src/lab/sdf-zombie/probe-grid.ts` (reuse `hitEnclosure` and
`hitAabbEntry` — import them, do not copy), `src/lab/sdf-zombie/ambient.ts`
(`Box`, `EnclosureWalls`, `Vec3`), `webgpu/probe-grid.wgsl.ts` and its test
(how a WGSL string is pinned and parse-tested), and this beam math from
`webgpu/march.wgsl.ts` which the spot MUST mirror (paraphrased; read the real
lines around `if (spotCfg.x > 0.0)` in MARCH_BODY_LIGHT):

```
dist     = |spotPos - p|
cone     = dot(-Ls, axis)                       // 1 on the beam axis
coneFall = clamp((cone - cosOuter) / (cosInner - cosOuter), 0, 1)
distFall = clamp(1 - dist / range, 0, 1)
beam     = coneFall^2 * distFall^2 * intensity
keyI     = ... + beam * keyGain                  // keyGain = spotCfg2.x
```

- [ ] **Types.** Export
  `interface BeamParams { pos: Vec3; axis: Vec3; intensity: number; cosInner: number; cosOuter: number; range: number; keyGain: number; color: Vec3 }`
  and `interface BounceSpot { pos: Vec3; normal: Vec3; radiance: Vec3; radius: number }`.
- [ ] **Finding the spot.** Export
  `computeBounceSpot(beam: BeamParams, box: Box, walls: EnclosureWalls, occluders: readonly Box[]): BounceSpot | null`.
  Cast the beam AXIS from `beam.pos` (assume pos is inside `box`; if not,
  return null): the hit is the nearest of `hitEnclosure` and every occluder's
  `hitAabbEntry`. The patch albedo is the hit wall's colour from `walls`, or
  `[0.35, 0.33, 0.30]` for an occluder. On the axis `coneFall = 1`, so the
  beam irradiance there is
  `E = distFall^2 * intensity * keyGain * color * max(dot(normal, -axis), 0)`
  and the patch RADIANCE is `albedo * E / pi` (Lambertian). The patch radius
  is `dist * tan(acos(cosOuter))`, clamped to `[0.1, 3.0]`. Return null when
  `intensity <= 0` or `distFall <= 0`. Tests: a beam straight down the -Z
  axis from the room centre hits the -Z wall at its centre with normal
  (0,0,1); a crate in the way is hit first with the crate albedo; radiance
  scales with intensity and keyGain and goes to zero at range; a beam
  grazing a wall (cos ~0) gives ~zero radiance.
- [ ] **Disc irradiance.** Export `bounceSpotIrradiance(p: Vec3, n: Vec3, spot: BounceSpot): Vec3`:
  `l = normalize(spot.pos - p)`, `d = |spot.pos - p|`,
  `E = spot.radiance * pi * r^2 * max(dot(n, l), 0) * max(dot(spot.normal, -l), 0) / (d^2 + r^2)`.
  Tests: a point directly in front of the disc at distance d, facing it,
  gets `L * pi * r^2 / (d^2 + r^2)` per channel (within 1e-9); a point
  behind the disc gets zero; a point facing away gets zero; E is finite and
  non-negative for p == spot.pos; E falls monotonically with d.
- [ ] **WGSL twin, `webgpu/flashlight-bounce.wgsl.ts`.** Export
  `FLASHLIGHT_BOUNCE_WGSL` whose FIRST declaration is
  `fn bounceSpotIrradiance(p: vec3<f32>, n: vec3<f32>, spotPosW: vec3<f32>, spotNormalW: vec3<f32>, spotRadiance: vec3<f32>, spotCfg: vec4<f32>) -> vec3<f32>`
  where `spotCfg.x` is the gain (return `vec3(0)` immediately when `<= 0`)
  and `spotCfg.y` the radius. Mirror `bounceSpotIrradiance` exactly and
  multiply by `spotCfg.x`. Use `3.141592653589793` as the literal for pi and
  export `BOUNCE_PI_LITERAL` from the TS so the test can pin it appears in
  the string. No field evaluations: assert the string contains none of
  `mapBody`, `sdPrim`, `applyWounds`, `textureLoad`, `textureSample`.
- [ ] **Parse contract, `webgpu/flashlight-bounce.wgsl.test.ts`:**
  `new WGSLNodeFunction(FLASHLIGHT_BOUNCE_WGSL)` parses; pin `inputs.length === 6`
  and the ordered names.
- [ ] Run `npx vitest run src/lab/sdf-zombie/flashlight-bounce src/lab/sdf-zombie/webgpu/flashlight-bounce`
  and `npx tsc --noEmit -p .`; paste output.

### Task 2: march + game wiring (interactive session, GPU)

Four slots appended positionally last after `probeCfg` in MARCH_BODY_PARAMS
and createMarchMaterial (`bounceSpotPos`, `bounceSpotNormal`,
`bounceSpotRadiance`, `bounceSpotCfg`); both parse pins to 93. Compose right
after the probe mix: `amb = amb + bounceSpotIrradiance(p, n, ...)` (the gain
gate is inside the function, so 0 is bit-identical). In game-main's
per-frame flashlight block, `computeBounceSpot` with the player's room box,
PAINT walls, that room's furniture; copy to every actor; `__sdfGame.setBounceSpot(gain)`,
`?bouncespot=0`. Verify in real Chrome facing a wall with a body between.
