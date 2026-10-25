// src/lab/sdf-zombie/webgpu/barrel-look.ts
//
// THE BARREL'S LOOK (spec 2026-10-24 §8, plan 2026-10-25-sector-levels-3b Task 12): our own toxic drum, no WAD
// data. The lathe profile (two rolling hoops, chimed rims, a recessed lid), the procedural albedo (grimy toxic
// green, vertical drips, rust at the foot, a worn black/yellow hazard band), the blown stub's profile and torn rim,
// the floor scorch's alpha, and the fixed yaw a barrel gets from its id. game-barrel-view.ts turns these into
// meshes and textures.
//
// Pure: plain numbers and Uint8Arrays — no three.js, no DOM. Deterministic (seeded hashes, no RNG stream).
import { BARREL } from './barrel-state';

/** A lathe profile point: [radius, height] in metres, from the bottom centre. */
export type ProfilePoint = [r: number, y: number];

/** Profile numbers (m): rims stand 8 mm proud of the shell, hoops 12 mm. */
export const BARREL_LOOK = {
  rimLipM: 0.008,
  hoopM: 0.012,
  /** The lid sits this far below the top rim. */
  lidRecessM: 0.01,
  /** The blown stub keeps the drum's bottom this high (± tearM at its rim). */
  stubHeightM: 0.18,
  tearM: 0.04,
} as const;

/** FNV-1a of a string, as an unsigned 32-bit int. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** An integer hash to [0, 1). */
function hash3(a: number, b: number, seed: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Value noise on a lattice of `cells` × `cellsY` over [0, 1)², wrapping in x (u goes round the drum, so its seam
 *  must not show) and in y. */
function vnoise(u: number, v: number, seed: number, cells: number, cellsY = cells): number {
  const x = u * cells, y = v * cellsY;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const xa = ((x0 % cells) + cells) % cells, xb = (xa + 1) % cells;
  const ya = ((y0 % cellsY) + cellsY) % cellsY, yb = (ya + 1) % cellsY;
  return mix(mix(hash3(xa, ya, seed), hash3(xb, ya, seed), fx), mix(hash3(xa, yb, seed), hash3(xb, yb, seed), fx), fy);
}
/** Three octaves of vnoise. */
function fbm(u: number, v: number, seed: number, cells: number): number {
  return (vnoise(u, v, seed, cells) * 0.55 + vnoise(u, v, seed + 17, cells * 2) * 0.3 + vnoise(u, v, seed + 31, cells * 4) * 0.15);
}

/** The drum's lathe profile, bottom centre → top: the foot, a chimed bottom rim, the shell with two rolling hoops
 *  at h/3 and 2h/3, the top rim, and the recessed lid back to the axis at h − lidRecess. */
export function barrelProfile(): ProfilePoint[] {
  const R = BARREL.radiusM, h = BARREL.heightM, rim = R + BARREL_LOOK.rimLipM, hoop = R + BARREL_LOOK.hoopM;
  const pts: ProfilePoint[] = [
    [0, 0], [R - 0.004, 0], [rim, 0.004], [rim, 0.022], [R - 0.002, 0.03], [R, 0.04],
  ];
  for (const yc of [h / 3, (2 * h) / 3]) {
    pts.push([R, yc - 0.026], [hoop, yc - 0.011], [hoop, yc + 0.011], [R, yc + 0.026]);
  }
  const lid = h - BARREL_LOOK.lidRecessM;
  pts.push([R, h - 0.04], [R - 0.002, h - 0.03], [rim, h - 0.022], [rim, h - 0.004], [R - 0.004, h],
    [R - 0.014, h], [R - 0.016, lid], [0, lid]);
  return pts;
}

/** The blown stub: the drum's profile up to stubHeight, then a torn top — the shell's rim jittered ±tear (seeded)
 *  and a crumpled cap back to the axis. */
export function stubProfile(seed: number): ProfilePoint[] {
  const top = BARREL_LOOK.stubHeightM, tear = BARREL_LOOK.tearM, R = BARREL.radiusM;
  const pts = barrelProfile().filter(([, y]) => y <= top - tear);
  const j = (k: number) => (hash3(k, 7, seed) * 2 - 1) * tear;
  // The shell runs up to the torn edge, folds in, and the crumpled cap steps to the axis.
  const tornRs = [R, R - 0.03, R - 0.09, R - 0.16, R - 0.23];
  tornRs.forEach((r, k) => pts.push([r, top + j(k)]));
  pts.push([0, top + j(9)]);
  return pts;
}

/** Per-segment height offsets for the stub's torn rim (± tear), one per lathe segment around: the view adds them
 *  to the stub's top rows so the tear is ragged around the drum, not only up its profile. */
export function stubTear(seed: number, segments: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const coarse = hash3(i >> 2, 3, seed) * 2 - 1, fine = hash3(i, 5, seed) * 2 - 1;
    out.push((coarse * 0.6 + fine * 0.4) * BARREL_LOOK.tearM);
  }
  return out;
}

