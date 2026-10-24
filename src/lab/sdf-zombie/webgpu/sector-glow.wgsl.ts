// src/lab/sdf-zombie/webgpu/sector-glow.wgsl.ts
//
// GLOWING HAZARD FLOORS (spec 2026-10-24 §8): nukage, lava and acid as a self-lit, slowly flowing
// surface in world space (so a pool split across sectors flows as one). Two octaves of value noise
// drifting against each other give the slime; a brighter vein band and a dark crust keep it from
// reading as flat colour. `kind`: 0 nukage, 1 lava, 2 acid. Returns linear RGB (unlit; it is the
// light source — the pool's list-tier light lights everything else).

export const SECTOR_GLOW_HASH = /* wgsl */ `fn sgHash(p: vec2<f32>) -> f32 {
  let q = fract(p * vec2<f32>(123.34, 456.21));
  let r = q + dot(q, q + 45.32);
  return fract(r.x * r.y);
}`;

export const SECTOR_GLOW_NOISE = /* wgsl */ `fn sgNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = sgHash(i);
  let b = sgHash(i + vec2<f32>(1.0, 0.0));
  let c = sgHash(i + vec2<f32>(0.0, 1.0));
  let d = sgHash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`;

export const SECTOR_GLOW = /* wgsl */ `fn sectorGlow(wpos: vec3<f32>, t: f32, kind: f32) -> vec3<f32> {
  let p = wpos.xz * 0.55;
  let n1 = sgNoise(p + vec2<f32>(t * 0.11, t * 0.07));
  let n2 = sgNoise(p * 2.3 - vec2<f32>(t * 0.17, -t * 0.05));
  let n = n1 * 0.65 + n2 * 0.35;
  let vein = smoothstep(0.62, 0.78, n) - smoothstep(0.78, 0.95, n);
  let crust = smoothstep(0.30, 0.12, n);
  var base = vec3<f32>(0.10, 0.85, 0.18);
  var hot = vec3<f32>(0.75, 1.00, 0.45);
  if (kind > 0.5 && kind < 1.5) { base = vec3<f32>(0.95, 0.30, 0.05); hot = vec3<f32>(1.00, 0.80, 0.35); }
  if (kind > 1.5) { base = vec3<f32>(0.55, 0.85, 0.10); hot = vec3<f32>(0.95, 1.00, 0.55); }
  let pulse = 0.9 + 0.1 * sin(t * 1.3 + n * 6.0);
  return (base * (0.55 + 0.45 * n) + hot * vein * 0.9) * (1.0 - crust * 0.6) * pulse;
}`;

export const GLOW_KIND_INDEX = { nukage: 0, lava: 1, acid: 2 } as const;
