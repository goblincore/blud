// src/lab/sdf-zombie/webgpu/game-sector-light.ts
//
// SECTOR LIGHT AND GLOW at runtime (spec 2026-10-24 §7–§8): owns the per-sector level uniform
// array the sector meshes read, refreshes it every tick from sector-light.ts on the sim clock,
// advances the glow surfaces' time, and holds the on/off toggle (?doomlight=0) and the curve the
// __sdfGame.sectorLight seam tunes (also the emitter gains: screenGain, fluoroGain, signGain, and the
// emitters' baked bounce: emitBounceGain). The decisions are sector-light.ts's; this only binds them.

import { uniform, uniformArray } from 'three/tsl';
import type { GameContext } from './game-context';
import { DEFAULT_EMITTER_GAINS, type EmitterGainKey } from './sector-materials';
import { DEFAULT_SECTOR_LIGHT, gainParam, writeSectorLevels, type SectorLightConfig } from './sector-light';
import { simTimeMs } from './sim-clock';
import { wrapGlowTime } from '../../../game/level/emitter-layout';
import { parseEmitPush, type EmitPushStep } from './emit-push';

/** The emitter push steps this boot (emit-push.ts; ?emitpush=spill,exit,key, none, all; no param = all). */
export const EMIT_PUSH: ReadonlySet<EmitPushStep> = parseEmitPush(typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('emitpush'));

/** The ceilings' fixed whisper of self-light while sector light is off (plan 1's look). */
export const CEIL_WHISPER = 0.10;
/** The glow floors' brightness multiplier (owner-tunable; ?glowgain=<n>, __sdfGame.sectorLight({ glowGain })). */
export const DEFAULT_GLOW_GAIN = 0.35;   // owner pick from the tuning sheet (2026-10-24; 1.0 glared)
/** The baked glow bounce's multiplier (sector-bounce.ts; ?bouncegain=<n>, __sdfGame.sectorLight({ bounceGain })).
 *  The sector meshes add albedo × glowBounce × bounceGain × glowGain: the bounce follows the pools' brightness. */
export const DEFAULT_BOUNCE_GAIN = 36;
/** The emitters' baked bounce multiplier (sector-emitters.ts; ?emitbounce=<n>, __sdfGame.sectorLight({ emitBounceGain })).
 *  The sector meshes add albedo × emitBounceGain × (each class's bake × its emitter gain). Chosen from the
 *  B1 tuning sheet (docs/dev-notes/2026-10-24-sector-levels-handoff.md item 2g). */
export const DEFAULT_EMIT_BOUNCE_GAIN = 30;

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
  /** Multiplies the baked glow bounce (DEFAULT_BOUNCE_GAIN unless ?bouncegain or the seam set it). */
  bounceGain: FloatUniform;
  /** Multiplies the emitters' baked bounce (DEFAULT_EMIT_BOUNCE_GAIN unless ?emitbounce or the seam set it). */
  emitBounceGain: FloatUniform;
  reducedFlashes: boolean;
  /** The emitter kinds' glow gains (sector-materials.ts DEFAULT_EMITTER_GAINS; ?screengain= ?fluorogain= ?signgain=). */
  emitGains: Record<EmitterGainKey, FloatUniform>;
  /** A full-bright sector's level (the curve's max): emitters divide their sector's level by it. */
  fullLevel: FloatUniform;
}

const EMIT_PARAMS: Record<EmitterGainKey, string> = { screenGain: 'screengain', fluoroGain: 'fluorogain', signGain: 'signgain' };