/** A barrel's fixed yaw (radians, [0, 2π)) from its id. */
export function barrelYaw(id: string): number {
  return (fnv1a(id) / 4294967296) * Math.PI * 2;
}

/** Hazard band height range in v (0 = foot, 1 = top). */
export const HAZARD_BAND: readonly [number, number] = [0.44, 0.56];

/** The drum's albedo, RGBA8 sRGB, w × h; u round the drum (wraps), v up (row 0 = the foot). Base toxic green,
 *  darker greener drips running down, rust at the foot, a worn black/yellow 45° hazard band, grime toward the
 *  bottom. */
export function barrelAlbedo(w: number, h: number, seed: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  // Each drip column: a 1D hash in u gives its strength; it starts at a hashed height and runs down to the foot.
  const dripCols = 48;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      // Base, with a broad mottle and darker blotches of dirt.
      const mottle = fbm(u, v, seed, 6);
      const dirt = clamp01((fbm(u, v, seed + 61, 12) - 0.55) * 3);
      let r = 58, g = 96, b = 28;
      const m = (0.74 + 0.5 * mottle) * (1 - 0.35 * dirt);
      r *= m; g *= m; b *= m;
      // Drips: column strength from u (soft across a column); each runs down from a hashed start (the top rim,
      // a hoop or the band) and fades as it goes.
      const cu = u * dripCols, ci = Math.floor(cu) % dripCols, cf = cu - Math.floor(cu);
      const strength = hash3(ci, 11, seed);
      const starts = [0.985, 2 / 3 - 0.02, HAZARD_BAND[0], 1 / 3 - 0.02];
      const start = starts[Math.floor(hash3(ci, 13, seed) * starts.length)]!;
      const len = 0.15 + 0.45 * hash3(ci, 17, seed);
      const across = Math.max(0, 1 - Math.abs(cf - 0.5) * (2.2 + 3 * hash3(ci, 19, seed)));
      const run = (start - v) / len;
      const along = run < 0 ? 0 : clamp01(run * 12) * clamp01(1 - run) * (0.55 + 0.45 * vnoise(u, v, seed + 5, dripCols, 8));
      const drip = strength > 0.3 ? across * along * Math.min(1, (strength - 0.3) * 2.2) : 0;
      r = mix(r, 26, drip); g = mix(g, 58, drip); b = mix(b, 12, drip);
      // Grime collects under the hoops and the top rim.
      const ring = Math.max(0, 1 - Math.abs(v - 1 / 3 + 0.03) * 30, 1 - Math.abs(v - 2 / 3 + 0.03) * 30, (v - 0.94) * 16);
      const ringK = 1 - 0.45 * clamp01(ring);
      r *= ringK; g *= ringK; b *= ringK;
      // Rust, weighted toward the foot (and a little at the rims and hoops).
      const n = fbm(u, v, seed + 101, 8);
            const rustW = clamp01((n - 0.38) * 2.6 + (0.15 - v) * 5 + clamp01(ring) * 0.35);
      r = mix(r, 88 * (0.7 + 0.5 * n), rustW); g = mix(g, 52 * (0.7 + 0.5 * n), rustW); b = mix(b, 26, rustW);
      // The hazard band: 45° stripes, worn through by the same noise.
      if (v >= HAZARD_BAND[0] && v <= HAZARD_BAND[1]) {
        const stripe = (((u * w + v * h) / 18) | 0) % 2;
        const [sr, sg, sb] = stripe === 0 ? [196, 160, 32] : [20, 20, 18];
        const wear = clamp01((n - 0.62) * 4);
        r = mix(sr, r, wear); g = mix(sg, g, wear); b = mix(sb, b, wear);
      }
      // Grime: darker toward the floor, plus fine grit.
      const grime = (0.55 + 0.45 * Math.sqrt(v)) * (0.92 + 0.16 * hash3(x, y, seed + 7));
      const i = (y * w + x) * 4;
      out[i] = Math.min(255, Math.round(r * grime));
      out[i + 1] = Math.min(255, Math.round(g * grime));
      out[i + 2] = Math.min(255, Math.round(b * grime));
      out[i + 3] = 255;
    }
  }
  return out;
}

/** The floor scorch's alpha, one channel, n × n: opaque soot at the centre, a ragged edge, 0 at the corners. */
export function scorchAlpha(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
      const d = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
      const edge = 0.62 + 0.3 * vnoise(ang, 0, seed, 9, 1);
      const grit = 0.85 + 0.15 * vnoise((x + 0.5) / n, (y + 0.5) / n, seed + 3, 16);
      const a = clamp01(1 - smooth(clamp01((d - edge * 0.45) / (edge * 0.55))));
      out[y * n + x] = Math.round(255 * a * grit);
    }
  }
  return out;
}
