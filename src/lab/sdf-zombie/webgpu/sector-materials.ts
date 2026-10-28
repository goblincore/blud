// src/lab/sdf-zombie/webgpu/sector-materials.ts
//
// SECTOR MATERIALS: the converter's family names (scripts/levels/doom_tables.py — tech, rust, metal,
// door, light-panel, concrete, metal-plate, tile) to the surface the sector mesh draws, and how each
// surface looks (texture tile, roughness, metalness, relief, brightness against the level palette,
// glow). An unknown family, 'default', a glow family off the floor, or `?sectormat=0` gets the old
// stone set for its role (brick walls, cobble floors, vault ceilings), so a room level is unchanged.
//
// EMITTERS (hand-off item 2g, part A): screen-bank, viewscreen, fluorescent and exit-sign draw the
// self-lit panel kinds whose glow is animated in the shader (emitter-glow.wgsl.ts). `?emitters=0`
// draws them as before (tech panels, the light panel, door steel) for the A/B. Their walls FIT the
// texture to the line and the quad (wallFit): whole screens, troffers and signs, never one cut by a
// corner or the floor.
//
// Pure: no three.js, no DOM.

import type { PanelKind } from '../../../game/level/panel-textures';
import type { XZ } from './sector-def';

export type SurfaceRole = 'floor' | 'ceil' | 'wall';
export type StoneKind = 'stoneWall' | 'stoneFloor' | 'stoneCeil';
export type SurfaceKind = PanelKind | StoneKind;

/** Family → procedural kind (panel-textures.ts). */
export const FAMILY_KINDS: Readonly<Record<string, PanelKind>> = {
  tech: 'techPanel',
  metal: 'metalSheet',
  door: 'door',
  rust: 'rustBrick',
  'light-panel': 'lightPanel',
  concrete: 'concreteSlab',
  'metal-plate': 'metalPlate',
  tile: 'floorTile',
  'screen-bank': 'screenBank',
  viewscreen: 'viewscreen',
  fluorescent: 'fluorescent',
  'exit-sign': 'exitSign',
};
/** What an emitter family draws with `?emitters=0`: its kind before item 2g (the converter's old families). */
const PRE_EMITTER: Readonly<Record<string, PanelKind>> = {
  'screen-bank': 'techPanel', viewscreen: 'techPanel', fluorescent: 'lightPanel', 'exit-sign': 'door',
};

const STONE: Record<SurfaceRole, StoneKind> = { floor: 'stoneFloor', ceil: 'stoneCeil', wall: 'stoneWall' };

/** The surface a role wearing `family` draws; `on` false (?sectormat=0) is the old single stone set. */
export function surfaceKind(family: string, role: SurfaceRole, on = true, emitters = true): SurfaceKind {
  if (on && !emitters && PRE_EMITTER[family]) return PRE_EMITTER[family];
  return (on && FAMILY_KINDS[family]) || STONE[role];
}

/** `?emitters=0` draws the emitter families as their old kinds. */
export const emittersOn = (search: URLSearchParams): boolean => search.get('emitters') !== '0';

export type EmitterGainKey = 'screenGain' | 'fluoroGain' | 'signGain';
/** An emitter kind's animated glow: which gain seam scales it (__sdfGame.sectorLight({ screenGain,
 *  fluoroGain, signGain }), ?screengain= ?fluorogain= ?signgain=) and its floor k in emitterFactor
 *  (emitter-layout.ts: the glow is × max(level / full, k), so a powered screen stays lit in the dark). */
export interface EmitLook { gain: EmitterGainKey; floor: number }
/** A fitted wall: one cell is meant to be `u` × `v` metres and covers `cu` × `cv` of the tile. */
export interface WallFit { u: number; v: number; cu: number; cv: number }

