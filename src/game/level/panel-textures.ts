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

export const PANEL_SIZE = 512;
/** World metres one map covers. */
export const PANEL_TILE_M = 4;
const PX_PER_M = PANEL_SIZE / PANEL_TILE_M;

export type PanelKind =
  | 'techPanel' | 'metalSheet' | 'door' | 'rustBrick' | 'lightPanel'
  | 'concreteSlab' | 'metalPlate' | 'floorTile';
export const PANEL_KINDS: readonly PanelKind[] = [
  'techPanel', 'metalSheet', 'door', 'rustBrick', 'lightPanel', 'concreteSlab', 'metalPlate', 'floorTile',
];

export interface PanelMaps {
  albedo: Uint8ClampedArray;     // RGBA, sRGB
  normal: Uint8ClampedArray;     // RGBA, linear tangent-space
  roughness: Uint8ClampedArray;  // RGBA, linear, value in .r
  /** RGBA sRGB glow colour × strength, or null for a kind that does not glow (only lightPanel does). */
  emissive: Uint8ClampedArray | null;
  /** The height field 0..1 (tests read it). */
  height: Float32Array;
}

const N = PANEL_SIZE;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, v: number) => { const t = clamp01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const wrapPx = (i: number) => ((i % N) + N) % N;

/** Value noise on a lattice of `cell` px that wraps at the map edge (cell divides PANEL_SIZE). */
function tnoise(x: number, y: number, seed: number, cell: number): number {
  const p = N / cell;
  const sx = x / cell, sy = y / cell;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = sx - x0, fy = sy - y0;
  const ex = fx * fx * (3 - 2 * fx), ey = fy * fy * (3 - 2 * fy);
  const xa = ((x0 % p) + p) % p, xb = (xa + 1) % p, ya = ((y0 % p) + p) % p, yb = (ya + 1) % p;
  const n00 = hash2(xa, ya, seed), n10 = hash2(xb, ya, seed), n01 = hash2(xa, yb, seed), n11 = hash2(xb, yb, seed);
  return (n00 * (1 - ex) + n10 * ex) * (1 - ey) + (n01 * (1 - ex) + n11 * ex) * ey;
}
/** Tileable fbm from `cell` px down, halving each octave (not below 2 px). */
function tfbm(x: number, y: number, seed: number, cell: number, octaves = 3): number {
  let sum = 0, amp = 0.5, norm = 0, c = cell;
  for (let o = 0; o < octaves; o++) {
    sum += tnoise(x, y, seed + o * 101, c) * amp; norm += amp;
    c = Math.max(2, c / 2); amp *= 0.5;
  }
  return sum / norm;
}
/** Anisotropic tileable noise: cells cx × cy px (streaks, brushing). */
function tstreak(x: number, y: number, seed: number, cx: number, cy: number): number {
  return tnoise(x * (cy / cx), y, seed, cy);
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
/** Thin random scratches: one per `cell` px cell, a short segment at a random angle; 0..1 strength. */
function scratches(x: number, y: number, seed: number, cell: number, density: number): number {
  let best = 0;
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = gx + ox, cy = gy + oy;
    const p = N / cell, wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
    if (hash2(wx, wy, seed) > density) continue;
    const px = (cx + hash2(wx, wy, seed + 1)) * cell, py = (cy + hash2(wx, wy, seed + 2)) * cell;
    const ang = hash2(wx, wy, seed + 3) * Math.PI, len = cell * (0.4 + hash2(wx, wy, seed + 4) * 0.9);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const rx = x - px, ry = y - py;
    const t = rx * dx + ry * dy;
    if (Math.abs(t) > len / 2) continue;
    const d = Math.abs(rx * dy - ry * dx);
    best = Math.max(best, (1 - smooth(0.3, 1.1, d)) * (0.5 + 0.5 * hash2(wx, wy, seed + 5)));
  }
  return best;
}

interface Px { h: number; r: number; g: number; b: number; rough: number; e: number }

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
  const grime = clamp01(tfbm(x, y, seed + 31, 64) * 1.1 - 0.35 + 0.5 * band + tstreak(x, y, seed + 41, 6, 128) * 0.35 - 0.15);
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
  const stain = clamp01(tstreak(x, y, seed + 41, 6, 128) * 1.4 - 0.55 + tfbm(x, y, seed + 31, 128) * 0.5 - 0.2);
  const wet = clamp01(tfbm(x, y, seed + 61, 64) * 1.8 - 0.9);
  const shade = (0.62 + 0.45 * height) * (1 - 0.35 * wet);
  const mortar = 1 - face;
  const r = (brick[0] * (1 - mortar) + 58 * mortar) * shade, g = (brick[1] * (1 - mortar) + 55 * mortar) * shade, b = (brick[2] * (1 - mortar) + 52 * mortar) * shade;
  // Rust stains pull toward a dark orange-brown.
  o.r = r * (1 - 0.35 * stain) + 104 * 0.35 * stain; o.g = g * (1 - 0.45 * stain) + 52 * 0.45 * stain; o.b = b * (1 - 0.55 * stain) + 30 * 0.55 * stain;
  o.h = height; o.rough = clamp01(0.86 - 0.5 * wet + 0.08 * mortar); o.e = 0;
};

