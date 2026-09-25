// src/game/level/outdoor-texture-pixels.ts
//
// OUTDOOR v1 procedural textures as RGBA pixels (pure, seeded, deterministic).
// outdoor-textures.ts wraps them as three DataTextures. Values are albedo-neutral
// (grey-ish detail); the preset's albedo tints the material.

export type GroundKind = 'flagstone' | 'gravel' | 'dirt' | 'grass';
export type EdgeKind = 'brick' | 'railing' | 'leaves';
export type SkylineKind = 'trees' | 'roofs' | 'hills';
export const OUTDOOR_TEX_SIZE = 256;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number): number {
  return noise(x, y, s) * 0.5 + noise(x * 2, y * 2, s + 1) * 0.25 + noise(x * 4, y * 4, s + 2) * 0.125 + noise(x * 8, y * 8, s + 3) * 0.125;
}
const put = (p: Uint8ClampedArray, i: number, v: number, a = 255) => { const g = Math.round(v * 255); p[i] = g; p[i + 1] = g; p[i + 2] = g; p[i + 3] = a; };

export function groundPixels(kind: GroundKind, seed: number): Uint8ClampedArray {
  const N = OUTDOOR_TEX_SIZE, p = new Uint8ClampedArray(N * N * 4), r = rng(seed);
  const jitter = r() * 64;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N * 8, v = y / N * 8, i = (y * N + x) * 4;
    let g: number;
    if (kind === 'grass') g = 0.55 + 0.35 * fbm(u * 3 + jitter, v * 3, seed) - 0.25 * Math.max(0, noise(u * 40, v * 6, seed + 9) - 0.6);
    else if (kind === 'gravel') g = 0.35 + 0.55 * Math.pow(noise(u * 12 + jitter, v * 12, seed), 2.2) + 0.1 * fbm(u, v, seed + 5);
    else if (kind === 'dirt') g = 0.45 + 0.4 * fbm(u * 1.5 + jitter, v * 1.5, seed);
    else { // flagstone: irregular slabs with dark joints
      const cx = Math.floor(u / 2 + noise(v, u, seed) * 0.3), cy = Math.floor(v / 1.6 + noise(u, v, seed + 1) * 0.3);
      const fu = u / 2 - cx, fv = v / 1.6 - cy, edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      g = edge < 0.04 ? 0.2 : 0.55 + 0.25 * hash(cx, cy, seed) + 0.15 * fbm(u * 2, v * 2, seed + 3);
    }
    put(p, i, Math.min(1, Math.max(0, g)));
  }
  return p;
}

export function edgePixels(kind: EdgeKind, seed: number): Uint8ClampedArray {
  const N = OUTDOOR_TEX_SIZE, p = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = (y * N + x) * 4;
    if (kind === 'railing') {
      // vertical bars every 1/8 with spear tips near the top, a rail at 0.15 and 0.85
      const bar = Math.abs((u * 8) % 1 - 0.5) < 0.09;
      const tip = v < 0.1 && Math.abs((u * 8) % 1 - 0.5) < 0.09 * (v / 0.1);
      const rail = Math.abs(v - 0.15) < 0.02 || Math.abs(v - 0.85) < 0.02;
      const solid = (bar && v >= 0.1) || tip || rail;
      put(p, i, solid ? 0.35 + 0.2 * noise(u * 30, v * 30, seed) : 0, solid ? 255 : 0);
    } else if (kind === 'leaves') {
      put(p, i, 0.3 + 0.6 * Math.pow(fbm(u * 24, v * 24, seed), 1.5));
    } else { // brick: courses with offset joints, weathered
      const row = Math.floor(v * 8), off = row % 2 ? 0.5 : 0, bu = (u * 4 + off) % 1, bv = (v * 8) % 1;
      const joint = bu < 0.04 || bv < 0.08;
      put(p, i, joint ? 0.25 : 0.5 + 0.3 * fbm(u * 6, v * 6, seed) + 0.15 * hash(Math.floor(u * 4 + off), row, seed));
    }
  }
  return p;
}

/** 2048 x 256 silhouette, white where solid (alpha 255), transparent above. Wraps in x. */
export function skylinePixels(kind: SkylineKind, roughness: number, seed: number): Uint8ClampedArray {
  const W = 2048, H = 256, p = new Uint8ClampedArray(W * H * 4);
  for (let x = 0; x < W; x++) {
    const u = x / W;
    let h: number; // 0..1 of the texture height, measured from the bottom
    if (kind === 'hills') h = 0.35 + 0.25 * Math.sin(u * Math.PI * 2 * 3 + seed) + 0.15 * roughness * (noise(u * 24, 0, seed) - 0.5);
    else if (kind === 'roofs') {
      const b = Math.floor(u * 40), top = 0.35 + 0.35 * hash(b, 0, seed);
      const chimney = hash(b, 1, seed) > 0.7 && (u * 40) % 1 > 0.7 && (u * 40) % 1 < 0.8 ? 0.12 : 0;
      const spire = hash(b, 2, seed) > 0.95 ? 0.5 * (1 - Math.abs((u * 40) % 1 - 0.5) * 2) : 0;
      h = top + chimney + spire;
    } else { // trees: conifer tops, jagged by roughness
      const t = Math.floor(u * 160), f = (u * 160) % 1, height = 0.45 + 0.4 * hash(t, 0, seed);
      h = height * (1 - Math.abs(f - 0.5) * 2 * roughness) + 0.2;
    }
    const top = Math.round((1 - Math.min(0.98, Math.max(0.05, h))) * (H - 1));
    for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; put(p, i, 1, y >= top ? 255 : 0); }
  }
  return p;
}
