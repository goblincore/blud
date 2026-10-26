// src/game/level/panel-textures.ts
//
// PROCEDURAL INDUSTRIAL SURFACES for sector levels (the Doom-derived maps): tech panels, metal sheet,
// door steel, rusted brick, a lit grid panel, concrete slabs, diamond plate and floor tiles. The same
// recipe as stone-textures.ts — a height field, its central-difference normal map, an sRGB albedo and
// a roughness map — generated, never shipped as art (no WAD or extracted texture is involved).
//
// Every map is PANEL_SIZE square and covers PANEL_TILE_M metres (128 px a metre, the stone set's
// density is 128 px/m too: 256 px over its 2 m tile), and it TILES: the noise lattice wraps at the
// map edge and every pattern period divides PANEL_SIZE. Image row y runs UP the wall (the sector mesh
// writes v = world y / tile), so dirt streaks run toward row 0.
//
// The look is the game's: dark, dank and grimy, cold greys with rust as the one warm note. Albedo
// sits in the stone set's range (≈ 50..140 sRGB) because the sector mesh multiplies it by the
// level palette's dark tint; the plain-node-material warning (white under the torch) applies.
//
// The CORE is pure: no canvas, no three, no DOM. `panelTextures` wraps it as DataTextures.
import * as THREE from 'three';
import { hash2 } from './stone-textures';
import {
  EX_FRAME_PX, exitLetterAt, FL_CELL_H, FL_CELL_W, FL_END_PX, FL_FRAME_PX, FL_TUBES, FL_TUBE_HALF,
  SB_CELL_PX, SB_CELL_TYPES, SB_GLASS, SB_GLASS_R, SB_LEDS, SB_LED_R, VS_CELL_PX, VS_FRAME_PX,
} from './emitter-layout';

export const PANEL_SIZE = 512;
/** World metres one map covers. */
export const PANEL_TILE_M = 4;
const PX_PER_M = PANEL_SIZE / PANEL_TILE_M;

export type PanelKind =
  | 'techPanel' | 'metalSheet' | 'door' | 'rustBrick' | 'lightPanel'
  | 'concreteSlab' | 'metalPlate' | 'floorTile'
  | 'screenBank' | 'viewscreen' | 'fluorescent' | 'exitSign';
export const PANEL_KINDS: readonly PanelKind[] = [
  'techPanel', 'metalSheet', 'door', 'rustBrick', 'lightPanel', 'concreteSlab', 'metalPlate', 'floorTile',
  'screenBank', 'viewscreen', 'fluorescent', 'exitSign',
];
/** The self-lit kinds whose glow is ANIMATED in the shader (webgpu/emitter-glow.wgsl.ts): their
 *  `emissive` map is a LINEAR mask (R and G channels per kind, emitter-layout.ts), not a colour. */
export const EMITTER_PANEL_KINDS: readonly PanelKind[] = ['screenBank', 'viewscreen', 'fluorescent', 'exitSign'];
export const isEmitterPanel = (k: PanelKind): boolean => EMITTER_PANEL_KINDS.includes(k);
/** Kinds with a glow map at all. */
export const panelGlows = (k: PanelKind): boolean => k === 'lightPanel' || isEmitterPanel(k);

export interface PanelMaps {
  albedo: Uint8ClampedArray;     // RGBA, sRGB
  normal: Uint8ClampedArray;     // RGBA, linear tangent-space
  roughness: Uint8ClampedArray;  // ONE channel, linear (PANEL_SIZE² bytes)
  /** lightPanel: RGBA sRGB glow colour × strength. Emitter kinds: RGBA LINEAR mask (R, G per kind).
   *  null for a kind that does not glow. */
  emissive: Uint8ClampedArray | null;
  /** The height field 0..1 (tests read it). */
  height: Float32Array;
}

const N = PANEL_SIZE;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, v: number) => { const t = clamp01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const wrapPx = (i: number) => ((i % N) + N) % N;

/** The hashed lattice values for (seed, px × py cells), cached: the noise reads them instead of
 *  hashing four corners per sample (most of the generation cost). Cleared after each map. */
const lattices = new Map<number, Float32Array>();
function lattice(seed: number, px: number, py: number): Float32Array {
  const key = (seed * 1024 + px) * 1024 + py;
  let l = lattices.get(key);
  if (!l) {
    l = new Float32Array(px * py);
    for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) l[y * px + x] = hash2(x, y, seed);
    lattices.set(key, l);
  }
  return l;
}
/** Value noise on a lattice of `cellX` × `cellY` px that wraps at the map edge on both axes (each
 *  cell size divides PANEL_SIZE, so the lattice periods are N / cellX and N / cellY cells). */
function tnoise2(x: number, y: number, seed: number, cellX: number, cellY: number): number {
  const px = N / cellX, py = N / cellY;
  const sx = x / cellX, sy = y / cellY;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = sx - x0, fy = sy - y0;
  const ex = fx * fx * (3 - 2 * fx), ey = fy * fy * (3 - 2 * fy);
  const xa = ((x0 % px) + px) % px, xb = (xa + 1) % px, ya = ((y0 % py) + py) % py, yb = (ya + 1) % py;
  const L = lattice(seed, px, py);
  const n00 = L[ya * px + xa]!, n10 = L[ya * px + xb]!, n01 = L[yb * px + xa]!, n11 = L[yb * px + xb]!;
  return (n00 * (1 - ex) + n10 * ex) * (1 - ey) + (n01 * (1 - ex) + n11 * ex) * ey;
}
/** Square-cell tileable value noise (cell divides PANEL_SIZE). */
const tnoise = (x: number, y: number, seed: number, cell: number): number => tnoise2(x, y, seed, cell, cell);
/** Tileable fbm from `cell` px down, halving each octave (not below 2 px). */
function tfbm(x: number, y: number, seed: number, cell: number, octaves = 3): number {
  let sum = 0, amp = 0.5, norm = 0, c = cell;
  for (let o = 0; o < octaves; o++) {
    sum += tnoise(x, y, seed + o * 101, c) * amp; norm += amp;
    c = Math.max(2, c / 2); amp *= 0.5;
  }
  return sum / norm;
}
/** Anisotropic tileable noise: cells cx × cy px (streaks, brushing); both must divide PANEL_SIZE. */
export function tstreak(x: number, y: number, seed: number, cx: number, cy: number): number {
  return tnoise2(x, y, seed, cx, cy);
}

/** Distance in px to the nearest edge of a w × h box for a point (lx, ly) inside it (negative outside). */
const boxEdge = (lx: number, ly: number, w: number, h: number) => Math.min(lx, ly, w - lx, h - ly);
/** A recessed seam profile: 0 at the seam's centre, 1 on the face past `bevel` px. */
const seam = (edge: number, groove: number, bevel: number) => smooth(groove, groove + bevel, edge);
/** A rivet / bolt dome of radius r px centred (cx, cy): 0..1. */
const dome = (x: number, y: number, cx: number, cy: number, r: number) => {
  const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
  return d2 >= 1 ? 0 : Math.sqrt(1 - d2);
};
/** Scratch segments per (seed, cell, density), one record per lattice cell: x, y (cell-local
 *  offset in px), dx, dy, half length, strength (0 = no scratch). Built once per map, not per pixel. */
