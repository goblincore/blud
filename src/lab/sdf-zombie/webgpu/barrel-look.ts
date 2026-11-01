// src/lab/sdf-zombie/webgpu/barrel-look.ts
//
// THE BARREL'S LOOK (spec 2026-10-24 §8, plan 2026-10-25-sector-levels-3b Task 12): our own toxic drum, no WAD
// data. An old, abused drum in the walls' own grime level (src/game/level/panel-textures.ts): aged, faded toxic
// paint, rust blooming round the hoops, rims, weld seam and foot, chips and scratches down to bare steel, drips and
// grime, and a few seeded dents in the shell. The lid is grimy with a raised rim and two bungs, one a small vent
// that glows. The blown stub is open: a jagged torn rim with petals bent outward, charred, dark inside. The floor
// scorch is wide and dark with a darker core.
//
// This module: the lathe profiles, the dents, the stub's torn rim, the drum and lid albedo (RGB, roughness in A),
// the scorch's soot amount and how big a scorch the floor can take, and the fixed yaw a barrel gets from its id.
// game-barrel-view.ts turns these into meshes and textures.
//
// Pure: plain numbers and Uint8Arrays — no three.js, no DOM. Deterministic (seeded hashes, no RNG stream).
import { BARREL } from './barrel-state';

/** A lathe profile point: [radius, height] in metres, from the bottom centre. */
export type ProfilePoint = [r: number, y: number];

/** Profile and look numbers (m unless noted): rims stand 8 mm proud of the shell, hoops 12 mm. */
export const BARREL_LOOK = {
  rimLipM: 0.008,
  hoopM: 0.012,
  /** The lid sits this far below the top rim (the rim stands proud of it). */
  lidRecessM: 0.022,
  /** The lid plate's radius: inside the rim's inner wall. */
  lidRadiusM: BARREL.radiusM - 0.014,
  /** The blown stub keeps the drum's bottom up to stubHeight − tear; its torn rim reaches stubHeight ± tear. */
  stubHeightM: 0.24,
  tearM: 0.07,
  /** The stub's petals bend outward up to this far at their tips. */
  petalOutM: 0.1,
  /** The stub's wall thickness (its inner wall sits this far inside the shell). */
  stubWallM: 0.005,
  /** Dents: per barrel, this many (inclusive range), each at most this deep. */
  dents: [2, 4] as const,
  dentMaxM: 0.045,
  /** Shell between this far above the foot and below the top (dents stay off the chimes). */
  dentBandM: 0.05,
  /** The bungs on the lid, centre (x, z) in metres from the lid centre, radius: the vent (glows) and the plug. */
  vent: { x: 0.155, z: 0.02, r: 0.03 },
  plug: { x: -0.15, z: -0.06, r: 0.026 },
  /** The floor scorch quad's edge (its soot reaches ~0.85 of it: ≈ 2.4 m across), and the smallest a cramped floor
   *  shrinks it to. */
  scorchM: 2.8,
  scorchMinM: 0.9,
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
/** Distance between two u (round-the-drum) coordinates, wrapping. */
const du = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return d > 0.5 ? 1 - d : d; };

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
 *  at h/3 and 2h/3, the top rim, and the recessed lid back to the axis at h − lidRecess. The plain shell carries
 *  extra rows (≤ 5 cm apart) so a dent has vertices to push. */
export function barrelProfile(): ProfilePoint[] {
  const R = BARREL.radiusM, h = BARREL.heightM, rim = R + BARREL_LOOK.rimLipM, hoop = R + BARREL_LOOK.hoopM;
  const pts: ProfilePoint[] = [
    [0, 0], [R - 0.004, 0], [rim, 0.004], [rim, 0.022], [R - 0.002, 0.03], [R, 0.04],
  ];
  /** Shell rows strictly between y0 and y1. */
  const shell = (y0: number, y1: number) => {
    const n = Math.ceil((y1 - y0) / 0.05);
    for (let k = 1; k < n; k++) pts.push([R, y0 + ((y1 - y0) * k) / n]);
  };
  let y = 0.04;
  for (const yc of [h / 3, (2 * h) / 3]) {
    shell(y, yc - 0.026);
    pts.push([R, yc - 0.026], [hoop, yc - 0.011], [hoop, yc + 0.011], [R, yc + 0.026]);
    y = yc + 0.026;
  }
  shell(y, h - 0.04);
  const lid = h - BARREL_LOOK.lidRecessM;
  pts.push([R, h - 0.04], [R - 0.002, h - 0.03], [rim, h - 0.022], [rim, h - 0.004], [R - 0.004, h],
    [R - 0.012, h], [R - 0.014, lid], [0, lid]);
  return pts;
}