export function createSectorFx(sectorCount: number, search: URLSearchParams, reducedFlashes: boolean): SectorFxRuntime {
  const cfg: SectorLightConfig = { ...DEFAULT_SECTOR_LIGHT, on: search.get('doomlight') !== '0' };
  // A uniform array needs at least one element to declare.
  const n = Math.max(1, sectorCount);
  return {
    levels: uniformArray(new Array<number>(n).fill(0), 'float'),
    values: new Float32Array(sectorCount),
    cfg,
    ceilWhisper: floatUniform(cfg.on ? 0 : CEIL_WHISPER),
    glowTime: floatUniform(0),
    glowGain: floatUniform(gainParam(search.get('glowgain'), DEFAULT_GLOW_GAIN)),
    bounceGain: floatUniform(gainParam(search.get('bouncegain'), DEFAULT_BOUNCE_GAIN)),
    emitBounceGain: floatUniform(gainParam(search.get('emitbounce'), DEFAULT_EMIT_BOUNCE_GAIN)),
    reducedFlashes,
    emitGains: Object.fromEntries((Object.keys(EMIT_PARAMS) as EmitterGainKey[]).map(k =>
      [k, floatUniform(gainParam(search.get(EMIT_PARAMS[k]), DEFAULT_EMITTER_GAINS[k]))])) as Record<EmitterGainKey, FloatUniform>,
    fullLevel: floatUniform(cfg.max),
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
  // Wrapped (emitter-layout.ts GLOW_PERIOD_S): an f32 clock that never loses its slots' precision.
  fx.glowTime.value = wrapGlowTime(t);
  fx.ceilWhisper.value = fx.cfg.on ? 0 : CEIL_WHISPER;
  fx.fullLevel.value = fx.cfg.max;
}

/** The emitter-surface lights' power multiplier at boot (glow-mood accents, item 2g B1):
 *  0 with ?emitlights=0, else ?emitlightgain=<n> (default 1). */
export function emitterLightGain(search: URLSearchParams): number {
  return search.get('emitlights') === '0' ? 0 : gainParam(search.get('emitlightgain'), 1);
}
/** A level accent as the game creates it: a glow-mood one scaled by emitterLightGain, or null when that is 0. */
export function emitterAccent<A extends { mood?: string; power: number }>(a: A, search: string): A | null {
  if (a.mood !== 'glow') return a;
  const g = emitterLightGain(new URLSearchParams(search));
  return g > 0 ? { ...a, power: a.power * g } : null;
}
let liveEmitLightGain: number | null = null;
/** Live: rescale every glow-mood lamp's power (the dynamic-light leaf reads `base` each frame) from the
 *  boot gain (or the last one set) to `gain`. Lamps dropped at boot (?emitlights=0) stay dropped.
 *  Returns the gain now in force. */
export function setEmitterLightGain(lamps: { mood: string; base: number }[], gain: number | undefined, search: URLSearchParams): number {
  const cur = liveEmitLightGain ?? emitterLightGain(search);
  if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || cur <= 0) return cur;
  for (const l of lamps) if (l.mood === 'glow') l.base = (l.base / cur) * Math.max(gain, 1e-6);
  liveEmitLightGain = Math.max(gain, 1e-6);
  return liveEmitLightGain;
}

export type SectorLightPatch = Partial<SectorLightConfig> & { glowGain?: number; bounceGain?: number; emitBounceGain?: number }
  & Partial<Record<EmitterGainKey, number>>;
export type SectorLightState = SectorLightConfig & { glowGain: number; bounceGain: number; emitBounceGain: number } & Record<EmitterGainKey, number>;

/** Patch the curve, the toggle, the glow gain or the bounce gain (finite, non-negative numbers only); returns the live state. */
export function setSectorLightConfig(fx: SectorFxRuntime, patch: SectorLightPatch): SectorLightState {
  if (typeof patch.max === 'number' && Number.isFinite(patch.max) && patch.max >= 0) fx.cfg.max = patch.max;
  if (typeof patch.gamma === 'number' && Number.isFinite(patch.gamma) && patch.gamma > 0) fx.cfg.gamma = patch.gamma;
  if (typeof patch.on === 'boolean') fx.cfg.on = patch.on;
  if (typeof patch.glowGain === 'number' && Number.isFinite(patch.glowGain) && patch.glowGain >= 0) fx.glowGain.value = patch.glowGain;
  if (typeof patch.bounceGain === 'number' && Number.isFinite(patch.bounceGain) && patch.bounceGain >= 0) fx.bounceGain.value = patch.bounceGain;
  if (typeof patch.emitBounceGain === 'number' && Number.isFinite(patch.emitBounceGain) && patch.emitBounceGain >= 0) fx.emitBounceGain.value = patch.emitBounceGain;
  for (const k of Object.keys(fx.emitGains) as EmitterGainKey[]) {
    const v = patch[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) fx.emitGains[k].value = v;
  }
  fx.ceilWhisper.value = fx.cfg.on ? 0 : CEIL_WHISPER;
  fx.fullLevel.value = fx.cfg.max;
  const gains = Object.fromEntries(Object.entries(fx.emitGains).map(([k, u]) => [k, u.value])) as Record<EmitterGainKey, number>;
  return { ...fx.cfg, glowGain: fx.glowGain.value, bounceGain: fx.bounceGain.value, emitBounceGain: fx.emitBounceGain.value, ...gains };
}