const SCRATCH_STRIDE = 6;
const scratchTables = new Map<number, Float32Array>();
function scratchTable(seed: number, cell: number, density: number): Float32Array {
  const key = (seed * 1024 + cell) * 1024 + Math.round(density * 1000);
  let t = scratchTables.get(key);
  if (t) return t;
  const p = N / cell;
  t = new Float32Array(p * p * SCRATCH_STRIDE);
  for (let wy = 0; wy < p; wy++) for (let wx = 0; wx < p; wx++) {
    const o = (wy * p + wx) * SCRATCH_STRIDE;
    if (hash2(wx, wy, seed) > density) continue;
    const ang = hash2(wx, wy, seed + 3) * Math.PI;
    t[o] = hash2(wx, wy, seed + 1) * cell; t[o + 1] = hash2(wx, wy, seed + 2) * cell;
    t[o + 2] = Math.cos(ang); t[o + 3] = Math.sin(ang);
    t[o + 4] = cell * (0.4 + hash2(wx, wy, seed + 4) * 0.9) / 2;
    t[o + 5] = 0.5 + 0.5 * hash2(wx, wy, seed + 5);
  }
  if (scratchTables.size > 64) scratchTables.clear();
  scratchTables.set(key, t);
  return t;
}
/** Thin random scratches: one per `cell` px cell, a short segment at a random angle; 0..1 strength. */
function scratches(x: number, y: number, seed: number, cell: number, density: number): number {
  const table = scratchTable(seed, cell, density);
  const p = N / cell;
  let best = 0;
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = gx + ox, cy = gy + oy;
    const wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
    const o = (wy * p + wx) * SCRATCH_STRIDE;
    const strength = table[o + 5]!;
    if (strength === 0) continue;
    const rx = x - (cx * cell + table[o]!), ry = y - (cy * cell + table[o + 1]!);
    const dx = table[o + 2]!, dy = table[o + 3]!;
    if (Math.abs(rx * dx + ry * dy) > table[o + 4]!) continue;
    const d = Math.abs(rx * dy - ry * dx);
    if (d >= 1.1) continue;
    best = Math.max(best, (1 - smooth(0.3, 1.1, d)) * strength);
  }
  return best;
}

/** `flat` (0..1): how much of the damage relief and grime roughness a pixel skips — glass, diffusers
 *  and acrylic stay smooth (a bumpy glass face lays a pale veil under the torch). */
interface Px { h: number; r: number; g: number; b: number; rough: number; e: number; e2: number; flat: number }

type Shader = (x: number, y: number, seed: number, o: Px) => void;

// --- the kinds -------------------------------------------------------------------------------------

/** Tech panels: 1 m columns cut into panels, recessed seams, corner rivets; some panels carry vent
 *  slats, an inset dark screen or a raised plate. Cold blue-grey, grime streaks. */
const techPanel: Shader = (x, y, seed, o) => {
  const col = Math.floor(x / 128);
  const rows = col % 2 === 0 ? [0, 128, 384, 512] : [0, 256, 384, 512];
  let r0 = 0, r1 = 512;
  for (let k = 0; k < rows.length - 1; k++) if (y >= rows[k]! && y < rows[k + 1]!) { r0 = rows[k]!; r1 = rows[k + 1]!; }
  const lx = x - col * 128, ly = y - r0, w = 128, h = r1 - r0;
  const edge = boxEdge(lx, ly, w, h);
  const s = seam(edge, 2, 3);
  let height = 0.12 + 0.5 * s;
  let shade = 0.9 + 0.18 * hash2(col, r0, seed + 9);
  let rough = 0.55;
  let tint: [number, number, number] = [82, 90, 94];
  const feature = Math.floor(hash2(col, r0, seed + 7) * 5);
  const fw = w * 0.62, fh = Math.min(h * 0.5, 120), fx0 = (w - fw) / 2, fy0 = (h - fh) / 2;
  const inF = lx > fx0 && lx < fx0 + fw && ly > fy0 && ly < fy0 + fh;
  if (feature === 1 && inF) {                        // vent slats
    const sl = (ly - fy0) % 10;
    const slat = smooth(2, 4, sl) * (1 - smooth(7, 9, sl));
    height = 0.2 + 0.32 * slat;
    shade *= 0.45 + 0.5 * slat;
    rough = 0.75;
  } else if (feature === 2 && inF) {                 // a recessed dark screen
    const e2 = boxEdge(lx - fx0, ly - fy0, fw, fh);
    height = 0.62 - 0.3 * smooth(0, 3, e2);
    tint = [34, 46, 44]; shade = 1;
    rough = 0.22;
  } else if (feature === 3) {                        // a raised inner plate
    const e2 = boxEdge(lx - 14, ly - 14, w - 28, h - 28);
    if (e2 > 0) height += 0.14 * smooth(0, 3, e2);
  }
  for (const [cx, cy] of [[9, 9], [w - 9, 9], [9, h - 9], [w - 9, h - 9]] as const) {
    const d = dome(lx, ly, cx, cy, 3.6);
    if (d > 0) { height += 0.22 * d; shade = Math.max(shade, 1.05); rough = 0.4; }
  }
  const grime = tfbm(x, y, seed + 31, 64);
  const streak = tstreak(x, y, seed + 41, 4, 128);
  const dirt = clamp01(grime * 0.8 + streak * 0.5 - 0.35);
  const groove = 1 - s;
  const k = shade * (1 - 0.45 * dirt) * (1 - 0.5 * groove) * (0.94 + 0.12 * tnoise(x, y, seed + 51, 4));
  o.h = height; o.r = tint[0] * k; o.g = tint[1] * k; o.b = tint[2] * k;
  o.rough = clamp01(rough + 0.28 * dirt + 0.3 * groove); o.e = 0;
};

/** Metal sheet: 1 m wide vertical sheets, brushed along their length, riveted seams, dents and
 *  scratches. Neutral steel grey. */