// ---------------------------------------------------------------------------------------------------------------
// Dents

/** One dent in the shell: where (u round the drum, y metres up), its radius and its depth (metres, inward). */
export interface Dent { u: number; y: number; radiusM: number; depthM: number }

/** A barrel's dents, seeded (its id's hash): dents[0]..dents[1] of them, on the shell between the chimes. */
export function barrelDents(seed: number): Dent[] {
  const [lo, hi] = BARREL_LOOK.dents;
  const n = lo + Math.floor(hash3(1, 91, seed) * (hi - lo + 1));
  const band = BARREL_LOOK.dentBandM, H = BARREL.heightM;
  const out: Dent[] = [];
  for (let k = 0; k < n; k++) {
    const radiusM = 0.06 + 0.08 * hash3(k, 95, seed);
    out.push({
      u: hash3(k, 93, seed),
      y: band + radiusM * 0.5 + (H - 2 * band - radiusM) * hash3(k, 94, seed),
      radiusM,
      // A dent's depth grows with its size; the biggest reach dentMax.
      depthM: BARREL_LOOK.dentMaxM * (0.35 + 0.65 * hash3(k, 96, seed)) * (0.6 + 0.4 * (radiusM - 0.06) / 0.08),
    });
  }
  return out;
}

/** How far (m, ≥ 0, ≤ dentMax) the dents push the shell in at (u, y): each a smooth bowl with a creased floor
 *  (the crease makes it read as a dent, not a soft dimple). 0 outside the dent band. */
export function dentDepth(dents: readonly Dent[], u: number, y: number): number {
  const band = BARREL_LOOK.dentBandM, H = BARREL.heightM;
  if (y <= band || y >= H - band) return 0;
  const C = Math.PI * 2 * BARREL.radiusM;
  let d = 0;
  for (const dent of dents) {
    const dx = du(u, dent.u) * C, dy = (y - dent.y) * 1.3;   // a touch squashed: drums dent wider than tall
    const q = Math.hypot(dx, dy) / dent.radiusM;
    if (q >= 1) continue;
    const bowl = (1 - q * q) ** 2;
    const crease = 1 - Math.min(1, Math.abs(dy) / (dent.radiusM * 0.35)) * 0.35;
    d += dent.depthM * bowl * crease;
  }
  // Fade to 0 approaching the chimes so the rims stay round.
  const edge = Math.min(1, (y - band) / 0.03, (H - band - y) / 0.03);
  return Math.min(BARREL_LOOK.dentMaxM, d * edge);
}

// ---------------------------------------------------------------------------------------------------------------
// The blown stub

/** The blown stub: the drum's profile up to the cut (stubHeight − tear), then the shell rising in four rows to
 *  the torn top, a thin lip, and the inner wall back down to a dark floor just over the bottom, to the axis. Open
 *  at the top. The view tears the top rows per column (stubTear, stubBend). Seeded: the rim height varies a little
 *  per barrel. */
export function stubProfile(seed: number): ProfilePoint[] {
  const { stubHeightM: h, tearM: tear, stubWallM: wall } = BARREL_LOOK;
  const R = BARREL.radiusM, cut = h - tear;
  const pts = barrelProfile().filter(([, y]) => y <= cut);
  const top = h + (hash3(2, 7, seed) * 2 - 1) * tear * 0.3;
  for (const f of [0.25, 0.5, 0.75, 1]) pts.push([R, cut + (top - cut) * f]);
  // The lip, then the inside: the same rows mirrored at R − wall, down to the floor.
  pts.push([R - wall, top]);
  for (const f of [0.75, 0.5, 0.25, 0]) pts.push([R - wall, cut + (top - cut) * f]);
  pts.push([R - wall, 0.03], [0, 0.03]);
  return pts;
}

