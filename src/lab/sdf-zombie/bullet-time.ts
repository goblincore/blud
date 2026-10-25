// src/lab/sdf-zombie/bullet-time.ts
//
// BULLET TIME (owner 2026-10-25: "like the matrix — you move normal speed but
// everything else slows down"). Pure: the state, the eased world time scale,
// and the two looks the mode turns up — the projectiles' air wake and the gore
// boost. game-tick.ts splits its step on this: the PLAYER (motion, aim, the
// view-model, firing and reload) runs on `playerScale` of the real step, the
// WORLD (actors, enemy projectiles, gibs, blood, dynamite, the sim clock) on
// `worldScale`, and the player's own pellets on `shotScale` (slow enough to
// watch, fast enough not to wait on). Mouse look is never scaled: it is a
// delta, not a rate, so aiming stays instant.
//
// Every scale is ABSOLUTE (a fraction of real time); `scalesAt` turns them
// into what each step is handed.
//
// Dev trigger: Q toggles (game-player-input.ts). The mode eases in and out
// over `rampSec` of REAL time, so the drop into slow motion reads as a lurch
// rather than a cut. `intensity` is 0 at normal speed and 1 fully in.
import type { Vec3 } from './types';

export const BULLET_TIME = {
  /** The world's dt multiplier fully in bullet time. */
  worldScale: 0.2,
  /** The PLAYER's (owner 2026-10-25: 0.5, then "a bit slower like 0.35"): motion, aim, firing and reload. */
  playerScale: 0.35,
  /** The PLAYER's pellets' dt multiplier fully in (owner 2026-10-25: 0.2 "takes too long", full speed loses the look). */
  shotScale: 0.5,
  /** The player's VERTICAL dt multiplier fully in AT THE APEX: the shootdodge hang (owner 2026-10-25: "make the
   *  jump floaty", then 0.4 -> 0.2, then "gradually go from 0.35 -> 0.2 and as you are landing accelerate back").
   *  `airScaleAt` eases from the walk's playerScale at takeoff to this at the top and back for the landing. */
  airScale: 0.2,
  /** Real seconds to ease fully in (and out). */
  rampSec: 0.3,
  /** Peak UV offset of one projectile's air wake (post-aa's burn band). */
  wakeStrength: 0.03,
  /** The PLAYER's own pellets' wake, as a fraction of wakeStrength (owner 2026-10-25: "too intense for the player
   *  FPV ... either don't have them or subtle"). 0 drops them. They also only take slots incoming shots leave free. */
  ownWakeMul: 0.2,
  /** World radius of a pellet's wake ring, and of a rocket's / bile glob's. */
  wakeRadiusM: { pellet: 0.22, heavy: 0.45 },
  /** Wakes closer to the eye than this are skipped: a pellet still at the muzzle would warp half the screen. */
  wakeNearM: 1.2,
  /** ...and further than this are not worth a slot. */
  wakeFarM: 25,
  /** The post pass's slot ring holds four bands, blasts included. */
  maxWakes: 4,
  /** Gore fully in: every droplet spawned gets `extra` siblings, `sizeMul` times the size, living `lifeMul` longer. */
  gore: { extra: 2, sizeMul: 1.45, lifeMul: 1.6, spread: 0.35 },
} as const;

/** BULLET_TIME's shape with its numbers widened, so a caller (a test, a tuning panel) can pass other values. */
type Widen<T> = T extends number ? number : { readonly [K in keyof T]: Widen<T[K]> };
export type BulletTimeTuning = Widen<typeof BULLET_TIME>;

export interface BulletTimeState {
  /** Whether the mode is wanted (the toggle); `intensity` follows it. */
  on: boolean;
  /** 0 = normal time, 1 = fully in. Eased toward `on` on real time. */
  intensity: number;
}

export const makeBulletTime = (): BulletTimeState => ({ on: false, intensity: 0 });

export function toggleBulletTime(s: BulletTimeState): void { s.on = !s.on; }

/** Smoothstep of the intensity: the time scale's lurch in. */
const ease = (x: number): number => x * x * (3 - 2 * x);

/** The world's dt multiplier at `intensity` (1 at 0, worldScale at 1). */
export function worldScaleAt(intensity: number, worldScale: number = BULLET_TIME.worldScale): number {
  return 1 + (worldScale - 1) * ease(Math.max(0, Math.min(1, intensity)));
}

