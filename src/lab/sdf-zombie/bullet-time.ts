// src/lab/sdf-zombie/bullet-time.ts
//
// BULLET TIME (owner 2026-10-25: "like the matrix — you move normal speed but
// everything else slows down"). Pure: the state, the eased world time scale,
// and the two looks the mode turns up — the projectiles' air wake and the gore
// boost. game-tick.ts splits its step on this: the PLAYER runs on four of its
// own scales of the real step — `moveScale` (walking, the jump's takeoff pace,
// the walk bob), `aimScale` (the view-model's catch-up to the reticle, the
// free-aim turn), `fireScale` (cooldown, flash, recoil, the weapon switch and
// the melee weapons) and `reloadScale` (the shotgun break-open, the launcher) —
// the WORLD (actors, enemy projectiles, gibs, blood, dynamite, the sim clock)
// on `worldScale`, and the player's own pellets on `shotScale` (slow enough to
// watch, fast enough not to wait on). Mouse look is never scaled: it is a
// delta, not a rate, so aiming stays instant.
//
// Every scale is ABSOLUTE (a fraction of real time); `scalesAt` turns them
// into what each step is handed.
//
// LIVE TUNING. `BULLET_TIME` is the live, mutable tuning every function here
// defaults to; `BULLET_TIME_DEFAULTS` is the shipped set. `applyBulletTimeTuning`
// is the one validated way to change it (the __sdfGame.bulletTime({...}) seam,
// the BULLET TIME panel and the ?bt_* URL params all go through it), and
// `BULLET_TIME_RANGES` says which knobs it accepts and within what bounds.
//
// Dev trigger: Q toggles (game-player-input.ts). The mode eases in and out
// over `rampSec` of REAL time, so the drop into slow motion reads as a lurch
// rather than a cut. `intensity` is 0 at normal speed and 1 fully in.
import type { Vec3 } from './types';