/** The index of the stub profile's lip (the first inner-wall point): rows from here on are the inside. */
export function stubInnerStart(profile: readonly ProfilePoint[]): number {
  const R = BARREL.radiusM;
  let top = 0;
  for (let i = 1; i < profile.length; i++) if (profile[i]![1] >= profile[top]![1] && Math.abs(profile[i]![0] - R) < 1e-9) top = i;
  return top + 1;
}

/** The torn rim's petal count for a seed (6–8 round the drum). */
function petals(seed: number): number { return 6 + Math.floor(hash3(3, 11, seed) * 3); }

/** Per-column height offsets for the stub's torn rim (± tear), one per lathe segment round the drum: a jagged
 *  sawtooth of petals (tips up, notches torn down between them) with a little noise, so the tear is ragged round
 *  the drum, not only up its profile. */
export function stubTear(seed: number, segments: number): number[] {
  const P = petals(seed), off = hash3(4, 11, seed);
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const p = (i / segments) * P + off, k = Math.floor(p), f = p - k;
    const tooth = 1 - Math.abs(2 * f - 1);                   // 0 at a notch, 1 at a petal tip
    const tall = 0.55 + 0.45 * hash3(k % P, 13, seed);        // petals tear to different heights
    const fine = hash3(i, 5, seed) * 2 - 1;
    const t = (tooth * tall * 2 - 1) * 0.85 + fine * 0.15;
    out.push(Math.max(-1, Math.min(1, t)) * BARREL_LOOK.tearM);
  }
  return out;
}

/** Per-column outward bend of the torn rim, [0, 1] (× petalOut at the tip): petals peel outward, the notches
 *  between them barely move. */
export function stubBend(seed: number, segments: number): number[] {
  const P = petals(seed), off = hash3(4, 11, seed);
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const p = (i / segments) * P + off, k = Math.floor(p), f = p - k;
    const tooth = 1 - Math.abs(2 * f - 1);
    out.push(clamp01(Math.sqrt(tooth) * (0.35 + 0.65 * hash3(k % P, 17, seed))));
  }
  return out;
}

/** Where a stub vertex above the cut goes, given its column's tear and bend and how far up the torn band it sits
 *  (t: 0 at the cut, 1 at the top): [radial offset (outward), height offset]. The petal curls: out with t², and
 *  its tip sags a little as it peels. */
export function stubWarp(tear: number, bend: number, t: number): [dr: number, dy: number] {
  const c = clamp01(t);
  const out = bend * BARREL_LOOK.petalOutM * c * c;
  return [out, tear * c - out * 0.35];
}

// ---------------------------------------------------------------------------------------------------------------
// Albedo

/** A barrel's fixed yaw (radians, [0, 2π)) from its id. */
export function barrelYaw(id: string): number {
  return (fnv1a(id) / 4294967296) * Math.PI * 2;
}

/** Hazard band height range in v (0 = foot, 1 = top). */
export const HAZARD_BAND: readonly [number, number] = [0.44, 0.56];
/** The drum's vertical weld seam, in u. */
export const SEAM_U = 0.37;

/** Roughness written to the albedo's alpha (0–255 = 0–1) by surface: paint, rust, bare steel. */
export const BARREL_ROUGH = { paint: 0.74, rust: 0.93, bare: 0.36, grime: 0.88 } as const;

/** The panels' rust, sRGB (panel-textures RUST_SRGB), and a darker crust. */
const RUST: readonly [number, number, number] = [92, 54, 34];
const RUST_DARK: readonly [number, number, number] = [52, 32, 22];
/** Bare steel where the paint is chipped or scratched through. */
const BARE: readonly [number, number, number] = [96, 94, 88];