export interface SurfaceLook {
  /** World metres one texture repeat covers (the stone set's tile is 2 m; panel maps cover 4 m at the same 128 px/m). */
  tileM: number;
  /** Scalar roughness multiplied into the roughness map. */
  roughness: number;
  metalness: number;
  normalScale: number;
  /** Multiplies the level palette's role colour (the dark tint every sector surface wears). */
  gain: number;
  /** The glow map's strength (lightPanel only) per unit of sector level (the mesh multiplies by the
   *  sector's current level: 0.35 at full light, so 0.35 × 0.35 ≈ 0.12 there); 0 for everything else. */
  glow: number;
  /** Emitter kinds only: the animated glow's seam and floor. */
  emit?: EmitLook;
  /** Emitter kinds only: walls fit whole cells to the line and the quad (wallFit). */
  fit?: WallFit;
}

const STONE_LOOK: SurfaceLook = { tileM: 2, roughness: 1, metalness: 0, normalScale: 1.1, gain: 1, glow: 0 };

/** Tuned by eye in E1M1 under the torch and the sector light (scripts/sdf-game-doom-materials.sh shots). */
export const SURFACE_LOOKS: Readonly<Record<SurfaceKind, SurfaceLook>> = {
  stoneWall: STONE_LOOK, stoneFloor: STONE_LOOK, stoneCeil: STONE_LOOK,
  techPanel: { tileM: 4, roughness: 1, metalness: 0.15, normalScale: 1.3, gain: 1.0, glow: 0 },
  metalSheet: { tileM: 4, roughness: 1, metalness: 0.25, normalScale: 1.3, gain: 1.0, glow: 0 },
  door: { tileM: 4, roughness: 1, metalness: 0.3, normalScale: 1.3, gain: 1.0, glow: 0 },
  rustBrick: { tileM: 4, roughness: 1, metalness: 0, normalScale: 1.3, gain: 1.0, glow: 0 },
  lightPanel: { tileM: 4, roughness: 1, metalness: 0.1, normalScale: 1.3, gain: 1.0, glow: 0.35 },
  concreteSlab: { tileM: 4, roughness: 1, metalness: 0, normalScale: 1.3, gain: 1.0, glow: 0 },
  metalPlate: { tileM: 4, roughness: 1, metalness: 0.2, normalScale: 1.3, gain: 1.0, glow: 0 },
  floorTile: { tileM: 4, roughness: 1, metalness: 0, normalScale: 1.3, gain: 1.0, glow: 0 },
  // Emitters: their maps keep the glass, diffusers and acrylic at roughness ≲ 0.5 (rough faces wash out
  // pale under the torch at 1–2 m: dualmem warning), so the scalar is 1 like the rest.
  screenBank: { tileM: 4, roughness: 1, metalness: 0.15, normalScale: 1.2, gain: 1.0, glow: 0,
    emit: { gain: 'screenGain', floor: 0.75 }, fit: { u: 1, v: 1, cu: 0.25, cv: 0.25 } },
  viewscreen: { tileM: 4, roughness: 1, metalness: 0.2, normalScale: 1.2, gain: 1.0, glow: 0,
    emit: { gain: 'screenGain', floor: 0.75 }, fit: { u: 2, v: 2, cu: 0.5, cv: 0.5 } },
  fluorescent: { tileM: 4, roughness: 1, metalness: 0.1, normalScale: 1.1, gain: 1.0, glow: 0,
    emit: { gain: 'fluoroGain', floor: 0.5 }, fit: { u: 1, v: 2, cu: 0.25, cv: 0.5 } },
  exitSign: { tileM: 1, roughness: 1, metalness: 0.1, normalScale: 1.0, gain: 1.0, glow: 0,
    emit: { gain: 'signGain', floor: 0.8 }, fit: { u: 1, v: 0.5, cu: 1, cv: 1 } },
  // The sliding door leaf (game-doors.ts): no wall family maps to it; one map per leaf (tileM unused).
  // Metal: the scratches catch the torch as steel, not as a pale dielectric veil.
  slideDoor: { tileM: 4, roughness: 1, metalness: 0.45, normalScale: 0.9, gain: 0.85, glow: 0 },
};

