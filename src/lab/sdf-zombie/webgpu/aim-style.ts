// src/lab/sdf-zombie/webgpu/aim-style.ts
//
// PER-WEAPON AIM STYLE (owner 2026-10-27): "the dead-zone free look (inspired
// by Realms of the Haunting) will be a per-weapon setting. For the shotgun I
// want it like a conventional FPS — no dead zone basically." Pure: which style
// a slot uses, how the G / setFreeAim session override wins over it, the
// mouselook turn, the anti-drift look pin, and the ease that hands a free-aim
// reticle back to the centre when a weapon switch lands in mouselook.
//
//   'free'       the mouse moves the RETICLE; the camera turns only once the
//                reticle is shoved past the dead zone (free-aim.ts).
//   'mouselook'  the mouse turns the camera directly; the crosshair sits at
//                the screen centre and the shot goes down the view axis.
//
// The session override (G, __sdfGame.setFreeAim) is ONE flag for every weapon:
// null = each weapon's own style, true / false = free aim on / off for all of
// them until the page reloads or setFreeAim(null) hands control back.

import type { AimPoint } from './free-aim';
import type { WeaponSlot } from './game-weapon-slots';

export type AimStyle = 'free' | 'mouselook';

/** Each slot's style. The shotgun is a conventional FPS gun; every other weapon keeps the free-aim default. */
export const SLOT_AIM_STYLE: Readonly<Record<WeaponSlot, AimStyle>> = {
  flail: 'free',
  shotgun: 'mouselook',
  dynamite: 'free',
  launcher: 'free',
  flare: 'free',
  rod: 'free',
  axe: 'free',
};

/** Whether free aim is on for `slot`: the session override when set, else the slot's own style. */
export function freeAimFor(slot: WeaponSlot, override: boolean | null, styles: Readonly<Record<WeaponSlot, AimStyle>> = SLOT_AIM_STYLE): boolean {
  if (override !== null) return override;
  return (styles[slot] ?? 'free') === 'free';
}

/** Radians of view turn per pixel of mouse motion in mouselook. */
export const MOUSELOOK_RAD_PER_PX = 0.0022;

/** Mouselook: the delta turns the view directly (pitch clamped to ±pitchLimit; screen-down dy pitches down). */
export function mouselookTurn(yaw: number, pitch: number, dx: number, dy: number, pitchLimit: number): { yaw: number; pitch: number } {
  return {
    yaw: yaw + dx * MOUSELOOK_RAD_PER_PX,
    pitch: Math.min(pitchLimit, Math.max(-pitchLimit, pitch - dy * MOUSELOOK_RAD_PER_PX)),
  };
}

/**
 * The anti-drift pin (demo-recorder.ts: a frame's `look` is the pose AFTER its dx/dy). Replaying, the pose is
 * pinned to the recorded look; live, the pose the delta just produced IS the frame's look, so it is returned (and
 * written into the frame by the caller, for the recorder). The old live path pinned to a look snapshotted BEFORE the
 * delta was applied, which undid every mouselook turn the same frame — "G turned off normal aiming too".
 */
export function pinLook(
  replaying: boolean, recorded: readonly [number, number], pose: { yaw: number; pitch: number },
): [number, number] {
  return replaying ? [recorded[0], recorded[1]] : [pose.yaw, pose.pitch];
}

/** Rate (1/s) at which a reticle left off-centre eases back to the centre in mouselook: ~95% in 0.2 s. */
export const AIM_CENTRE_RATE = 15;

/** One step of the reticle's ease to the centre (mouselook): exponential, snapping to exactly 0 once negligible. */
export function easeAimToCentre(aim: AimPoint, dt: number, rate: number = AIM_CENTRE_RATE): AimPoint {
  if (aim.x === 0 && aim.y === 0) return aim;
  const k = Math.exp(-rate * Math.max(0, dt));
  const x = aim.x * k, y = aim.y * k;
  return Math.hypot(x, y) < 1e-4 ? { x: 0, y: 0 } : { x, y };
}