export const BULLET_TIME_DEFAULTS = {
  /** The world's dt multiplier fully in bullet time. */
  worldScale: 0.2,
  /** The player's MOVEMENT fully in: walking, the jump's pace at takeoff/landing, the walk bob (owner 2026-10-25:
   *  0.5, then "a bit slower like 0.35" for everything the player did). 2026-10-27 it was split off as its own knob
   *  and tried at 0.66; the owner: "go back to how it was — the new faster movement makes it not feel like bullet
   *  time". So 0.35 again; tune it live with __sdfGame.bulletTime({ moveScale }) or ?bt_move=. */
  moveScale: 0.35,
  /** The player's AIM fully in: the view-model's catch-up to the reticle and the free-aim edge turn. */
  aimScale: 0.35,
  /** The player's FIRING fully in: the cooldown, flash/recoil ages, the weapon switch, flare/rod/axe/flail. */
  fireScale: 0.35,
  /** The player's RELOAD fully in: the shotgun's break-open/load and the launcher's cycle (tried at 0.6 on
   *  2026-10-27, reverted with movement on "go back to how it was"; ?bt_reload= / the seam tune it). */
  reloadScale: 0.35,
  /** The PLAYER's pellets' dt multiplier fully in (owner 2026-10-25: 0.2 "takes too long", full speed loses the look). */
  shotScale: 0.5,
  /** The player's VERTICAL dt multiplier fully in AT THE APEX: the shootdodge hang (owner 2026-10-25: "make the
   *  jump floaty", then 0.4 -> 0.2, then "gradually go from 0.35 -> 0.2 and as you are landing accelerate back").
   *  `airScaleAt` eases from the walk's moveScale at takeoff to this at the top and back for the landing (the
   *  takeoff end of that ramp IS moveScale: retune one and the other follows). */
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

/** BULLET_TIME's shape with its numbers widened (and writable), so a caller (a test, the tuning seam) can pass or set
 *  other values. */
type Widen<T> = T extends number ? number : { -readonly [K in keyof T]: Widen<T[K]> };
export type BulletTimeTuning = Widen<typeof BULLET_TIME_DEFAULTS>;

const cloneTuning = (t: BulletTimeTuning): BulletTimeTuning =>
  ({ ...t, wakeRadiusM: { ...t.wakeRadiusM }, gore: { ...t.gore } });

/** The LIVE tuning (see the header): starts as the defaults; change it through applyBulletTimeTuning. */
export const BULLET_TIME: BulletTimeTuning = cloneTuning(BULLET_TIME_DEFAULTS);

/** The knobs applyBulletTimeTuning accepts, each [min, max] inclusive. Scales stay in (0, 1]: 0 would freeze that
 *  part of the player for good, and above 1 bullet time would SPEED it up. */
export const BULLET_TIME_RANGES = {
  worldScale: [0.02, 1],
  moveScale: [0.05, 1],
  aimScale: [0.05, 1],
  fireScale: [0.05, 1],
  reloadScale: [0.05, 1],
  shotScale: [0.02, 1],
  airScale: [0.02, 1],
  rampSec: [0.01, 3],
  wakeStrength: [0, 0.2],
  ownWakeMul: [0, 1],
} as const satisfies Partial<Record<keyof BulletTimeTuning, readonly [number, number]>>;
export type BulletTimeKnob = keyof typeof BULLET_TIME_RANGES;
export const BULLET_TIME_KNOBS = Object.keys(BULLET_TIME_RANGES) as BulletTimeKnob[];

/** The tunable knobs' current values. */
export function bulletTimeKnobs(T: BulletTimeTuning = BULLET_TIME): Record<BulletTimeKnob, number> {
  const out = {} as Record<BulletTimeKnob, number>;
  for (const k of BULLET_TIME_KNOBS) out[k] = T[k];
  return out;
}

/**
 * Validate and apply a partial knob set to `T` (the live tuning by default), in place. A value must be a finite
 * number inside BULLET_TIME_RANGES; anything else — an unknown key, NaN, a string, out of range — is refused (left
 * unchanged) and listed in `rejected` with the reason, rather than clamped, so a typo cannot look applied.
 * `{ reset: true }` (alone or with knobs) restores every knob to BULLET_TIME_DEFAULTS first.
 */
export function applyBulletTimeTuning(
  partial: Record<string, unknown> | null | undefined,
  T: BulletTimeTuning = BULLET_TIME,
): { tuning: Record<BulletTimeKnob, number>; rejected: string[] } {
  const rejected: string[] = [];
  if (partial && typeof partial === 'object') {
    if (partial.reset === true) for (const k of BULLET_TIME_KNOBS) T[k] = BULLET_TIME_DEFAULTS[k];
    for (const [k, v] of Object.entries(partial)) {
      if (k === 'reset') continue;
      if (!(k in BULLET_TIME_RANGES)) { rejected.push(`${k}: unknown knob`); continue; }
      const [lo, hi] = BULLET_TIME_RANGES[k as BulletTimeKnob];
      if (typeof v !== 'number' || !Number.isFinite(v)) { rejected.push(`${k}: not a finite number`); continue; }
      if (v < lo || v > hi) { rejected.push(`${k}: ${v} outside [${lo}, ${hi}]`); continue; }
      T[k as BulletTimeKnob] = v;
    }
  }
  return { tuning: bulletTimeKnobs(T), rejected };
}

/** URL params -> knob partial: ?bt_move= ?bt_aim= ?bt_fire= ?bt_reload= ?bt_shot= ?bt_world= ?bt_air= ?bt_ramp=
 *  (empty / non-numeric ones are dropped here; applyBulletTimeTuning range-checks the rest). */
export const BULLET_TIME_PARAMS: Readonly<Record<string, BulletTimeKnob>> = {
  bt_move: 'moveScale', bt_aim: 'aimScale', bt_fire: 'fireScale', bt_reload: 'reloadScale',
  bt_shot: 'shotScale', bt_world: 'worldScale', bt_air: 'airScale', bt_ramp: 'rampSec',
};
export function bulletTimeFromParams(search: string | URLSearchParams): Partial<Record<BulletTimeKnob, number>> {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out: Partial<Record<BulletTimeKnob, number>> = {};
  for (const [param, knob] of Object.entries(BULLET_TIME_PARAMS)) {
    const raw = q.get(param);
    if (raw === null || raw.trim() === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out[knob] = v;
  }
  return out;
}

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

/** This tick's multipliers at `intensity`, each on the real step: the player's `move` / `aim` / `fire` / `reload`
 *  and its pellets' `shot`; `air` is the APEX hang RELATIVE to `move` (stepPlayer's airScale rides the movement dt,
 *  so the absolute apex hang stays `airScale`). */
export function scalesAt(intensity: number, T: BulletTimeTuning = BULLET_TIME): {
  move: number; aim: number; fire: number; reload: number; shot: number; air: number;
} {
  const move = worldScaleAt(intensity, T.moveScale);
  return {
    move,
    aim: worldScaleAt(intensity, T.aimScale),
    fire: worldScaleAt(intensity, T.fireScale),
    reload: worldScaleAt(intensity, T.reloadScale),
    shot: worldScaleAt(intensity, T.shotScale),
    air: worldScaleAt(intensity, T.airScale) / move,
  };
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