/** The emitter gains' defaults (owner-tunable). */
export const DEFAULT_EMITTER_GAINS: Readonly<Record<EmitterGainKey, number>> = { screenGain: 1, fluoroGain: 0.8, signGain: 1 };

/** A fitted wall quad's uv at one corner: u stretches the line (its whole length `along[2]`, from its
 *  start) to whole cells of `fit.u` metres (a line under half a cell keeps the natural scale), v the
 *  quad's height y0..y1 to whole cells of `fit.v` metres from its bottom. `uOffset` is a whole number
 *  of tiles added to u (a per-line seed for the shader's per-panel choices; the tile repeats, so it
 *  changes nothing the texture shows). */
export function wallFit(fit: WallFit, t: number, full: number, y: number, y0: number, y1: number, uOffset = 0): [number, number] {
  const n = Math.round(full / fit.u);
  const u = n >= 1 ? (t / full) * n * fit.cu : (t / fit.u) * fit.cu;
  const h = y1 - y0;
  const m = Math.max(1, Math.round(h / fit.v));
  const v = h > 0 ? ((y - y0) / h) * m * fit.cv : 0;
  return [u + uOffset, v];
}

/** A fitted FLAT (a fluorescent ceiling): whole troffers over its polygon's x/z box. The box is
 *  stretched to whole cells (fit.u across x, fit.v along z; at least one), from its min corner, so
 *  a rectangular light ceiling (Doom's TLITE flats are) shows whole troffers edge to edge. A
 *  non-rectangular polygon still cuts cells at its slanted edges (known limit). */
export interface FlatBox { min: XZ; max: XZ }
export function flatFitCells(fit: WallFit, box: FlatBox): [number, number] {
  return [Math.max(1, Math.round((box.max[0] - box.min[0]) / fit.u)), Math.max(1, Math.round((box.max[1] - box.min[1]) / fit.v))];
}
export function flatFit(fit: WallFit, x: number, z: number, box: FlatBox): [number, number] {
  const [nx, nz] = flatFitCells(fit, box);
  const w = box.max[0] - box.min[0], d = box.max[1] - box.min[1];
  return [w > 0 ? ((x - box.min[0]) / w) * nx * fit.cu : 0, d > 0 ? ((z - box.min[1]) / d) * nz * fit.cv : 0];
}
export function polyBox(pts: readonly XZ[]): FlatBox {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { min: [x0, z0], max: [x1, z1] };
}

/** A line's whole-tile u offset from its start point: deterministic, small, non-negative. */
export function lineSeedTiles(x: number, z: number): number {
  const k = Math.round(x * 8) * 73856093 ^ Math.round(z * 8) * 19349663;
  return ((k % 61) + 61) % 61;
}

export const isStone = (k: SurfaceKind): k is StoneKind => k === 'stoneWall' || k === 'stoneFloor' || k === 'stoneCeil';

/** `?sectormat=0` turns the family materials off (the A/B against the old single stone set). */
export const sectorMaterialsOn = (search: URLSearchParams): boolean => search.get('sectormat') !== '0';

/** A wall quad's u at its two ends. Most kinds run u along the wall from the projection of `a` on its
 *  direction, so the pieces of a split line tile on. A DOOR lays its texture per whole line (`along`:
 *  the quad's place on the original line, so a door cut into pieces near a pool is still one door):
 *  a line of at least half a tile stretches to a whole number of tiles, so the frame strips sit at
 *  the door's two edges; a narrower one keeps the natural scale from its start (never a squashed
 *  4 m tile). */
export function wallU(kind: SurfaceKind, a: XZ, along: readonly [number, number, number], dx: number, dz: number, len: number, tile: number): [number, number] {
  if (kind !== 'door') {
    const u0 = (a[0] * dx + a[1] * dz) / len / tile;
    return [u0, u0 + len / tile];
  }
  const [t0, t1, full] = along;
  const tiles = Math.round(full / tile);
  const scale = tiles >= 1 ? tiles / full : 1 / tile;
  return [t0 * scale, t1 * scale];
}
