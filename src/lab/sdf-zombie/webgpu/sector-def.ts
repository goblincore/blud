// src/lab/sdf-zombie/webgpu/sector-def.ts
//
// SECTOR LEVELS — types and the movement limits.
// Spec: docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md §4, §6.2.
// A sector is a 2D polygon bounded by its lines, with a floor, a ceiling and a light;
// a line is a wall (one sector) or an edge between two sectors (a step, a lip or nothing).
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
export interface SectorDoor { sector: number; speed: number; wait: number }
export interface SectorLine {
  v: readonly [number, number];
  front: number;
  /** -1: a solid wall with nothing behind it. */
  back: number;
  door: SectorDoor | null;
  exit: boolean;
}
export interface SectorMap { vertices: XZ[]; sectors: SectorDef[]; lines: SectorLine[] }

/** Spec §6.2: the highest step a body walks up (Doom's 24 units at 32 units/m). */
export const SECTOR_STEP_M = 0.75;
/** Spec §6.2: the lowest opening a body fits through (the Flat's doorway rule). */
export const SECTOR_HEADROOM_M = 1.9;
/** The material that means "open to the sky": no ceiling drawn (Doom's F_SKY1). */
export const SKY_MATERIAL = 'sky';

/** The synthesized room name of a zone: what `ActiveLevel.keyAt` returns inside it. */
export function zoneName(zone: number): string {
  return `zone-${zone}`;
}
