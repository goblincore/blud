// src/lab/sdf-zombie/webgpu/game-viewmodel.ts
//
// View-model TIMING for sdf-game.html's sawed-off: the reload state machine,
// the hinge curve, the muzzle-flash envelope and the magazine. Numbers only --
// no Three.js import -- because that is what makes the feel testable without a
// renderer, the same split game-weapon.ts already uses for ballistics.
//
// Beat sheet per the spec's §5 (Doom-SSG rhythm).

export const RELOAD = {
  presentSec:  0.18,
  breakEndSec: 0.34,
  ejectEndSec: 0.46,
  loadEndSec:  0.66,
  snapEndSec:  0.82,
  totalSec:    0.95,
  /** How far the barrels swing off the frame, radians (~35 deg). */
  openRad: 0.61,
} as const;

export const FLASH = {
  /** Visible window, seconds. Short on purpose: a muzzle flash that outlasts
   *  two frames reads as a lamp, not a detonation. */
  windowSec: 0.07,
  /** Exponential decay rate. 60 gives ~2% left at the window's end. */
  decay: 60,
} as const;

export const MAGAZINE_CAPACITY = 2;

export type ReloadPhase =
  | 'present' | 'break' | 'eject' | 'load' | 'snap' | 'settle' | 'done';

/** Which beat the reload is in at `t` seconds since it started. */
export function reloadPhaseAt(t: number): ReloadPhase {
  if (t < 0) return 'done';
  if (t < RELOAD.presentSec)  return 'present';
  if (t < RELOAD.breakEndSec) return 'break';
  if (t < RELOAD.ejectEndSec) return 'eject';
  if (t < RELOAD.loadEndSec)  return 'load';
  if (t < RELOAD.snapEndSec)  return 'snap';
  if (t <= RELOAD.totalSec)   return 'settle';
  return 'done';
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 0 = shut, 1 = fully broken open. Opens through the break beat, holds open
 *  across eject and load, slams shut through snap. Clamped so a caller that
 *  runs past `totalSec` cannot drive the barrels through the frame. */
export function hingeOpenFraction(t: number): number {
  if (t <= RELOAD.presentSec) return 0;
  if (t < RELOAD.breakEndSec) {
    return smoothstep(RELOAD.presentSec, RELOAD.breakEndSec, t);
  }
  if (t < RELOAD.loadEndSec) return 1;
  if (t < RELOAD.snapEndSec) {
    return 1 - smoothstep(RELOAD.loadEndSec, RELOAD.snapEndSec, t);
  }
  return 0;
}

/** Flash brightness at `t` seconds since the shot: instant attack, exponential
 *  decay, hard zero outside the window so nothing lingers a frame too long. */
export function flashEnvelope(t: number): number {
  if (t < 0 || t >= FLASH.windowSec) return 0;
  return Math.exp(-FLASH.decay * t);
}

/** Shells left after pulling `barrels` triggers on a gun holding `shells`.
 *  Both barrels on one shell spends the one shell, not minus one. */
export function magazineAfterFire(shells: number, barrels: 1 | 2): number {
  return Math.max(0, shells - Math.min(shells, barrels));
}