/** A short scratch: a segment in pixel space (u wraps), half-width in px. */
interface Scratch { x0: number; y0: number; x1: number; y1: number; w: number }
function scratchSet(n: number, w: number, h: number, seed: number, vLo = 0, vHi = 1): Scratch[] {
  const out: Scratch[] = [];
  for (let k = 0; k < n; k++) {
    const x0 = hash3(k, 41, seed) * w, y0 = (vLo + (vHi - vLo) * hash3(k, 42, seed)) * h;
    const len = (0.02 + 0.09 * hash3(k, 43, seed)) * w;
    // Mostly near-horizontal (knocked against things while rolling), some steep.
    const a = (hash3(k, 44, seed) < 0.7 ? (hash3(k, 45, seed) - 0.5) * 0.6 : (hash3(k, 45, seed) - 0.5) * 3);
    out.push({ x0, y0, x1: x0 + Math.cos(a) * len, y1: y0 + Math.sin(a) * len, w: 0.5 + 0.7 * hash3(k, 46, seed) });
  }
  return out;
}
/** The scratches' coverage [0, 1] rasterised into a w × h map (each over its own bounding box; x wraps). */
function scratchMap(sc: readonly Scratch[], w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (const s of sc) {
    const dx = s.x1 - s.x0, dy = s.y1 - s.y0, l2 = dx * dx + dy * dy;
    const pad = s.w + 1.5;
    const xa = Math.floor(Math.min(s.x0, s.x1) - pad), xb = Math.ceil(Math.max(s.x0, s.x1) + pad);
    const ya = Math.max(0, Math.floor(Math.min(s.y0, s.y1) - pad)), yb = Math.min(h - 1, Math.ceil(Math.max(s.y0, s.y1) + pad));
    for (let y = ya; y <= yb; y++) {
      for (let xi = xa; xi <= xb; xi++) {
        const px = xi + 0.5, py = y + 0.5;
        const t = clamp01(((px - s.x0) * dx + (py - s.y0) * dy) / l2);
        const d = Math.hypot(px - (s.x0 + dx * t), py - (s.y0 + dy * t));
        // Thinner toward the ends.
        const c = clamp01(1 - d / (s.w * (0.4 + 0.6 * Math.sin(Math.PI * t)) + 0.35));
        const i = y * w + (((xi % w) + w) % w);
        if (c > out[i]!) out[i] = c;
      }
    }
  }
  return out;
}

/** The drum's albedo, RGBA8 (RGB sRGB, A = roughness × 255), w × h; u round the drum (wraps), v up (row 0 = the
 *  foot). Faded, desaturated toxic green paint, mottled and dirty; grime drips running down; rust blooming round
 *  the hoops, the rims, the weld seam and the foot (with rust runs below the hoops); paint chipped and scratched
 *  to bare steel at the edges; a worn, dirty black/yellow hazard band; darker toward the floor. */
