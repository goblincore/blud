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
  let crust = 1.0 - smoothstep(0.12, 0.30, n);
  var base = vec3<f32>(0.10, 0.85, 0.18);
  var hot = vec3<f32>(0.75, 1.00, 0.45);
  if (kind > 0.5 && kind < 1.5) { base = vec3<f32>(0.95, 0.30, 0.05); hot = vec3<f32>(1.00, 0.80, 0.35); }
  if (kind > 1.5) { base = vec3<f32>(0.55, 0.85, 0.10); hot = vec3<f32>(0.95, 1.00, 0.55); }
  let pulse = 0.9 + 0.1 * sin(t * 1.3 + n * 6.0);
  return (base * (0.55 + 0.45 * n) + hot * vein * 0.9) * (1.0 - crust * 0.6) * pulse;
}`;

// LAVA (owner playtest 2026-11-01: "doesn't read as lava, not intense enough"): the flow above at glowGain 0.35 reads as a
// flat tan sheet. Lava is mostly dark: cooled basalt plates drifting apart over a white-hot seam. Cell noise gives the
// plates (distance to the nearest edge is the seam), a slow large noise widens the seams into molten stretches, and a
// fine one roughens the crust. The colours are HDR, so the seams feed the bloom. `?lava=0` is the old flow.
export const SECTOR_LAVA_CELLS = /* wgsl */ `fn sgCells(p: vec2<f32>, t: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2<f32>(f32(x), f32(y));
      let h = vec2<f32>(sgHash(i + g), sgHash(i + g + vec2<f32>(17.3, 9.1)));
      let o = 0.5 + 0.4 * sin(t + 6.2831 * h);
      let d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return f2 - f1;
}`;

export const SECTOR_LAVA = /* wgsl */ `fn sectorLava(wpos: vec3<f32>, t: f32) -> vec3<f32> {
  let xz = wpos.xz;
  let warp = vec2<f32>(sgNoise(xz * 0.42 + vec2<f32>(t * 0.03, 2.1)), sgNoise(xz * 0.42 + vec2<f32>(5.2, t * 0.025)));
  let edge = sgCells(xz * 0.62 + (warp - 0.5) * 1.5 + vec2<f32>(t * 0.018, t * 0.011), t * 0.06);
  let pool = sgNoise(xz * 0.11 + vec2<f32>(t * 0.012, -t * 0.009));
  let molten = smoothstep(0.38, 0.72, pool);
  let fine = sgNoise(xz * 3.3 + warp * 2.0);
  let seam = 1.0 - smoothstep(0.0, 0.05 + 0.34 * molten, edge + (fine - 0.5) * 0.05);
  let heat = seam * (0.82 + 0.18 * sin(t * 1.9 + pool * 11.0 + fine * 3.0));
  let grit = sgNoise(xz * 9.0 + warp * 3.0);
  let vein = (1.0 - smoothstep(0.0, 0.07, sgCells(xz * 2.3 + warp * 2.4, t * 0.04))) * smoothstep(0.42, 0.68, sgNoise(xz * 0.9 - warp));
  let crust = vec3<f32>(0.006, 0.0035, 0.003) + vec3<f32>(0.03, 0.013, 0.009) * fine * grit
    + vec3<f32>(0.75, 0.05, 0.006) * vein * (0.25 + 0.75 * molten) + vec3<f32>(0.16, 0.012, 0.0) * molten * molten;
  var col = mix(crust, vec3<f32>(1.1, 0.08, 0.012), smoothstep(0.0, 0.34, heat));
  col = mix(col, vec3<f32>(3.6, 1.0, 0.10), smoothstep(0.28, 0.68, heat));
  return mix(col, vec3<f32>(8.0, 4.6, 1.3), smoothstep(0.70, 1.0, heat));
}`;

/** `?lava=0`: lava is the old flow (for A/B), at glowGain, with the old bounce. */
export const lavaOn = (search: URLSearchParams): boolean => search.get('lava') !== '0';
/** The baked bounce off a lava floor is this many times the other kinds': the room should read as lit from below. */
export const LAVA_BOUNCE = 1.5;

export const GLOW_KIND_INDEX = { nukage: 0, lava: 1, acid: 2 } as const;

/** Each kind's `base` colour in SECTOR_GLOW (the bulk of the surface; sector-bounce.ts tints the
 *  room with it). sector-glow.wgsl.test.ts pins these against the WGSL. */
export const GLOW_BASE_RGB = {
  nukage: [0.10, 0.85, 0.18],
  lava: [0.95, 0.30, 0.05],
  acid: [0.55, 0.85, 0.10],
} as const satisfies Record<keyof typeof GLOW_KIND_INDEX, readonly [number, number, number]>;
