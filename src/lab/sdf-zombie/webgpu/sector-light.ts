// src/lab/sdf-zombie/webgpu/sector-light.ts
//
// SECTOR LIGHT (spec 2026-10-24-doom-sector-levels-design.md §7). A sector's Doom light level
// (0..1) becomes a self-lit ambient fraction of its albedo on a HARD curve, so even Doom's bright
// rooms stay dim in this engine's dark; flicker, pulse and strobe sectors multiply it on sim time.
// The renderer reads one Float32Array of current levels (game-sector-light.ts).
//
// Pure: no three.js, no DOM. The seed of a sector is its index, so the same map flickers the same.

import { moodLevel } from './lamp-moods';
import type { SectorDef, SectorSpecial } from './sector-def';

export interface SectorLightCurve { max: number; gamma: number }
export interface SectorLightConfig extends SectorLightCurve { on: boolean }

/** Owner pick from the tuning sheet (2026-10-24; was max 0.07 γ2.2, barely visible): Doom 255 → 35 % of
 *  albedo, Doom 160 → about 16.6 %. Tuned live with __sdfGame.sectorLight. */
export const DEFAULT_SECTOR_LIGHT: SectorLightCurve = { max: 0.35, gamma: 1.6 };

/** Strobe: Doom's STROBEBRIGHT (5 tics) out of ~1 s; the dark phase keeps 35 % of the light. */
const STROBE_PERIOD_S = 1.0;
const STROBE_BRIGHT_S = 0.14;
const DIM = 0.35;
/** Pulse (Doom's glowing light): one slow swing between DIM and 1. */
const PULSE_PERIOD_S = 2.2;
/** Reduced flashes: strobe becomes a pulse this slow. */
const STROBE_REDUCED_PERIOD_S = 3.0;

export function sectorAmbient(light: number, curve: SectorLightCurve): number {
  const l = Math.min(1, Math.max(0, light));
  return curve.max * l ** curve.gamma;
}

const pulse = (t: number, period: number, seed: number) =>
  DIM + (1 - DIM) * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / period + seed * 1.7));

/** The light multiplier of a sector special at sim time t (s). */
export function sectorEffect(special: SectorSpecial, t: number, seed: number, reducedFlashes: boolean): number {
  switch (special) {
    case 'flicker':
      return Math.min(1, moodLevel('flicker', t, seed));
    case 'pulse':
      return pulse(t, PULSE_PERIOD_S, seed);
    case 'strobe': {
      if (reducedFlashes) return pulse(t, STROBE_REDUCED_PERIOD_S, seed);
      const phase = (((t + seed * 0.37) % STROBE_PERIOD_S) + STROBE_PERIOD_S) % STROBE_PERIOD_S;
      return phase < STROBE_BRIGHT_S ? 1 : DIM;
    }
    default:
      return 1;
  }
}

/** Fill `out[i]` with sector i's current self-lit level (0 everywhere when `cfg.on` is false). */
export function writeSectorLevels(
  sectors: readonly SectorDef[], t: number, cfg: SectorLightConfig, reducedFlashes: boolean, out: Float32Array,
): void {
  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i]!;
    out[i] = cfg.on ? sectorAmbient(s.light, cfg) * sectorEffect(s.special, t, i, reducedFlashes) : 0;
  }
}

/** A gain from a URL parameter (`?glowgain=`, `?bouncegain=`): absent, empty, non-finite or
 *  negative means the fallback (Number('') is 0 and would black the term out). */
export function gainParam(raw: string | null, fallback: number): number {
  const v = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
