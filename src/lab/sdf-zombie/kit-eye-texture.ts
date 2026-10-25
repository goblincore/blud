// src/lab/sdf-zombie/kit-eye-texture.ts
//
// THE POPPED EYE'S SURFACE (owner, 2026-10-24: the dangling eye "looks like a yellow ball on a lollipop stick; it should
// have some veins, and bloody decals near the stalk, and the stalk more pink, more fleshy"). Generated, not painted:
// pixel arrays the game leaf (webgpu/game-kit-eye.ts) turns into textures, so no image assets and nothing to keep in
// sync with the eye's size or colour. Pure (no THREE, no DOM); randomness is a seeded hash.
//
//   eyeTextures   an equirectangular map for a sphere whose +y pole is the eye's FRONT (THREE.SphereGeometry's UVs:
//                 u around the pole, v from the front pole to the back one):
//                   iris    the front 50 degrees: the iris colour, brighter at the centre, radial fibres, a dark limbal
//                           ring, and a vertical black SLIT (recessed);
//                   sclera  a bloodshot cream-pink band, raised branching veins running from the back toward the iris;
//                   back    the torn rear the stalk tore out of: raw wet red, darker clots, blood creeping forward;
//   stalkTextures a map for the optic stalk (u along it, socket 0 -> eye 1; v round it): pink wet flesh with fibrous
//                 striations and a few raised veins, soaked in blood toward the eye and at the socket.
// Each comes as linear-ish sRGB RGBA bytes (`albedo`) and a tangent-space normal map from its height field
// (`normal`, rgb = n * 0.5 + 0.5), the same size.
import type { Vec3 } from './types';

export interface EyeTextureSet {
  w: number; h: number; albedo: Uint8ClampedArray; normal: Uint8ClampedArray;
  /** The iris's glow mask (grey RGBA; the eye only): the emissive map, so the iris burns and the slit and the rest do not. */
  glow?: Uint8ClampedArray;
}

