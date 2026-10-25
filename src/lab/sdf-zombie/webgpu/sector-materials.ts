// src/lab/sdf-zombie/webgpu/sector-materials.ts
//
// SECTOR MATERIALS: the converter's family names (scripts/levels/doom_tables.py — tech, rust, metal,
// door, light-panel, concrete, metal-plate, tile) to the surface the sector mesh draws, and how each
// surface looks (texture tile, roughness, metalness, relief, brightness against the level palette,
// glow). An unknown family, 'default', a glow family off the floor, or `?sectormat=0` gets the old
// stone set for its role (brick walls, cobble floors, vault ceilings), so a room level is unchanged.
//
// Pure: no three.js, no DOM.

import type { PanelKind } from '../../../game/level/panel-textures';

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
};

const STONE: Record<SurfaceRole, StoneKind> = { floor: 'stoneFloor', ceil: 'stoneCeil', wall: 'stoneWall' };

/** The surface a role wearing `family` draws; `on` false (?sectormat=0) is the old single stone set. */
export function surfaceKind(family: string, role: SurfaceRole, on = true): SurfaceKind {
  return (on && FAMILY_KINDS[family]) || STONE[role];
}

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
};

export const isStone = (k: SurfaceKind): k is StoneKind => k === 'stoneWall' || k === 'stoneFloor' || k === 'stoneCeil';

/** `?sectormat=0` turns the family materials off (the A/B against the old single stone set). */
export const sectorMaterialsOn = (search: URLSearchParams): boolean => search.get('sectormat') !== '0';
