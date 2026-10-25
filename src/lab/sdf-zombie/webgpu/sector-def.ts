// src/lab/sdf-zombie/webgpu/sector-def.ts
//
// SECTOR LEVELS — types and the movement limits.
// Spec: docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md §4, §6.2.
// A sector is a 2D polygon bounded by its lines, with a floor, a ceiling and a light;
// a line is a wall (one sector) or an edge between two sectors (a step, a lip or nothing).
//
// WINDING RULE (spec §4): a sector lies on the LEFT of its lines. Left of a -> b in x/z is
// (-dz, dx). A line's front sector is left of v[0] -> v[1]; its back sector is left of
// v[1] -> v[0]. So an outer boundary runs positive (shoelace x0*z1 - x1*z0), a hole negative.
//
// Pure: no three.js, no DOM.

export type XZ = readonly [number, number];
export type SectorSpecial = 'none' | 'hurt' | 'flicker' | 'pulse' | 'strobe';
export const SECTOR_SPECIALS: readonly SectorSpecial[] = ['none', 'hurt', 'flicker', 'pulse', 'strobe'];
export type GlowKind = 'nukage' | 'lava' | 'acid';
export const GLOW_KINDS: readonly GlowKind[] = ['nukage', 'lava', 'acid'];

export interface SectorMaterials { floor: string; ceil: string; wall: string }
export interface SectorDef {
  floor: number;
  ceil: number;
  /** 0..1, Doom's 0..255 light level. */
  light: number;
  special: SectorSpecial;
  /** Damage per second on a hurt floor; 0 otherwise. */
  hurtPerSec: number;
  glow: GlowKind | null;
  materials: SectorMaterials;
  /** The lighting zone (spec §6.5): its synthesized room is `zoneName(zone)`. */
  zone: number;
}
/** A line side's own wall families by part (the converter's per-sidedef textures); a part left out
 *  falls back to the sector's `materials.wall`. */
export interface SideWalls { upper?: string; mid?: string; lower?: string }
export interface SectorDoor { sector: number; speed: number; wait: number }
export interface SectorLine {
  /** Vertex indices. The front sector is on the LEFT of v[0] -> v[1], the back on the left of v[1] -> v[0]. */
  v: readonly [number, number];
  front: number;
  /** -1: a solid wall with nothing behind it. */
  back: number;
  door: SectorDoor | null;
  exit: boolean;
  /** Set on the pieces of a line cut up by refineNearGlow (never in a file): the ORIGINAL line's
   *  v[0] position and length, so a texture laid per line (a door) runs on across its pieces. */
  origin?: { a: XZ; len: number };
  /** Per-side wall families (optional: older files and fixtures have none). */
  walls?: { front?: SideWalls; back?: SideWalls };
}
export interface SectorMap { vertices: XZ[]; sectors: SectorDef[]; lines: SectorLine[] }

/** Spec §6.2: the highest step a body walks up (Doom's 24 units at 32 units/m). */
export const SECTOR_STEP_M = 0.75;
/** The body disc radius sector navigation stands a body on (and the motion floor reads under). */
export const SECTOR_BODY_RADIUS_M = 0.34;
/** Spec §6.2: the lowest opening a body fits through (the Flat's doorway rule). */
export const SECTOR_HEADROOM_M = 1.9;
/** The material that means "open to the sky": no ceiling drawn (Doom's F_SKY1). */
export const SKY_MATERIAL = 'sky';

/** The synthesized room name of a zone: what `ActiveLevel.keyAt` returns inside it. */
export function zoneName(zone: number): string {
  return `zone-${zone}`;
}