const metalSheet: Shader = (x, y, seed, o) => {
  const lx = x % 128, ly = y % 256;
  const edge = Math.min(lx, 128 - lx, ly, 256 - ly);
  const s = seam(edge, 1.5, 2.5);
  let height = 0.2 + 0.4 * s + 0.12 * tfbm(x, y, seed + 3, 128, 2);
  let bright = 0;
  for (const cx of [7, 121]) {
    const d = dome(lx, ((ly % 32) + 32) % 32, cx, 16, 3);
    if (d > 0) { height += 0.25 * d; bright = 0.1; }
  }
  const brush = tstreak(x, y, seed + 11, 2, 64);
  const sc = scratches(x, y, seed + 21, 32, 0.55);
  const grime = clamp01(tfbm(x, y, seed + 31, 128) * 1.2 - 0.3 + tstreak(x, y, seed + 41, 8, 256) * 0.4 - 0.2);
  const k = (0.92 + 0.14 * brush + bright + 0.35 * sc) * (1 - 0.5 * grime) * (1 - 0.5 * (1 - s));
  o.h = height; o.r = 90 * k; o.g = 92 * k; o.b = 96 * k;
  o.rough = clamp01(0.42 + 0.1 * brush - 0.18 * sc + 0.35 * grime + 0.3 * (1 - s)); o.e = 0;
};

/** Door steel: heavy plates in 0.5 m horizontal bands with recessed bolted channels, a frame strip
 *  at the tile's sides, deep scratches and grime in the channels. */
const door: Shader = (x, y, seed, o) => {
  const ly = y % 64;
  const band = 1 - (smooth(0, 3, ly) * (1 - smooth(48, 51, ly)));  // 1 in the 13 px channel (rows 51..64)
  const frame = Math.min(x + 0.5, N - 0.5 - x);          // symmetric about the wrap edge, so the frame tiles
  const inFrame = frame < 22;
  let height = 0.55 - 0.32 * band;
  if (inFrame) height = 0.75 - 0.3 * (1 - smooth(0, 3, frame));
  let bolt = 0;
  if (!inFrame && band > 0.5) bolt = dome(x % 32, ly, 16, 57.5, 3.4);
  else if (inFrame) bolt = dome(frame, y % 48, 11, 24, 3.4);
  height += 0.22 * bolt;
  const sc = scratches(x, y, seed + 21, 32, 0.8);
  const dent = tfbm(x, y, seed + 3, 128, 2);
  height += 0.08 * dent;
  const grime = clamp01(tfbm(x, y, seed + 31, 64) * 1.1 - 0.35 + 0.5 * band + tstreak(x, y, seed + 41, 8, 128) * 0.35 - 0.15);
  const base = inFrame ? 0.78 : 1;
  const k = base * (0.95 + 0.3 * sc + 0.15 * bolt) * (1 - 0.55 * grime) * (1 - 0.35 * band);
  o.h = height; o.r = 98 * k; o.g = 98 * k; o.b = 102 * k;
  o.rough = clamp01(0.38 - 0.16 * sc + 0.4 * grime + 0.2 * band); o.e = 0;
};

/** Rusted brick: 0.5 × 0.25 m bricks, staggered, dark mortar, brick-to-brick brown/rust variation,
 *  rust stains running down. The one warm material. */
const rustBrick: Shader = (x, y, seed, o) => {
  const row = Math.floor(y / 32);
  const off = (row % 2) * 32;
  const bx = Math.floor(wrapPx(x + off) / 64);
  const lx = wrapPx(x + off) - bx * 64, ly = y - row * 32;
  const edge = boxEdge(lx, ly, 64, 32);
  const chip = hash2(bx, row, seed + 3);
  const face = seam(edge, 2, 2.5 + chip * 2);
  const grain = tfbm(x, y, seed, 32) * 0.3 + tnoise(x, y, seed + 7, 4) * 0.12;
  const height = clamp01(face * (0.72 - chip * 0.12) + grain);
  const v = hash2(bx, row, seed + 5);
  const brick: [number, number, number] = v < 0.33 ? [96, 72, 60] : v < 0.66 ? [118, 80, 58] : [104, 86, 74];
  const stain = clamp01(tstreak(x, y, seed + 41, 8, 128) * 1.4 - 0.55 + tfbm(x, y, seed + 31, 128) * 0.5 - 0.2);
  const wet = clamp01(tfbm(x, y, seed + 61, 64) * 1.8 - 0.9);
  const shade = (0.62 + 0.45 * height) * (1 - 0.35 * wet);
  const mortar = 1 - face;
  const r = (brick[0] * (1 - mortar) + 58 * mortar) * shade, g = (brick[1] * (1 - mortar) + 55 * mortar) * shade, b = (brick[2] * (1 - mortar) + 52 * mortar) * shade;
  // Rust stains pull toward a dark orange-brown.
  o.r = r * (1 - 0.35 * stain) + 104 * 0.35 * stain; o.g = g * (1 - 0.45 * stain) + 52 * 0.45 * stain; o.b = b * (1 - 0.55 * stain) + 30 * 0.55 * stain;
  o.h = height; o.rough = clamp01(0.86 - 0.5 * wet + 0.08 * mortar); o.e = 0;
};

/** A lit grid panel: 1 m cells of a diffuser behind a fine lattice, in a dark frame; a few cells
 *  have failed or dim. Emissive is the diffuser (modest: the sector mesh scales it by the sector light). */
const lightPanel: Shader = (x, y, seed, o) => {
  const cx = Math.floor(x / 128), cy = Math.floor(y / 128);
  const lx = x - cx * 128, ly = y - cy * 128;
  const edge = boxEdge(lx, ly, 128, 128);
  const inCell = smooth(12, 15, edge);
  const lat = Math.min(lx % 16, 16 - (lx % 16), ly % 16, 16 - (ly % 16));
  const lattice = 1 - smooth(0.6, 1.6, lat);
  // A third of the cells have failed or are dying: off, a dim ember, or half-lit.
  const fh = hash2(cx, cy, seed);
  const failed = fh < 0.12 ? 0.04 : fh < 0.24 ? 0.18 : fh < 0.34 ? 0.45 : 1;
  const vignette = 0.75 + 0.25 * smooth(12, 60, edge);
  const grime = tfbm(x, y, seed + 31, 64);
  const glow = inCell * (1 - 0.55 * lattice) * vignette * failed * (0.85 + 0.15 * grime);
  const frameBolt = dome(lx, ly, 6, 6, 2.6) + dome(lx, ly, 122, 122, 2.6);
  o.h = 0.7 * (1 - inCell) + inCell * (0.3 + 0.08 * lattice) + 0.2 * frameBolt;
  const fr = 58 * (0.85 + 0.3 * tnoise(x, y, seed + 51, 8));
  const cell = 150 * (1 - 0.3 * grime) * (1 - 0.4 * lattice);
  o.r = fr * (1 - inCell) + cell * inCell; o.g = fr * (1 - inCell) + cell * 1.04 * inCell; o.b = fr * (1 - inCell) + cell * 0.98 * inCell;
  o.rough = clamp01(0.6 * (1 - inCell) + 0.3 * inCell); o.e = glow;
};

