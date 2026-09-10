# Level surfaces reading the probes — forward path (lighting P3/P4, step 3)

**Status:** planned 2026-09-09 for the next session. Owner direction: keep the
FORWARD renderer (the deferred look is not wanted yet); walls and floor must
read the same probe grids and dynamic layer the bodies read.

**Goal:** The level's `MeshStandardMaterial` walls, floor and ceiling take
their indirect diffuse from the room's static probe grid plus the dynamic
layer (muzzle-flash afterglow, body visibility), through a custom TSL
lighting node, behind `?levelprobes=0` (bit-identical off). Result: the flash
glows off the walls and floor around a shooter; bodies darken the floor under
them; the beam patch warms adjacent walls.

**Architecture:** Three's forward node materials compose indirect diffuse from
`builder.context.irradiance`, which `HemisphereLightNode` (three/src/nodes/lighting/HemisphereLightNode.js:79-81)
writes with `addAssign`. A `ProbeLightingNode extends LightingNode` does the
same with the probe irradiance, evaluated by the SAME WGSL the march uses
(`probeIrradiance` in probe-grid.wgsl.ts, `probeDynamic` in probe-dynamic.wgsl.ts)
via `wgslFn` on `positionWorld`/`normalWorld`. It binds the same probe
texture and the same dynamic storage node the bodies bind, so walls and
flesh cannot disagree. `material.lightsNode = lights([...sceneLights, probeNode])`
(NodeMaterial.js:97; `lights()` from three/tsl) — setting `lightsNode`
REPLACES the scene's light list for that material, so the real lights must be
re-listed.
**Tech Stack:** TypeScript, vitest, TSL/WGSL, three.js WebGPU.

## Facts pinned for the implementer (all verified 2026-09-09)

- Level meshes: `game-main.ts` ~L292-336 — `levelSurfaces()` planes/boxes,
  `dungeonMaterialSet()` → `stoneFor(axis, facing)`, each mesh gets
  `base.clone()` (a MeshStandardMaterial per surface). Room membership of a
  surface: its `mid` (computed there) → `enclosureKeyAt(mid.x, mid.z)`.
- Ambient today: `new THREE.HemisphereLight(0xa39c93, 0x8f8880, 0.8)` at
  game-main.ts ~L348, applied "ONLY [to] these MeshStandardMaterials" (the
  comment there). This is what the probe ambient replaces; it must come down
  as the probe weight goes up or walls double-light.
- Real lights on walls: the per-room accent PointLights (flicker) and the
  flashlight SpotLight + its level-only shadow twin. These must stay in the
  `lights([...])` list.
- Probe data: static grid per room from `roomProbes.gridOf(roomId)` /
  the DataTexture the bodies get (room-probes.ts `stamp()` shows the five
  uniforms: probeTex, probeMin, probeInvExtent, probeDims, probeCfg);
  dynamic layer: `probeGather.probeDynNode` (read-only storage node) + the
  `probeDynCfg` semantics (x radiance gain, y visibility strength); the
  gather serves ONE room per frame (the player's or nearest) — walls of
  other rooms get dynamic weight 0, exactly like bodies.
- Evaluators: `PROBE_GRID_WGSL` (`fn probeIrradiance(p, n, probeTex, probeMin, probeInvExtent, probeDims) -> vec3`)
  and `PROBE_DYNAMIC_WGSL` (`fn probeDynamic(p, n, probeDyn, probeMin, probeInvExtent, probeDims) -> vec4` = radiance.rgb, visibility).
  Both are storage/texture reads only; no field evaluations.
- Level match: the bodies' matched gain (`matchedGain`, room-probes.ts) puts
  the probe irradiance at 4× the flat fill's luminance. For walls the target
  is the hemisphere light's contribution: choose the wall gain so the
  room-centre probe irradiance ≈ hemi (0.8 × mix of sky/ground) so nothing
  gets brighter when the seam flips — same rule as P3 step 2.

## Tasks

### Task 1: `webgpu/probe-lighting-node.ts` + tests (dispatchable, pure)

- [ ] Export `class ProbeLightingNode extends LightingNode` (import from
  `three/webgpu` — check the export name in this three version; fall back to
  `three/src/nodes/lighting/LightingNode.js`). Constructor takes the five
  static probe nodes (texture + 3 uniforms + cfg), the dynamic storage node +
  cfg uniform, and a `gain` uniform. `setup(builder)`: build
  `wgslFn(PROBE_GRID_WGSL)(positionWorld, normalWorld, ...)` and
  `wgslFn(PROBE_DYNAMIC_WGSL)(...)`, compose
  `E = (static * cfg.x * gain) * mix(1, dyn.w, dynCfg.y) + dyn.xyz * dynCfg.x`,
  then `builder.context.irradiance.addAssign(E)`. Gate: when `gain == 0`
  and `dynCfg == 0` add nothing (the node is still in the list; the WGSL
  branch is skipped like the march's).
- [ ] Export `levelLightsNode(sceneLights: Light[], probe: ProbeLightingNode)`
  returning `lights([...sceneLights, probe])`.
- [ ] Tests: the node's WGSL snippets are the SAME strings the march uses
  (import equality), a parse contract on any new WGSL, and a builder-free
  unit test that `levelLightsNode` lists the scene lights first and the
  probe node last (LightsNode `_lights` order).

### Task 2: game wiring (interactive, GPU)

- [ ] In the level-mesh loop (~L312), per surface: `enclosureKeyAt(mid)` →
  room id; create ONE `ProbeLightingNode` per room sharing that room's
  static probe uniforms (build them once per room from `roomProbes` — the
  grids arrive async; bind on `onReady` like `room-probes.ts` `stamp()`),
  and the shared `probeGather.probeDynNode`; set
  `mesh.material.lightsNode = levelLightsNode([hemi, ...accents, flashlight.spot], probeNode)`.
  Tunnel surfaces: nearest room by centre (same rule as `dynRoom`).
- [ ] Per frame, in the block that stamps bodies' `probeDynCfg`: set each
  room node's dynamic cfg to the body values when that room is `dynRoom`,
  else 0. Hemisphere: `hemi.intensity = 0.8 * (1 - levelProbeWeight)`.
- [ ] Seams: `__sdfGame.setLevelProbes(weight, gain)`, `?levelprobes=0`.
  Default ON at matched level.
- [ ] Verify (real Chrome, `__sdfGame.step` — hidden tabs stop rAF): parity
  at 0; A/B screenshots: fire next to a wall (afterglow on the wall), a body
  standing on the floor with visibility 1 (darker floor under it), room 1
  red / room 2 green casts on floor and ceiling. Frame time before/after
  (HUD ms with the loop running in a VISIBLE tab).

### Risks

- `material.lightsNode` replaces the scene light list — forgetting the
  flashlight or the shadow twin darkens the level silently. Test the list.
- Level materials are clones per surface: one node instance per ROOM shared
  across its surfaces keeps uniform updates O(rooms), not O(surfaces).
- The hemisphere is also what lights the gun and hands (check game-main
  ~L2521 "per-material env"); only the LEVEL materials get the probe node.
- Cost: ~24 texture loads + 32 buffer loads per level pixel; measure.
