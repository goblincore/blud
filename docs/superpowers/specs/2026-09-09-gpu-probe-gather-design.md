# GPU probe gather — dynamic layer (lighting P3/P4, the paper's core)

**Owner direction (2026-09-09):** keep the CPU static bake; add a per-frame
GPU compute gather ONLY for the dynamic contributions. Order: muzzle-flash
afterglow injection first, then body occlusion.

## What it is

A second, DYNAMIC probe layer on the same grid as the static one, written by a
WebGPU compute pass every frame and read by the march next to the static
texels. Per probe it stores:

- **dynamic radiance**, L1 SH × RGB (12 floats, packed like the static texels)
  — the level lit by the dynamic lights (the muzzle flash; the flashlight beam
  later) with bodies as occluders;
- **visibility**, L1 SH (4 floats) — the fraction of the sphere NOT blocked by
  bodies, so a probe under a body darkens its neighbourhood.

The march composes `amb = amb * mix(1, vis(n), dynCfg.y) + dyn(n) * dynCfg.x`
after the static probe mix and the bounce spot; both gains at 0 skip the read
and keep the frame bit-identical.

## Gather (compute, one thread per probe)

Scene inputs, storage buffers rebuilt per frame on the CPU from data that
already exists:
- **boxes**: the player's room box (index 0, ray EXITS it) + that room's
  furniture (ray ENTERS them), with a paint albedo each;
- **capsules**: every posed bone the bone instancer already packs
  (`INSTANCE_FLOATS` rows → two capsules per bent bone, a–b and b–c, radius
  inflated by a flesh margin) — bodies are occluders, flesh-dark on hit;
- **lights**: point lights with an intensity envelope — the muzzle flash first.

Per ray (Fibonacci set rotated by a per-frame seed so the estimate does not
strobe): nearest hit among boxes and capsules. Capsule hit → visibility 0,
radiance 0. Box hit → visibility 1, radiance = albedo × Σ lights
`I·color·max(cos,0)/d²` shadowed by capsules and boxes. Project to L1; blend
with the previous frame's value by `cfg.w` for stability.

Storage layout `probeDyn`, 4 vec4 per probe: texels 0–2 = radiance (static
packing), texel 3 = visibility (V00, V1-1, V10, V11). Visibility is projected
with the same estimator as radiance and evaluated as `irradianceL1(V, n) / π`,
which is exactly 1 for an unoccluded probe.

## What stays out

Multi-bounce of the dynamic light (the flash is one bounce off the level),
the flashlight beam as a gathered light (the analytic spot already covers its
patch), and probe relocation. Rooms other than the player's get `dynCfg = 0`.

## Verification

Parity at both gains 0 (the bench/parity drivers pass `?probedyn=0`). GPU:
fire in a room corner with a body between the gun and the wall — the wall
glow lifts the body's shadow side for the flash's frames; a body standing
next to another darkens it slightly with visibility on.