/** Concrete slabs: 2 m slabs, joints, formwork tie holes, pitting and water stains. */
const concreteSlab: Shader = (x, y, seed, o) => {
  const sx = Math.floor(x / 256), sy = Math.floor(y / 256);
  const lx = x - sx * 256, ly = y - sy * 256;
  const edge = boxEdge(lx, ly, 256, 256);
  const s = seam(edge, 2, 3);
  let height = 0.2 + 0.45 * s + 0.1 * tfbm(x, y, seed, 64);
  let hole = 0;
  for (const [hx, hy] of [[64, 64], [192, 64], [64, 192], [192, 192]] as const) {
    const d = Math.hypot(lx - hx, ly - hy);
    hole = Math.max(hole, 1 - smooth(4, 6.5, d));
  }
  height -= 0.35 * hole;
  const pit = tnoise(x, y, seed + 13, 4) > 0.86 ? 1 : 0;
  height -= 0.12 * pit;
  const stain = clamp01(tfbm(x, y, seed + 31, 128) * 1.6 - 0.65);
  const streak = clamp01(tstreak(x, y, seed + 41, 8, 256) * 1.3 - 0.6);
  const shade = (0.9 + 0.12 * hash2(sx, sy, seed + 9)) * (0.92 + 0.14 * tnoise(x, y, seed + 51, 8));
  const k = shade * (1 - 0.35 * stain - 0.25 * streak) * (1 - 0.45 * (1 - s)) * (1 - 0.6 * hole) * (1 - 0.35 * pit);
  o.h = height; o.r = 104 * k; o.g = 103 * k; o.b = 100 * k;
  o.rough = clamp01(0.92 - 0.3 * stain); o.e = 0;
};

/** Diamond plate: 2 m plates with riveted seams, a tread of raised lozenges (alternating at
 *  ±45°, 16 px period); the raised lozenges are worn bright and smooth, the low ground grimy. */
const metalPlate: Shader = (x, y, seed, o) => {
  const lx = x % 256, ly = y % 256;
  const edge = boxEdge(lx, ly, 256, 256);
  const s = seam(edge, 1.5, 2.5);
  const gx = Math.floor(x / 16), gy = Math.floor(y / 16);
  const ux = (x % 16) - 8, uy = (y % 16) - 8;
  const flip = (gx + gy) % 2 === 0;
  const a = (flip ? ux + uy : ux - uy) / Math.SQRT2, b = (flip ? ux - uy : ux + uy) / Math.SQRT2;
  const loz = Math.abs(a) / 6 + Math.abs(b) / 1.8;
  const raised = 1 - smooth(0.75, 1.05, loz);
  let height = 0.25 + 0.3 * s + 0.3 * raised * s;
  let rivet = 0;
  if (edge < 12) {
    const along = edge === lx || edge === 256 - lx ? ly : lx;
    const across = Math.min(lx, 256 - lx, ly, 256 - ly);
    rivet = dome(across, ((along % 32) + 32) % 32, 7, 16, 3);
    height += 0.25 * rivet;
  }
  const grime = clamp01(tfbm(x, y, seed + 31, 64) * 1.3 - 0.35);
  const wear = raised * (0.6 + 0.4 * tfbm(x, y, seed + 71, 128));
  const k = (0.78 + 0.4 * wear + 0.15 * rivet) * (1 - 0.5 * grime * (1 - raised)) * (1 - 0.5 * (1 - s)) * (0.95 + 0.1 * tnoise(x, y, seed + 51, 4));
  o.h = height; o.r = 82 * k; o.g = 84 * k; o.b = 87 * k;
  o.rough = clamp01(0.62 - 0.3 * wear + 0.25 * grime); o.e = 0;
};

/** Floor tiles: 0.5 m glazed tiles, dirty grout, per-tile shade, chipped corners and cracks. */
const floorTile: Shader = (x, y, seed, o) => {
  const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
  const lx = x - tx * 64, ly = y - ty * 64;
  const id = hash2(tx, ty, seed);
  let edge = boxEdge(lx, ly, 64, 64);
  // A chipped corner: a quarter disc missing from one corner of a few tiles.
  if (id < 0.18) {
    const c = Math.floor(hash2(tx, ty, seed + 1) * 4);
    const cx = c % 2 ? 64 : 0, cy = c >= 2 ? 64 : 0;
    edge = Math.min(edge, Math.hypot(lx - cx, ly - cy) - 9);
  }
  const face = seam(edge, 2, 1.5);
  let crack = 0;
  if (id > 0.82) {
    const ang = hash2(tx, ty, seed + 2) * Math.PI, dx = Math.cos(ang), dy = Math.sin(ang);
    const wob = (tnoise(x, y, seed + 3, 8) - 0.5) * 3;
    crack = 1 - smooth(0.3, 1.0, Math.abs((lx - 32) * dy - (ly - 32) * dx + wob));
  }
  const height = 0.15 + 0.5 * face - 0.2 * crack * face;
  const grime = clamp01(tfbm(x, y, seed + 31, 128) * 1.4 - 0.45);
  const shade = 0.86 + 0.2 * hash2(tx, ty, seed + 9);
  const tile: [number, number, number] = [100, 106, 100];
  const grout = 1 - face;
  const k = shade * (1 - 0.4 * grime) * (1 - 0.5 * crack);
  o.r = (tile[0] * face + 54 * grout) * k; o.g = (tile[1] * face + 52 * grout) * k; o.b = (tile[2] * face + 48 * grout) * k;
  o.h = height; o.rough = clamp01(0.3 + 0.35 * grime + 0.55 * grout); o.e = 0;
};


// --- the emitter kinds (static parts; the glow is animated in the shader) ----------------------------