/** A lit grid panel: 1 m cells of a diffuser behind a fine lattice, in a dark frame; a few cells
 *  have failed dim. Emissive is the diffuser (modest: the sector mesh scales it). */
const lightPanel: Shader = (x, y, seed, o) => {
  const cx = Math.floor(x / 128), cy = Math.floor(y / 128);
  const lx = x - cx * 128, ly = y - cy * 128;
  const edge = boxEdge(lx, ly, 128, 128);
  const inCell = smooth(12, 15, edge);
  const lat = Math.min(lx % 16, 16 - (lx % 16), ly % 16, 16 - (ly % 16));
  const lattice = 1 - smooth(0.6, 1.6, lat);
  const failed = hash2(cx, cy, seed) < 0.18 ? 0.25 : 1;
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

const SHADERS: Record<PanelKind, Shader> = { techPanel, metalSheet, door, rustBrick, lightPanel, concreteSlab, metalPlate, floorTile };
/** Height → normal gain per kind (stone's is 3 × normalStrength 1). */
const NORMAL_GAIN: Record<PanelKind, number> = {
  techPanel: 2.4, metalSheet: 2.0, door: 2.4, rustBrick: 3, lightPanel: 2.0, concreteSlab: 2.2, metalPlate: 2.6, floorTile: 2.2,
};
/** The lit panel's glow colour, sRGB (cold fluorescent). */
const GLOW_SRGB = [214, 232, 222] as const;

export function generatePanel(kind: PanelKind, seed: number): PanelMaps {
  const n = N * N;
  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const roughness = new Uint8ClampedArray(n * 4);
  const emissive = kind === 'lightPanel' ? new Uint8ClampedArray(n * 4) : null;
  const height = new Float32Array(n);
  const shade = SHADERS[kind];
  const o: Px = { h: 0, r: 0, g: 0, b: 0, rough: 0, e: 0 };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      shade(x, y, seed, o);
      height[i] = o.h;
      albedo[i * 4] = o.r; albedo[i * 4 + 1] = o.g; albedo[i * 4 + 2] = o.b; albedo[i * 4 + 3] = 255;
      const r = clamp01(o.rough) * 255;
      roughness[i * 4] = r; roughness[i * 4 + 1] = r; roughness[i * 4 + 2] = r; roughness[i * 4 + 3] = 255;
      if (emissive) {
        const e = clamp01(o.e);
        emissive[i * 4] = GLOW_SRGB[0] * e; emissive[i * 4 + 1] = GLOW_SRGB[1] * e; emissive[i * 4 + 2] = GLOW_SRGB[2] * e; emissive[i * 4 + 3] = 255;
      }
    }
  }
  const gain = NORMAL_GAIN[kind];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const hl = height[y * N + wrapPx(x - 1)]!, hr = height[y * N + wrapPx(x + 1)]!;
      const hd = height[wrapPx(y - 1) * N + x]!, hu = height[wrapPx(y + 1) * N + x]!;
      const dx = (hl - hr) * gain, dy = (hd - hu) * gain;
      const len = Math.hypot(dx, dy, 1);
      normal[i * 4] = (dx / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (dy / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[i * 4 + 3] = 255;
    }
  }
  return { albedo, normal, roughness, emissive, height };
}

export interface PanelTextureSet {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  emissiveMap: THREE.DataTexture | null;
}

/** Wrap generated pixels as GPU textures: albedo and glow sRGB, normal and roughness linear (the
 *  stone set's colour-space rule). Unlike the stone set these are mipmapped and linearly filtered:
 *  tread plate, slats and lattices are fine enough to shimmer badly at a distance otherwise. */
export function panelTextures(kind: PanelKind, seed: number): PanelTextureSet {
  const m = generatePanel(kind, seed);
  const make = (data: Uint8ClampedArray, srgb: boolean) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
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
    roughnessMap: make(m.roughness, false),
    emissiveMap: m.emissive ? make(m.emissive, true) : null,
  };
}

export { PX_PER_M as PANEL_PX_PER_M };