/** A 2D value-noise in [0, 1], seeded. */
function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, s: number, oct = 4): number {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * noise(x * f, y * f, s + i * 17); a *= 0.5; f *= 2.03; }
  return v;
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A tangent-space normal map from a height field (wrapping in u), `strength` scaling the slopes. */
function normalsFrom(height: Float32Array, w: number, h: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)]!;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, Math.min(h - 1, y)) - at(x - 1, Math.min(h - 1, y))) * strength;
    const dy = (at(x, Math.min(h - 1, y + 1)) - at(x, Math.max(0, y - 1))) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    out[i] = (-dx / l * 0.5 + 0.5) * 255; out[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out[i + 2] = (1 / l * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}

const SCLERA: Vec3 = [0.86, 0.66, 0.58];
const VEIN: Vec3 = [0.62, 0.05, 0.06];
const RAW: Vec3 = [0.42, 0.03, 0.04];
const CLOT: Vec3 = [0.16, 0.01, 0.015];

export function eyeTextures(w: number, h: number, iris: Vec3, seed = 7): EyeTextureSet {
  const albedo = new Uint8ClampedArray(w * h * 4);
  const glow = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const irisCentre = mix(iris, [1, 0.95, 0.55], 0.35);
  const irisEdge = mix(iris, [0.55, 0.12, 0.0], 0.45);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // The sphere point for this texel (SphereGeometry's own parametrisation; its +y pole is the eye's front).
    const phi = (x + 0.5) / w * Math.PI * 2, theta = (y + 0.5) / h * Math.PI;
    const dx = -Math.cos(phi) * Math.sin(theta), dz = Math.sin(phi) * Math.sin(theta);
    const alpha = theta * 180 / Math.PI;           // degrees from the front pole
    const sx = dx, sy = -dz;                       // across / up on the eye's face
    const ang = Math.atan2(sy, sx);
    let c: Vec3, hgt = 0, g = 0;
    const veinNoise = fbm(phi * 3, theta * 3, seed);
    if (alpha < 50) {
      const r = alpha / 50;
      c = mix(irisCentre, irisEdge, smooth(0.15, 0.95, r));
      // radial fibres, wavy, and crypts
      const fib = Math.sin(ang * 70 + fbm(ang * 4, r * 6, seed + 3) * 6);
      c = mix(c, mix(c, [0.35, 0.08, 0.0], 0.6), 0.18 * (fib * 0.5 + 0.5));
      hgt += 0.08 * fib * (1 - r);
      // the limbal ring
      c = mix(c, [0.12, 0.03, 0.0], smooth(0.84, 0.98, r) * 0.85);
      g = (1 - 0.45 * r * r) * (1 - smooth(0.84, 0.98, r));
      // the slit pupil, recessed
      const slitW = 0.07 * Math.max(0, 1 - (sy / 0.64) ** 2) + 0.012;
      if (Math.abs(sx) < slitW && Math.abs(sy) < 0.66) { c = [0.015, 0.008, 0.004]; hgt -= 0.5; g = 0; }
    } else if (alpha < 118) {
      const t = (alpha - 50) / 68;                  // 0 at the iris, 1 at the torn back
      c = mix(SCLERA, [0.82, 0.48, 0.44], t * 0.8);
      // VEINS: a few winding trunks from the back toward the iris, branching (two frequencies), fading as they near
      // the iris; raised.
      const wob = fbm(alpha * 0.08, ang * 2, seed + 11) * 2.2;
      const v1 = Math.abs(Math.sin(ang * 5 + wob + alpha * 0.03));
      const v2 = Math.abs(Math.sin(ang * 11 - wob * 1.4 + alpha * 0.07));
      const vein = Math.max(smooth(0.93, 0.99, 1 - v1) * (0.35 + 0.65 * t), smooth(0.955, 0.995, 1 - v2) * smooth(0.3, 0.8, t));
      c = mix(c, VEIN, clamp01(vein * 0.95 + 0.15 * veinNoise * t));
      hgt += 0.45 * vein;
      // blood creeping forward from the torn back
      const creep = smooth(0.6, 1.0, t + (fbm(phi * 5, theta * 5, seed + 23) - 0.5) * 0.5);
      c = mix(c, RAW, creep);
      hgt += 0.1 * creep * fbm(phi * 14, theta * 14, seed + 5);
    } else {
      // the torn back: raw meat, clots, stringy
      const n = fbm(phi * 9, theta * 9, seed + 31);
      c = mix(RAW, CLOT, smooth(0.45, 0.7, n));
      hgt += 0.35 * n + 0.15 * Math.sin(phi * 40 + n * 8);
    }
    const i = (y * w + x) * 4;
    albedo[i] = clamp01(c[0]) * 255; albedo[i + 1] = clamp01(c[1]) * 255; albedo[i + 2] = clamp01(c[2]) * 255; albedo[i + 3] = 255;
    glow[i] = glow[i + 1] = glow[i + 2] = clamp01(g) * 255; glow[i + 3] = 255;
    height[y * w + x] = hgt;
  }
  return { w, h, albedo, normal: normalsFrom(height, w, h, 6), glow };
}

const STALK_PINK: Vec3 = [0.78, 0.4, 0.42];
export function stalkTextures(w: number, h: number, seed = 13): EyeTextureSet {
  const albedo = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w, v = (y + 0.5) / h;    // u along (socket 0 -> eye 1), v round
    const striae = Math.sin(v * Math.PI * 2 * 14 + fbm(u * 6, v * 4, seed) * 3);
    let c: Vec3 = mix(STALK_PINK, [0.62, 0.24, 0.27], 0.25 + 0.25 * striae);
    let hgt = 0.12 * striae;
    // two winding veins along it
    for (const k of [0.2, 0.63]) {
      const path = k + 0.06 * Math.sin(u * 14 + k * 9) + 0.03 * Math.sin(u * 31);
      const dv = Math.min(Math.abs(v - path), 1 - Math.abs(v - path));
      const vein = smooth(0.03, 0.008, dv);
      c = mix(c, [0.45, 0.04, 0.08], vein * 0.9);
      hgt += 0.5 * vein;
    }
    // soaked in blood toward the eye (the torn end) and at the socket
    const soak = Math.max(smooth(0.55, 0.95, u + (fbm(u * 8, v * 8, seed + 7) - 0.5) * 0.35), smooth(0.12, 0.0, u));
    c = mix(c, RAW, soak * 0.9);
    hgt += 0.15 * soak * fbm(u * 20, v * 20, seed + 9);
    const i = (y * w + x) * 4;
    albedo[i] = clamp01(c[0]) * 255; albedo[i + 1] = clamp01(c[1]) * 255; albedo[i + 2] = clamp01(c[2]) * 255; albedo[i + 3] = 255;
    height[y * w + x] = hgt;
  }
  return { w, h, albedo, normal: normalsFrom(height, w, h, 4) };
}