/** Signed distance (px) to a rounded rect [x0, y0, x1, y1] of corner radius rad: negative inside. */
function rrect(lx: number, ly: number, r: readonly [number, number, number, number], rad: number): number {
  const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, hx = (r[2] - r[0]) / 2 - rad, hy = (r[3] - r[1]) / 2 - rad;
  const qx = Math.abs(lx - cx) - hx, qy = Math.abs(ly - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
}

/** Screen bank: 1 m bezel cells (dark green-grey enamel, recessed seams, corner screws), CRT glass
 *  with a raised lip and a slight bulge, LED lenses, paler label strips; dirt in the seams and on the
 *  glass. e = glass (dimmed by grime and scratches), e2 = LED lenses. */
const screenBank: Shader = (x, y, seed, o) => {
  const cx = Math.floor(x / SB_CELL_PX), cy = Math.floor(y / SB_CELL_PX);
  const lx = x - cx * SB_CELL_PX, ly = y - cy * SB_CELL_PX;
  const ty = SB_CELL_TYPES[cy * 4 + cx]!;
  const edge = boxEdge(lx, ly, SB_CELL_PX, SB_CELL_PX);
  const s = seam(edge, 2, 3);
  let height = 0.3 + 0.35 * s;
  let tint: [number, number, number] = [62, 68, 63];
  let rough = 0.52;
  let e = 0, e2 = 0;
  const shade = 0.9 + 0.16 * hash2(cx, cy, seed + 9);
  const grime = tfbm(x, y, seed + 31, 64);
  const dirt = clamp01(grime * 0.9 + tstreak(x, y, seed + 41, 4, 128) * 0.45 - 0.4);
  const sc = scratches(x, y, seed + 21, 32, 0.6);
  for (const r of SB_GLASS[ty]!) {
    const d = rrect(lx, ly, r, SB_GLASS_R);
    if (d < 0) {
      const w = (r[2] - r[0]) / 2, h = (r[3] - r[1]) / 2;
      const nx = (lx - (r[0] + r[2]) / 2) / w, ny = (ly - (r[1] + r[3]) / 2) / h;
      height = 0.18 + 0.07 * (1 - Math.min(1, nx * nx + ny * ny));
      tint = [20, 25, 23];
      rough = 0.12 + 0.25 * sc + 0.2 * dirt;
      e = smooth(0, 1.5, -d) * (1 - 0.55 * dirt) * (1 - 0.3 * sc);
      o.flat = smooth(0, 3, -d);
    } else if (d < 5) {
      height = Math.max(height, 0.62 - 0.08 * d);      // the raised lip round the glass
      tint = [44, 48, 46];
    }
  }
  const [lx0, ly0, ldx, count, rowsN, ldy] = SB_LEDS[ty]!;
  for (let j = 0; j < rowsN; j++) for (let i = 0; i < count; i++) {
    const dm = dome(lx, ly, lx0 + i * ldx, ly0 + j * ldy, SB_LED_R);
    const ring = dome(lx, ly, lx0 + i * ldx, ly0 + j * ldy, SB_LED_R + 1.6);
    if (ring > 0 && dm === 0) { tint = [30, 32, 31]; height = Math.max(height, 0.55); }
    if (dm > 0) { height = 0.5 + 0.2 * dm; tint = [46, 34, 32]; rough = 0.2; e2 = smooth(0, 0.35, dm); }
  }
  // Paler label strips on some cells (no text: a silkscreened plate).
  if (hash2(cx, cy, seed + 13) < 0.6 && ly > 4 && ly < 10 && lx > 14 && lx < 14 + 40 + 40 * hash2(cx, cy, seed + 14)) { tint = [96, 98, 90]; height += 0.04; }
  for (const [qx, qy] of [[6, 6], [SB_CELL_PX - 6, 6], [6, SB_CELL_PX - 6], [SB_CELL_PX - 6, SB_CELL_PX - 6]] as const) {
    const dm = dome(lx, ly, qx, qy, 2.8);
    if (dm > 0) { height += 0.2 * dm; tint = [72, 74, 72]; rough = 0.4; }
  }
  const k = shade * (1 - 0.45 * dirt) * (1 - 0.5 * (1 - s)) * (0.94 + 0.12 * tnoise(x, y, seed + 51, 4));
  o.h = height; o.r = tint[0] * k; o.g = tint[1] * k; o.b = tint[2] * k;
  o.rough = clamp01(rough + 0.2 * dirt * (e > 0 ? 0 : 1)); o.e = e; o.e2 = e2;
};

/** Viewscreen: 2 m screens in a heavy bolted frame with an inner bevel; dark smoky glass, scratched
 *  and smeared. e = glass. */
const viewscreen: Shader = (x, y, seed, o) => {
  const cx = Math.floor(x / VS_CELL_PX), cy = Math.floor(y / VS_CELL_PX);
  const lx = x - cx * VS_CELL_PX, ly = y - cy * VS_CELL_PX;
  const edge = boxEdge(lx, ly, VS_CELL_PX, VS_CELL_PX);
  const s = seam(edge, 2, 3);
  const glassR: [number, number, number, number] = [VS_FRAME_PX, VS_FRAME_PX, VS_CELL_PX - VS_FRAME_PX, VS_CELL_PX - VS_FRAME_PX];
  const d = rrect(lx, ly, glassR, 6);
  const grime = tfbm(x, y, seed + 31, 64);
  const dirt = clamp01(grime * 0.9 + tstreak(x, y, seed + 41, 4, 128) * 0.5 - 0.42);
  const sc = scratches(x, y, seed + 21, 32, 0.7);
  const smear = clamp01(tfbm(x, y, seed + 61, 128) * 1.6 - 0.75);
  let height: number, rough: number, e = 0;
  let tint: [number, number, number];
  if (d < 0) {
    height = 0.2; tint = [22, 25, 30];
    rough = 0.1 + 0.25 * sc + 0.15 * dirt + 0.15 * smear;
    e = smooth(0, 2, -d) * (1 - 0.5 * dirt) * (1 - 0.35 * sc) * (1 - 0.3 * smear);
    o.flat = smooth(0, 3, -d);
  } else {
    // The frame: an inner bevel down to the glass, bolts along it, the cell seam outside.
    height = 0.35 + 0.35 * s + 0.25 * smooth(0, 8, d);
    tint = [60, 62, 66]; rough = 0.5;
    const along = Math.min(lx, ly, VS_CELL_PX - lx, VS_CELL_PX - ly) === lx || Math.min(lx, ly, VS_CELL_PX - lx, VS_CELL_PX - ly) === VS_CELL_PX - lx ? ly : lx;
    const bolt = dome(Math.min(edge, 30), ((along % 32) + 32) % 32, 9, 16, 3);
    if (bolt > 0 && d > 3) { height += 0.22 * bolt; tint = [78, 80, 82]; rough = 0.38; }
  }
  const k = (1 - 0.45 * dirt * (d < 0 ? 0.4 : 1)) * (1 - 0.5 * (1 - s)) * (0.94 + 0.12 * tnoise(x, y, seed + 51, 4)) * (1 + 0.5 * sc * (d < 0 ? 1 : 0));
  o.h = height; o.r = tint[0] * k; o.g = tint[1] * k; o.b = tint[2] * k;
  o.rough = clamp01(rough); o.e = e; o.e2 = 0;
};

/** Fluorescent troffers: 1 × 2 m, a dingy enamel frame, a prismatic diffuser over two tubes (their
 *  bands brighter, the cathode ends dark), dirt and dead-insect blotches in the diffuser. e = tube A
 *  and half the diffuser, e2 = tube B and the other half (so the shader can drop one tube). */
const fluorescent: Shader = (x, y, seed, o) => {
  const cx = Math.floor(x / FL_CELL_W), cy = Math.floor(y / FL_CELL_H);
  const lx = x - cx * FL_CELL_W, ly = y - cy * FL_CELL_H;
  const edge = boxEdge(lx, ly, FL_CELL_W, FL_CELL_H);
  const s = seam(edge, 1.5, 2.5);
  const inD = smooth(FL_FRAME_PX, FL_FRAME_PX + 2, edge);
  const grime = tfbm(x, y, seed + 31, 64);
  const dirt = clamp01(grime * 1.0 - 0.45 + tstreak(x, y, seed + 41, 8, 128) * 0.3);
  const bugs = clamp01((tnoise(x, y, seed + 71, 8) - 0.86) * 8) * clamp01(1 - ly / 90);   // gathered at one end
  // Prism lattice (4 px pyramids).
  const px = (x % 4) - 2, py = (y % 4) - 2;
  const prism = 1 - Math.max(Math.abs(px), Math.abs(py)) / 2;
  const tube = (c: number) => Math.exp(-(((lx - c) / FL_TUBE_HALF) ** 2) * 1.6);
  const ends = smooth(FL_FRAME_PX, FL_FRAME_PX + FL_END_PX, ly) * smooth(FL_FRAME_PX, FL_FRAME_PX + FL_END_PX, FL_CELL_H - ly);
  const diffuse = 0.32 + 0.12 * Math.exp(-(((lx - 64) / 40) ** 2));
  const atten = (1 - 0.55 * dirt) * (1 - 0.8 * bugs) * inD;
  const ta = tube(FL_TUBES[0]) * (0.35 + 0.65 * ends), tb = tube(FL_TUBES[1]) * (0.35 + 0.65 * ends);
  const height = inD > 0.5 ? 0.3 + 0.03 * prism : 0.4 + 0.3 * s;
  const frameK = (1 - 0.5 * dirt) * (1 - 0.5 * (1 - s));
  const dif = 150 * (1 - 0.35 * dirt) * (1 - 0.6 * bugs) * (0.96 + 0.06 * prism);
  const fr = 78 * frameK;
  o.h = height;
  o.r = fr * (1 - inD) + dif * inD; o.g = fr * (1 - inD) + dif * 1.02 * inD; o.b = fr * 0.97 * (1 - inD) + dif * 1.04 * inD;
  o.rough = clamp01(0.5 * (1 - inD) + (0.3 + 0.2 * dirt) * inD);
  o.e = clamp01((diffuse * 0.5 + 0.72 * ta) * atten); o.e2 = clamp01((diffuse * 0.5 + 0.72 * tb) * atten);
  o.flat = 0.7 * inD;
};

/** Exit sign: one sign per tile (the sector mesh fits the tile to each sign): a dark housing, a red
 *  acrylic face, our own block letters. e = letters, e2 = the backlit face. */
const exitSign: Shader = (x, y, seed, o) => {
  const edge = boxEdge(x, y, N, N);
  const face = smooth(EX_FRAME_PX - 4, EX_FRAME_PX, edge);
  const lip = smooth(2, 8, edge);
  const letter = exitLetterAt(x, y) ? 1 : 0;
  const dirt = clamp01(tfbm(x, y, seed + 31, 64) * 1.1 - 0.4 + tstreak(x, y, seed + 41, 8, 128) * 0.35);
  const sc = scratches(x, y, seed + 21, 32, 0.5);
  const atten = (1 - 0.5 * dirt) * (1 - 0.25 * sc);
  o.h = face > 0.5 ? 0.35 + 0.08 * letter : 0.45 + 0.3 * lip;
  const housing = 44 * (1 - 0.45 * dirt) * (0.9 + 0.2 * tnoise(x, y, seed + 51, 8));
  const acrylic: [number, number, number] = letter ? [140, 42, 34] : [78, 22, 20];
  const k = (1 - 0.35 * dirt) * (1 + 0.4 * sc);
  o.r = housing * (1 - face) + acrylic[0] * k * face; o.g = housing * (1 - face) + acrylic[1] * k * face; o.b = housing * 0.95 * (1 - face) + acrylic[2] * k * face;
  o.rough = clamp01((0.55 + 0.1 * dirt) * (1 - face) + (0.22 + 0.25 * sc + 0.2 * dirt) * face);
  o.e = letter * face * atten; o.e2 = face * atten;
  o.flat = 0.8 * face;
};

const SHADERS: Record<PanelKind, Shader> = {
  techPanel, metalSheet, door, rustBrick, lightPanel, concreteSlab, metalPlate, floorTile, screenBank, viewscreen, fluorescent, exitSign,
};
/** Height → normal gain per kind. Stone's is 3 × normalStrength over a field that is pebbled
 *  everywhere; these fields are flatter between their features, so the gain is higher. */
const NORMAL_GAIN: Record<PanelKind, number> = {
  techPanel: 5, metalSheet: 5, door: 5, rustBrick: 4.5, lightPanel: 4.5, concreteSlab: 4.5, metalPlate: 4.5, floorTile: 4.5,
  screenBank: 4.5, viewscreen: 4.5, fluorescent: 4, exitSign: 4,
};

/** The grime pass applied after each kind's own shader (generatePanel):
 *  relief — the kind's own height × this (deeper seams, taller rivets and bands) ·
 *  grain — fine surface relief (pitting, hammering) · dent — broad dents · gouge — scratched-in grooves ·
 *  chip — chipped seam edges · ao — darkening in recesses (height below its local mean) ·
 *  drip — streaks running down from recesses (rivets, vents, seams) · rust — rust bloom round recesses ·
 *  oil — dark, wet (low roughness) stains · dust — pale dust on the lips above drops (ledges) ·
 *  mottle — large low-frequency light/dark patches · wet — glossy damp patches. */
interface Grime { relief: number; grain: number; dent: number; gouge: number; chip: number; ao: number; drip: number; rust: number; oil: number; dust: number; mottle: number; wet: number }
const GRIME: Record<PanelKind, Grime> = {
  techPanel:    { relief: 1.5, grain: 0.07, dent: 0.05, gouge: 0.07, chip: 0.25, ao: 0.6,  drip: 0.6,  rust: 0.30, oil: 0,    dust: 0.25, mottle: 0.4,  wet: 0.35 },
  metalSheet:   { relief: 1.6, grain: 0.07, dent: 0.07, gouge: 0.08, chip: 0.2,  ao: 0.6,  drip: 0.6,  rust: 0.45, oil: 0,    dust: 0.2,  mottle: 0.45, wet: 0.35 },
  door:         { relief: 1.5, grain: 0.07, dent: 0.06, gouge: 0.1,  chip: 0.25, ao: 0.65, drip: 0.6,  rust: 0.5,  oil: 0,    dust: 0.3,  mottle: 0.4,  wet: 0.3 },
  rustBrick:    { relief: 1.0, grain: 0.08, dent: 0.06, gouge: 0.04, chip: 0.35, ao: 0.5,  drip: 0.5,  rust: 0.2,  oil: 0,    dust: 0.2,  mottle: 0.4,  wet: 0.4 },
  lightPanel:   { relief: 1.4, grain: 0.05, dent: 0.04, gouge: 0.05, chip: 0.15, ao: 0.6,  drip: 0.45, rust: 0.25, oil: 0,    dust: 0.3,  mottle: 0.35, wet: 0.2 },
  concreteSlab: { relief: 1.4, grain: 0.14, dent: 0.06, gouge: 0.05, chip: 0.4,  ao: 0.6,  drip: 0.45, rust: 0.15, oil: 0.25, dust: 0.15, mottle: 0.5,  wet: 0.4 },
  metalPlate:   { relief: 1.3, grain: 0.06, dent: 0.06, gouge: 0.08, chip: 0.2,  ao: 0.65, drip: 0,    rust: 0.35, oil: 0.55, dust: 0,    mottle: 0.45, wet: 0.45 },
  floorTile:    { relief: 1.4, grain: 0.06, dent: 0.04, gouge: 0.05, chip: 0.35, ao: 0.65, drip: 0,    rust: 0.1,  oil: 0.5,  dust: 0,    mottle: 0.45, wet: 0.5 },
  // Emitters: grimy bezels and frames, but no damp or oil (the glass and diffusers stay glossy-ish:
  // rough faces wash out pale under the torch, hand-off warning).
  screenBank:   { relief: 1.4, grain: 0.05, dent: 0.04, gouge: 0.05, chip: 0.2,  ao: 0.6,  drip: 0.45, rust: 0.15, oil: 0,    dust: 0.25, mottle: 0.35, wet: 0 },
  viewscreen:   { relief: 1.4, grain: 0.04, dent: 0.03, gouge: 0.04, chip: 0.15, ao: 0.6,  drip: 0.35, rust: 0.12, oil: 0,    dust: 0.2,  mottle: 0.3,  wet: 0 },
  fluorescent:  { relief: 1.2, grain: 0.03, dent: 0.03, gouge: 0.02, chip: 0.1,  ao: 0.5,  drip: 0.3,  rust: 0.1,  oil: 0,    dust: 0.25, mottle: 0.3,  wet: 0 },
  exitSign:     { relief: 1.2, grain: 0.04, dent: 0.03, gouge: 0.03, chip: 0.1,  ao: 0.5,  drip: 0.3,  rust: 0.1,  oil: 0,    dust: 0.2,  mottle: 0.25, wet: 0 },
};
const RUST_SRGB = [92, 54, 34] as const;

/** Wrapping box blur of a scalar field, radius r px, separable. */
function boxBlur(src: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N), w = 2 * r + 1;
  for (let y = 0; y < N; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * N + wrapPx(k)]!;
    for (let x = 0; x < N; x++) {
      tmp[y * N + x] = acc / w;
      acc += src[y * N + wrapPx(x + r + 1)]! - src[y * N + wrapPx(x - r)]!;
    }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[wrapPx(k) * N + x]!;
    for (let y = 0; y < N; y++) {
      out[y * N + x] = acc / w;
      acc += tmp[wrapPx(y + r + 1) * N + x]! - tmp[wrapPx(y - r) * N + x]!;
    }
  }
  return out;
}