export function barrelAlbedo(w: number, h: number, seed: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const dripCols = 48;
  const scratches = scratchMap(scratchSet(36, w, h, seed + 900), w, h);
  const hoops = [1 / 3, 2 / 3];
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      // Paint: aged olive green, faded and chalky in broad patches, darker blotches of dirt.
      const mottle = fbm(u, v, seed, 6);
      const fade = clamp01((fbm(u, v, seed + 71, 4) - 0.45) * 2.5);
      const dirt = clamp01((fbm(u, v, seed + 61, 12) - 0.5) * 2.5);
      let r = mix(46, 63, fade), g = mix(59, 67, fade), b = mix(32, 45, fade);
      const m = (0.78 + 0.4 * mottle) * (1 - 0.4 * dirt);
      r *= m; g *= m; b *= m;
      let rough = mix(BARREL_ROUGH.paint, BARREL_ROUGH.grime, dirt * 0.6 + fade * 0.2);

      // Edges where things collect and wear: the hoops' sides, the rims, the seam.
      const hoopD = Math.min(...hoops.map((c) => Math.abs(v - c)));
      const nearHoop = clamp01(1 - (hoopD - 0.012) / 0.05);
      const nearRim = clamp01(1 - (v - 0.03) / 0.06) + clamp01(1 - (0.975 - v) / 0.06);
      const seam = clamp01(1 - du(u, SEAM_U) * w / 2.5);
      const nearSeam = clamp01(1 - du(u, SEAM_U) * w / 9);
      const edge = clamp01(Math.max(nearHoop, nearRim, nearSeam * 0.8));
      // The weld bead itself: a darker line.
      r *= 1 - 0.35 * seam; g *= 1 - 0.35 * seam; b *= 1 - 0.35 * seam;

      // The hazard band: 45° stripes in dull mustard and black, worn through and dirty.
      const n = fbm(u, v, seed + 101, 8);
      if (v >= HAZARD_BAND[0] && v <= HAZARD_BAND[1]) {
        const stripe = (((u * w + v * h) / 18) | 0) % 2;
        const [sr, sg, sb] = stripe === 0 ? [128, 102, 34] : [24, 23, 20];
        const wear = clamp01((n - 0.5) * 3);
        const k = 1 - 0.3 * dirt;
        r = mix(sr * k, r, wear); g = mix(sg * k, g, wear); b = mix(sb * k, b, wear);
      }

      // Drips: grime running down from the top rim, the hoops and the band, fading as they go.
      const cu = u * dripCols, ci = Math.floor(cu) % dripCols, cf = cu - Math.floor(cu);
      const strength = hash3(ci, 11, seed);
      const starts = [0.97, 2 / 3 - 0.02, HAZARD_BAND[0], 1 / 3 - 0.02];
      const start = starts[Math.floor(hash3(ci, 13, seed) * starts.length)]!;
      const len = 0.15 + 0.5 * hash3(ci, 17, seed);
      const across = Math.max(0, 1 - Math.abs(cf - 0.5) * (2.2 + 3 * hash3(ci, 19, seed)));
      const run = (start - v) / len;
      const along = run < 0 ? 0 : clamp01(run * 12) * clamp01(1 - run) * (0.55 + 0.45 * vnoise(u, v, seed + 5, dripCols, 8));
      const drip = strength > 0.25 ? across * along * Math.min(1, (strength - 0.25) * 2) : 0;
      r = mix(r, 30, drip * 0.8); g = mix(g, 32, drip * 0.8); b = mix(b, 20, drip * 0.8);
      rough = mix(rough, BARREL_ROUGH.grime, drip * 0.5);

      // Grime collects under the hoops and the top rim.
      const ring = Math.max(0, 1 - Math.abs(v - 1 / 3 + 0.03) * 30, 1 - Math.abs(v - 2 / 3 + 0.03) * 30, (v - 0.94) * 16);
      const ringK = 1 - 0.45 * clamp01(ring);
      r *= ringK; g *= ringK; b *= ringK;

      // Chips: the paint knocked off at the edges, to bare steel, with a rusty rim round each chip.
      const chipN = vnoise(u, v, seed + 131, 40, 24) * 0.7 + vnoise(u, v, seed + 137, 80, 48) * 0.3;
      const chipT = 0.88 - 0.2 * edge;
      const chip = clamp01((chipN - chipT) * 14);
      const chipRim = clamp01((chipN - chipT + 0.06) * 10) * (1 - chip);
      // Scratches through the paint.
      const sc = scratches[y * w + x]! * (0.35 + 0.4 * vnoise(u, v, seed + 141, 16));

      // Rust: blooms round the edges and the foot, from the chips, and runs down under the hoops.
      const rustN = fbm(u, v, seed + 151, 10);
      const hoopRun = hoops.reduce((acc, c) => {
        const below = c - 0.012 - v;
        if (below < 0 || below > 0.2) return acc;
        const col = vnoise(u, 0, seed + 161, 64, 1), reach = 0.04 + 0.16 * vnoise(u, 0.5, seed + 163, 37, 1);
        return Math.max(acc, clamp01((col - 0.55) * 4) * clamp01(1 - below / reach));
      }, 0);
      const foot = clamp01((0.16 - v) * 7);
      const rustW = clamp01((rustN - 0.5) * 3 + edge * 0.75 + foot * 0.9 + chipRim * 0.8 + hoopRun * 0.8 + sc * 0.3 - 0.35);
      const rn = 0.75 + 0.5 * vnoise(u, v, seed + 171, 32);
      const deep = clamp01((rustN - 0.45) * 3);
      const rr = mix(RUST[0], RUST_DARK[0], deep) * rn, rg = mix(RUST[1], RUST_DARK[1], deep) * rn, rb = mix(RUST[2], RUST_DARK[2], deep) * rn;
      r = mix(r, rr, rustW); g = mix(g, rg, rustW); b = mix(b, rb, rustW);
      rough = mix(rough, BARREL_ROUGH.rust, rustW);

      // Bare steel last (a fresh chip or scratch shows through the rust too), dulled by grime.
      const bare = Math.max(chip, sc) * (1 - 0.5 * foot);
      const bk = (0.75 + 0.35 * vnoise(u, v, seed + 181, 24)) * (1 - 0.35 * dirt);
      r = mix(r, BARE[0] * bk, bare); g = mix(g, BARE[1] * bk, bare); b = mix(b, BARE[2] * bk, bare);
      rough = mix(rough, BARREL_ROUGH.bare, bare);

      // Grime: darker toward the floor, plus fine grit.
      const grime = (0.45 + 0.55 * Math.sqrt(v)) * (0.9 + 0.2 * hash3(x, y, seed + 7));
      const i = (y * w + x) * 4;
      out[i] = Math.min(255, Math.round(r * grime));
      out[i + 1] = Math.min(255, Math.round(g * grime));
      out[i + 2] = Math.min(255, Math.round(b * grime));
      out[i + 3] = Math.round(255 * clamp01(rough + (1 - grime) * 0.1));
    }
  }
  return out;
}

