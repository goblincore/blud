// src/lab/sdf-zombie/webgpu/game-sector-light.ts
//
// SECTOR LIGHT AND GLOW at runtime (spec 2026-10-24 §7–§8): owns the per-sector level uniform
// array the sector meshes read, refreshes it every tick from sector-light.ts on the sim clock,
// advances the glow surfaces' time, and holds the on/off toggle (?doomlight=0) and the curve the
// __sdfGame.sectorLight seam tunes. The decisions are sector-light.ts's; this only binds them.

import { uniform, uniformArray } from 'three/tsl';
import type { GameContext } from './game-context';
import { DEFAULT_SECTOR_LIGHT, writeSectorLevels, type SectorLightConfig } from './sector-light';
import { simTimeMs } from './sim-clock';

/** The ceilings' fixed whisper of self-light while sector light is off (plan 1's look). */
export const CEIL_WHISPER = 0.10;
/** The glow floors' brightness multiplier (owner-tunable; ?glowgain=<n>, __sdfGame.sectorLight({ glowGain })). */
export const DEFAULT_GLOW_GAIN = 0.35;   // owner pick from the tuning sheet (2026-10-24; 1.0 glared)

const floatUniform = (v: number) => uniform(v);
type FloatUniform = ReturnType<typeof floatUniform>;

export interface SectorFxRuntime {
  /** One float per sector, read by every sector mesh through its `sectorIndex` attribute. */
  levels: ReturnType<typeof uniformArray<'float'>>;
  /** The current levels (sector-light.ts writes here; copied into `levels.array` each tick). */
  values: Float32Array;
  cfg: SectorLightConfig;
  /** The ceilings' fixed self-light: CEIL_WHISPER with sector light off, 0 with it on. */
  ceilWhisper: FloatUniform;
  /** Sim seconds for the glow surfaces' flow. */
  glowTime: FloatUniform;
  /** Multiplies the glow floors' colour (DEFAULT_GLOW_GAIN unless ?glowgain or the seam set it). */
  glowGain: FloatUniform;
  reducedFlashes: boolean;
}

export function createSectorFx(sectorCount: number, search: URLSearchParams, reducedFlashes: boolean): SectorFxRuntime {
  const cfg: SectorLightConfig = { ...DEFAULT_SECTOR_LIGHT, on: search.get('doomlight') !== '0' };
  // A uniform array needs at least one element to declare.
  const n = Math.max(1, sectorCount);
  const gainParam = search.get('glowgain');
  // Absent or empty (`?glowgain=`) means the default: Number('') is 0 and would black out the pools.
  const gain = gainParam === null || gainParam.trim() === '' ? NaN : Number(gainParam);
  return {
    levels: uniformArray(new Array<number>(n).fill(0), 'float'),
    values: new Float32Array(sectorCount),
    cfg,
    ceilWhisper: floatUniform(cfg.on ? 0 : CEIL_WHISPER),
    glowTime: floatUniform(0),
    glowGain: floatUniform(Number.isFinite(gain) && gain >= 0 ? gain : DEFAULT_GLOW_GAIN),
    reducedFlashes,
  };
}

/** Per tick: the sector levels at sim time, the glow clock and the ceiling whisper. */
export function stepSectorLight(ctx: GameContext): void {
  const fx = ctx.world.sectorFx;
  const map = ctx.world.level.def?.sectors;
  if (!fx || !map) return;
  const t = simTimeMs() / 1000;
  writeSectorLevels(map.sectors, t, fx.cfg, fx.reducedFlashes, fx.values);
  // UniformArrayNode re-packs `.array` into its padded buffer on every render (updateType RENDER).
  const arr = fx.levels.array as number[];
  for (let i = 0; i < fx.values.length; i++) arr[i] = fx.values[i]!;
  fx.glowTime.value = t;
  fx.ceilWhisper.value = fx.cfg.on ? 0 : CEIL_WHISPER;
}

export type SectorLightPatch = Partial<SectorLightConfig> & { glowGain?: number };
export type SectorLightState = SectorLightConfig & { glowGain: number };

/** Patch the curve, the toggle or the glow gain (finite, non-negative numbers only); returns the live state. */
export function setSectorLightConfig(fx: SectorFxRuntime, patch: SectorLightPatch): SectorLightState {
  if (typeof patch.max === 'number' && Number.isFinite(patch.max) && patch.max >= 0) fx.cfg.max = patch.max;
  if (typeof patch.gamma === 'number' && Number.isFinite(patch.gamma) && patch.gamma > 0) fx.cfg.gamma = patch.gamma;
  if (typeof patch.on === 'boolean') fx.cfg.on = patch.on;
  if (typeof patch.glowGain === 'number' && Number.isFinite(patch.glowGain) && patch.glowGain >= 0) fx.glowGain.value = patch.glowGain;
  fx.ceilWhisper.value = fx.cfg.on ? 0 : CEIL_WHISPER;
  return { ...fx.cfg, glowGain: fx.glowGain.value };
}