/** The lit panel's glow colour, sRGB (cold fluorescent, a little dingy). */
const GLOW_SRGB = [200, 218, 204] as const;

export function generatePanel(kind: PanelKind, seed: number): PanelMaps {
  const n = N * N;
  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const roughness = new Uint8ClampedArray(n);
  const emitter = isEmitterPanel(kind);
  const emissive = panelGlows(kind) ? new Uint8ClampedArray(n * 4) : null;
  const height = new Float32Array(n);
  const col = new Float32Array(n * 3), rough = new Float32Array(n), glow = emissive ? new Float32Array(n) : null;
  const glow2 = emitter ? new Float32Array(n) : null;
  const flatF = emitter ? new Float32Array(n) : null;
  const shade = SHADERS[kind];
  const g = GRIME[kind];
  const o: Px = { h: 0, r: 0, g: 0, b: 0, rough: 0, e: 0, e2: 0, flat: 0 };
  // 1. The kind's own surface, plus damage relief: grain, dents, gouges.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      o.flat = 0;
      shade(x, y, seed, o);
      const damage = (1 - o.flat) * ( g.grain * (tfbm(x, y, seed + 201, 4, 2) - 0.5) * 2
        + g.dent * (tfbm(x, y, seed + 211, 64, 2) - 0.5) * 2
        - g.gouge * scratches(x, y, seed + 221, 64, 0.3));
      height[i] = o.h * g.relief + damage;
      col[i * 3] = o.r; col[i * 3 + 1] = o.g; col[i * 3 + 2] = o.b;
      rough[i] = o.rough;
      if (flatF) flatF[i] = o.flat;
      if (glow) glow[i] = o.e;
      if (glow2) glow2[i] = o.e2;
    }
  }
  // 2. Chipped edges: near a step in height (the field off its 3 px mean), noise bites into the face.
  const near = boxBlur(height, 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const edgeness = Math.abs(height[i]! - near[i]!);
    if (edgeness > 0.04 && tnoise(x, y, seed + 231, 4) > 1 - g.chip && !(flatF && flatF[i]! > 0.5)) height[i] = Math.min(height[i]!, near[i]! - 0.12);
  }
  // 3. Recesses: how far below its 8 px neighbourhood a pixel sits (seams, holes, slats, rivet rims).
  const mean = boxBlur(height, 8);
  const cav = new Float32Array(n);
  for (let i = 0; i < n; i++) cav[i] = clamp01((mean[i]! - height[i]!) * 5);
  // 4. Drips: run each recess DOWN the wall (row y runs up, so down is toward row 0), streaky per column.
  const drip = new Float32Array(n);
  if (g.drip > 0) {
    for (let x = 0; x < N; x++) {
      let run = 0;
      for (let k = 2 * N - 1; k >= 0; k--) {            // twice round, so a drip crosses the wrap
        const y = k % N, i = y * N + x;
        run = Math.max(cav[i]! * 0.9, run * 0.985);
        if (k < N) drip[i] = run;
      }
    }
  }
  // 5. Colour and roughness: AO, drips, rust bloom, oil, dust, mottling, damp.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const c = cav[i]!;
    // Terms whose weight is 0 for this kind skip their noise (boot cost).
    const d = g.drip > 0 ? clamp01(drip[i]! * (0.35 + 0.65 * tstreak(x, y, seed + 241, 4, 64)) * 1.6 - c) : 0;
    const mottle = (tfbm(x, y, seed + 251, 256, 2) - 0.5) * 2;
    const rustN = g.rust > 0 ? clamp01((tfbm(x, y, seed + 261, 32) - 0.55) * 4 + c * 1.2 + d * 0.6) * g.rust : 0;
    const oil = g.oil > 0 ? clamp01((tfbm(x, y, seed + 271, 128) - 0.58) * 5) * g.oil : 0;
    const wet = g.wet > 0 ? clamp01((tfbm(x, y, seed + 281, 64) - 0.55) * 4) * g.wet : 0;
    const lip = g.dust > 0 ? clamp01((height[i]! - height[wrapPx(y - 3) * N + x]!) * 4) * g.dust : 0;
    let k = (1 - g.ao * c) * (1 - g.drip * 0.55 * d) * (1 + g.mottle * 0.35 * mottle) * (1 - 0.55 * oil) * (1 - 0.2 * wet);
    k = Math.max(0.15, k);
    let r = col[i * 3]! * k, gg = col[i * 3 + 1]! * k, b = col[i * 3 + 2]! * k;
    const rs = rustN * (0.7 + 0.3 * tnoise(x, y, seed + 291, 4));
    r = r * (1 - rs) + RUST_SRGB[0] * k * rs; gg = gg * (1 - rs) + RUST_SRGB[1] * k * rs; b = b * (1 - rs) + RUST_SRGB[2] * k * rs;
    r += 30 * lip; gg += 29 * lip; b += 27 * lip;
    albedo[i * 4] = r; albedo[i * 4 + 1] = gg; albedo[i * 4 + 2] = b; albedo[i * 4 + 3] = 255;
    const fl = flatF ? flatF[i]! : 0;
    const ro = rough[i]! + (1 - fl) * (0.25 * c + 0.2 * rs + 0.15 * lip - 0.45 * oil - 0.4 * wet + 0.12 * mottle * g.mottle);
    roughness[i] = clamp01(ro) * 255;
    if (emissive && glow && glow2) {
      // An emitter's mask: its own channels, dimmed by the drips, recesses and dark mottling over it.
      const at = (1 - 0.6 * d) * (1 - 0.3 * c) * (1 - 0.25 * Math.max(0, -mottle));
      emissive[i * 4] = clamp01(glow[i]! * at) * 255; emissive[i * 4 + 1] = clamp01(glow2[i]! * at) * 255;
      emissive[i * 4 + 2] = 0; emissive[i * 4 + 3] = 255;
    } else if (emissive && glow) {
      const e = clamp01(glow[i]! * (1 - 0.6 * d) * (1 - 0.5 * c) * (1 - 0.35 * Math.max(0, -mottle)) * (0.75 + 0.25 * tnoise(x, y, seed + 301, 16)));
      emissive[i * 4] = GLOW_SRGB[0] * e; emissive[i * 4 + 1] = GLOW_SRGB[1] * e; emissive[i * 4 + 2] = GLOW_SRGB[2] * e; emissive[i * 4 + 3] = 255;
    }
  }
  // 6. Normals from the final height.
  const gain = NORMAL_GAIN[kind];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const hl = height[y * N + wrapPx(x - 1)]!, hr = height[y * N + wrapPx(x + 1)]!;
      const hd = height[wrapPx(y - 1) * N + x]!, hu = height[wrapPx(y + 1) * N + x]!;
      const dx = (hl - hr) * gain, dy = (hd - hu) * gain;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      normal[i * 4] = (dx / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (dy / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 3] = 255;
    }
  }
  lattices.clear();
  return { albedo, normal, roughness, emissive, height };
}