/** The lid's albedo, RGBA8 (RGB sRGB, A = roughness × 255), n × n, planar over the lid disc (u, v = (x, −z) /
 *  lidRadius mapped to [0, 1]). Dirtier than the side: dust and grime pooled on top, rust in a ring at the rim
 *  and round both bungs, scuffs to bare steel, and a dried green crust spilt round the vent. */
export function lidAlbedo(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  const L = BARREL_LOOK.lidRadiusM, { vent, plug } = BARREL_LOOK;
  const scratches = scratchMap(scratchSet(16, n, n, seed + 950, 0.15, 0.85), n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      const px = (u * 2 - 1) * L, pz = -(v * 2 - 1) * L;      // lid metres (v up the texture = −z)
      const d = Math.hypot(px, pz) / L;
      const mottle = fbm(u, v, seed, 5);
      const dust = clamp01((fbm(u, v, seed + 21, 7) - 0.42) * 2.2);
      let r = 38, g = 44, b = 29;
      const m = 0.75 + 0.45 * mottle;
      r *= m; g *= m; b *= m;
      // Dust and grime settled on top: a dull grey-brown film.
      r = mix(r, 58, dust * 0.7); g = mix(g, 54, dust * 0.7); b = mix(b, 44, dust * 0.7);
      let rough = mix(0.82, 0.95, dust);
      // Rust at the rim (water stands in the recess) and round the bungs.
      const dv = Math.hypot(px - vent.x, pz - vent.z), dp = Math.hypot(px - plug.x, pz - plug.z);
      const rimR = clamp01((d - 0.8) * 5), bungR = clamp01(1 - (dv - vent.r) / 0.04) + clamp01(1 - (dp - plug.r) / 0.035);
      const rustN = fbm(u, v, seed + 151, 9);
      const rustW = clamp01((rustN - 0.5) * 3 + rimR * 0.9 + bungR * 0.7 - 0.25);
      const deep = clamp01((rustN - 0.45) * 3);
      r = mix(r, mix(RUST[0], RUST_DARK[0], deep), rustW); g = mix(g, mix(RUST[1], RUST_DARK[1], deep), rustW); b = mix(b, mix(RUST[2], RUST_DARK[2], deep), rustW);
      rough = mix(rough, BARREL_ROUGH.rust, rustW);
      // The dried green crust round the vent: ooze that bubbled out and set.
      const crustN = vnoise(u, v, seed + 191, 24);
      const crust = clamp01(1 - (dv - vent.r) / (0.045 + 0.03 * crustN)) * clamp01((crustN - 0.25) * 3);
      r = mix(r, 50, crust); g = mix(g, 80, crust); b = mix(b, 28, crust);
      rough = mix(rough, 0.6, crust);
      // Scuffs to bare steel.
      const sc = scratches[y * n + x]! * 0.6 * (1 - rimR);
      r = mix(r, BARE[0] * 0.8, sc); g = mix(g, BARE[1] * 0.8, sc); b = mix(b, BARE[2] * 0.8, sc);
      rough = mix(rough, BARREL_ROUGH.bare + 0.1, sc);
      // Grime darkest in the recess at the rim.
      const k = (1 - 0.45 * clamp01((d - 0.88) * 9)) * (0.9 + 0.2 * hash3(x, y, seed + 7));
      const i = (y * n + x) * 4;
      out[i] = Math.min(255, Math.round(r * k));
      out[i + 1] = Math.min(255, Math.round(g * k));
      out[i + 2] = Math.min(255, Math.round(b * k));
      out[i + 3] = Math.round(255 * clamp01(rough));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The floor scorch

/** The floor scorch's soot amount, one channel, n × n (0 = clean floor, 255 = full soot): a dark core, a sooty
 *  body with a ragged edge, blast rays streaking out past it, mottled; 0 at and beyond the inscribed circle. */
export function scorchAlpha(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      const dx = u * 2 - 1, dy = v * 2 - 1;
      const d = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
      // The body's ragged edge, two octaves round the circle.
      const edge = 0.68 + 0.2 * vnoise(ang, 0, seed, 9, 1) + 0.1 * vnoise(ang, 0, seed + 1, 23, 1);
      const body = 1 - smooth(clamp01((d - edge * 0.55) / (edge * 0.45)));
      // Rays: narrow streaks round the circle, reaching past the body.
      const ray = clamp01((vnoise(ang, 0, seed + 2, 48, 1) - 0.55) * 3.5) * (0.6 + 0.4 * vnoise(ang, 0, seed + 4, 13, 1));
      const rayReach = edge + 0.25 * ray;
      const rays = ray * (1 - smooth(clamp01((d - edge * 0.7) / Math.max(0.05, rayReach - edge * 0.7)))) * 0.75;
      // The core: the floor right under the drum, burnt black.
      const core = 1 - smooth(clamp01((d - 0.12) / 0.22));
      const grit = 0.82 + 0.18 * vnoise(u, v, seed + 3, 16) + 0.1 * (hash3(x, y, seed + 5) - 0.5);
      const a = Math.max(body * 0.66 * grit, rays * 0.85 * grit, core) * clamp01((1 - d) * 6);
      out[y * n + x] = Math.round(255 * clamp01(a));
    }
  }
  return out;
}