/** Advance the ramp on the REAL step and return this tick's world dt multiplier. */
export function stepBulletTime(s: BulletTimeState, realDt: number, T: BulletTimeTuning = BULLET_TIME): number {
  const d = Math.max(0, realDt) / T.rampSec;
  s.intensity = s.on ? Math.min(1, s.intensity + d) : Math.max(0, s.intensity - d);
  return worldScaleAt(s.intensity, T.worldScale);
}

/** This tick's multipliers at `intensity`: `player` on the real step; `shot` on the real step; `air` the APEX hang
 *  RELATIVE to `player` (stepPlayer's airScale rides the player's dt, so the absolute apex hang stays `airScale`). */
export function scalesAt(intensity: number, T: BulletTimeTuning = BULLET_TIME): { player: number; shot: number; air: number } {
  const player = worldScaleAt(intensity, T.playerScale);
  return { player, shot: worldScaleAt(intensity, T.shotScale), air: worldScaleAt(intensity, T.airScale) / player };
}

/**
 * stepPlayer's airScale this step (relative to the player's dt): 1 on the ground and wherever the player moves
 * vertically at the jump's own speed (takeoff, landing, any faster fall), easing to `scalesAt(...).air` as the
 * vertical speed drops to 0 at the apex. Retiming the arc leaves its shape alone, so the jump keeps its height.
 */
export function airScaleAt(intensity: number, vy: number, grounded: boolean, jumpSpeed: number, T: BulletTimeTuning = BULLET_TIME): number {
  if (grounded || !(intensity > 0) || !(jumpSpeed > 0)) return 1;
  const apex = scalesAt(intensity, T).air;
  const h = ease(Math.max(0, Math.min(1, 1 - Math.abs(vy) / jumpSpeed)));
  return 1 + (apex - 1) * h;
}

/** `own` = the player's shot (faint, and ranked after every incoming one). */
export interface WakeSource { pos: Vec3; heavy: boolean; own?: boolean }
export interface Wake { pos: Vec3; radiusM: number; strength: number }

/**
 * The projectiles' air wakes for this frame: the `maxWakes` NEAREST in-range
 * sources to the eye, incoming shots before the player's own (a near wake
 * bends more of the screen, so it earns a slot over a far one; the player's
 * own pellets are faint and fill only what is left). Empty at intensity 0.
 */
export function pickWakes(sources: readonly WakeSource[], eye: Vec3, intensity: number, T: BulletTimeTuning = BULLET_TIME): Wake[] {
  if (!(intensity > 0)) return [];
  const near2 = T.wakeNearM * T.wakeNearM, far2 = T.wakeFarM * T.wakeFarM;
  const live: { s: WakeSource; d2: number }[] = [];
  for (const s of sources) {
    if (s.own && !(T.ownWakeMul > 0)) continue;
    const dx = s.pos[0] - eye[0], dy = s.pos[1] - eye[1], dz = s.pos[2] - eye[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= near2 && d2 <= far2) live.push({ s, d2 });
  }
  live.sort((a, b) => Number(!!a.s.own) - Number(!!b.s.own) || a.d2 - b.d2);
  const k = ease(Math.min(1, intensity));
  return live.slice(0, T.maxWakes).map(({ s }) => ({
    pos: s.pos,
    radiusM: s.heavy ? T.wakeRadiusM.heavy : T.wakeRadiusM.pellet,
    strength: T.wakeStrength * k * (s.heavy ? 1.3 : 1) * (s.own ? T.ownWakeMul : 1),
  }));
}

/** blood-sim.ts's GoreBoost at `intensity`, or null at normal time (the shipped spawns, bit-identical). */
export function goreBoostAt(intensity: number, T: BulletTimeTuning = BULLET_TIME): { extra: number; sizeMul: number; lifeMul: number; spread: number } | null {
  if (!(intensity > 0.5)) return null;
  const k = ease(Math.min(1, intensity));
  return {
    extra: T.gore.extra,
    sizeMul: 1 + (T.gore.sizeMul - 1) * k,
    lifeMul: 1 + (T.gore.lifeMul - 1) * k,
    spread: T.gore.spread,
  };
}