export interface PanelTextureSet {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  /** Single channel (RedFormat): read it as `.r` (the sector mesh's roughnessNode), not as a roughnessMap (.g). */
  roughness: THREE.DataTexture;
  emissiveMap: THREE.DataTexture | null;
}

/** Wrap generated pixels as GPU textures: albedo and glow sRGB, normal and roughness linear (the
 *  stone set's colour-space rule). Unlike the stone set these are mipmapped and linearly filtered:
 *  tread plate, slats and lattices are fine enough to shimmer badly at a distance otherwise. */
export function panelTextures(kind: PanelKind, seed: number): PanelTextureSet {
  return wrapPanel(generatePanel(kind, seed), kind);
}

/** Placeholder maps for a kind whose pixels arrive later (fillPanel): flat normals, mid albedo and
 *  roughness, no glow — the same sizes and formats, so nothing recompiles when they are filled. */
export function blankPanel(kind: PanelKind): Omit<PanelMaps, 'height'> {
  const n = N * N;
  const albedo = new Uint8ClampedArray(n * 4), normal = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    albedo[i * 4] = albedo[i * 4 + 1] = albedo[i * 4 + 2] = 60; albedo[i * 4 + 3] = 255;
    normal[i * 4] = normal[i * 4 + 1] = 128; normal[i * 4 + 2] = 255; normal[i * 4 + 3] = 255;
  }
  return { albedo, normal, roughness: new Uint8ClampedArray(n).fill(200), emissive: panelGlows(kind) ? new Uint8ClampedArray(n * 4) : null };
}