/** The biggest scorch edge (m, maxM down to minM) the floor round (x, z) can take: shrinks until every probe ring
 *  point at 0.42 × edge either has floor at least as high as the scorch's (y) or is off the map (wall), so a scorch
 *  never hangs over a lower floor at a ledge. `floorAt` returns NaN off the map. */
export function scorchFit(floorAt: (x: number, z: number) => number, x: number, z: number, y: number,
  maxM: number = BARREL_LOOK.scorchM, minM: number = BARREL_LOOK.scorchMinM): number {
  for (let size = maxM; size > minM; size -= 0.1) {
    const r = size * 0.42;
    let ok = true;
    for (let k = 0; k < 16 && ok; k++) {
      const a = (k / 16) * Math.PI * 2;
      const f = floorAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (!Number.isNaN(f) && f < y - 0.02) ok = false;
    }
    if (ok) return size;
  }
  return minM;
}

/** The scorch as an opaque soot mask, one channel, n × n, 0 or 255: a texel is soot where its scorchAlpha amount
 *  beats a clumpy seeded threshold (fine grit over a mid-scale mottle), so the amount becomes soot DENSITY — solid
 *  in the core, speckled grit in the body, sparse flecks at the ragged edge. The view draws it opaque and
 *  alpha-tested in the level's own pass (a blended darkening never reached the floor it lay on — see
 *  game-barrel-view createScorchPool); mips average it back toward the amount at a distance. */
export function scorchMask(n: number, seed = 1): Uint8Array {
  const amount = scorchAlpha(n, seed);
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n, v = (y + 0.5) / n;
      const t = 0.55 * hash3(x, y, seed + 9) + 0.3 * vnoise(u, v, seed + 11, 48) + 0.15 * vnoise(u, v, seed + 13, 12);
      const a = amount[y * n + x]! / 255;
      out[y * n + x] = a > 0.02 && Math.pow(a, 0.6) >= t * 0.98 ? 255 : 0;
    }
  }
  return out;
}