/** Swap generated pixels into a set made by wrapPanel (from blankPanel or an earlier build). */
export function fillPanel(set: PanelTextureSet, m: Omit<PanelMaps, 'height'>): void {
  const put = (t: THREE.DataTexture | null, data: Uint8ClampedArray | null) => {
    if (!t || !data) return;
    t.image.data = data;
    t.needsUpdate = true;
  };
  put(set.map, m.albedo); put(set.normalMap, m.normal); put(set.roughness, m.roughness); put(set.emissiveMap, m.emissive);
}

/** `kind` decides the glow map's colour space: an emitter's mask is linear data, the light panel's glow sRGB. */
export function wrapPanel(m: Omit<PanelMaps, 'height'>, kind: PanelKind): PanelTextureSet {
  const make = (data: Uint8ClampedArray, srgb: boolean, format: THREE.PixelFormat = THREE.RGBAFormat) => {
    const t = new THREE.DataTexture(data, N, N, format);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return {
    map: make(m.albedo, true),
    normalMap: make(m.normal, false),
    roughness: make(m.roughness, false, THREE.RedFormat),
    emissiveMap: m.emissive ? make(m.emissive, !isEmitterPanel(kind)) : null,
  };
}

/** Large-scale mottling for the sector mesh to sample at a scale unrelated to the 4 m tile (it breaks
 *  the repeat): MOTTLE_SIZE² single-channel, tileable, 0..255 around 128. */
export const MOTTLE_SIZE = 128;
export function generateMottle(seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(MOTTLE_SIZE * MOTTLE_SIZE);
  const step = N / MOTTLE_SIZE;
  for (let y = 0; y < MOTTLE_SIZE; y++) for (let x = 0; x < MOTTLE_SIZE; x++) {
    const v = tfbm(x * step, y * step, seed, 128, 4) * 0.75 + tnoise(x * step, y * step, seed + 9, 32) * 0.25;
    out[y * MOTTLE_SIZE + x] = clamp01((v - 0.5) * 2.2 + 0.5) * 255;
  }
  return out;
}
export function mottleTexture(seed: number): THREE.DataTexture {
  const t = new THREE.DataTexture(generateMottle(seed), MOTTLE_SIZE, MOTTLE_SIZE, THREE.RedFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export { PX_PER_M as PANEL_PX_PER_M };
