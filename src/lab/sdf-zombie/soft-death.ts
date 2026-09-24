// src/lab/sdf-zombie/soft-death.ts
//
// SOFT-TARGET DEATH THROW (cultist, owner playtest 2026-09-24): "if they get
// hit they fly back/ragdoll and the outfit does some interesting distortion".
// A soft target (MotionProfile.soft) dies to its first hit. The collapse
// releases the rest pull and gravity takes the Verlet rig; this module gives
// that ragdoll its first velocity so the body is THROWN along the shot
// instead of folding on the spot (it used to crumple toward the shooter).
//
// Per rig point: v = dir * (base + tilt * h) + up * lift, where h is the
// point's height in the body, 0 at the lowest joint and 1 at the highest.
// The top travels further than the feet, so the body topples BACK over its
// heels. The cloth pendulum (the hem point) gets only `hemShare` of it, so
// the robe hangs back and trails the body before it follows.
//
// Pure: no randomness, no clock.
import type { RigPoint } from './rig';
import type { Vec3 } from './types';

export interface DeathThrow {
  /** m/s along the shot at the lowest joint. */
  base: number;
  /** Extra m/s along the shot at the highest joint. */
  tilt: number;
  /** m/s straight up, every joint. */
  lift: number;
}

/** Heavy rounds throw; light ones tip. Eyeballed against the game capture
 *  (.lab-tmp shoot-cultist, 2026-09-24): the rig damps ~6% per sub-step, so
 *  these are launch speeds, not flight speeds. */
export const DEATH_THROW: Record<'slug' | 'pellet' | 'blast', DeathThrow> = {
  slug: { base: 2.2, tilt: 3.2, lift: 1.1 },
  blast: { base: 3.0, tilt: 3.0, lift: 2.0 },
  pellet: { base: 1.0, tilt: 2.2, lift: 0.5 },
};

/** The hem pendulum's share of the throw: cloth lags the body. */
export const HEM_THROW_SHARE = 0.3;

/**
 * Per-point launch velocities for a death throw along `dirWorld` (only its
 * horizontal part is used; a zero direction throws straight up only).
 * `hemIndex` is the cloth pendulum point, or -1.
 */
export function deathThrowVelocities(
  points: readonly RigPoint[], dirWorld: Vec3, t: DeathThrow, hemIndex = -1,
): Vec3[] {
  const l = Math.hypot(dirWorld[0], dirWorld[2]);
  const dx = l > 1e-6 ? dirWorld[0] / l : 0;
  const dz = l > 1e-6 ? dirWorld[2] / l : 0;
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p.pos[1]); hi = Math.max(hi, p.pos[1]); }
  const span = hi - lo > 1e-6 ? hi - lo : 1;
  return points.map((p, i) => {
    const h = (p.pos[1] - lo) / span;
    const k = i === hemIndex ? HEM_THROW_SHARE : 1;
    const along = (t.base + t.tilt * h) * k;
    return [dx * along, t.lift * k, dz * along];
  });
}

/** Verlet launch: velocity is (pos - prev) / dt, so set prev behind pos. */
export function launchPoints(points: readonly RigPoint[], vel: readonly Vec3[], dt: number): RigPoint[] {
  return points.map((p, i) => {
    const v = vel[i]!;
    return { ...p, pinned: false, prev: [p.pos[0] - v[0] * dt, p.pos[1] - v[1] * dt, p.pos[2] - v[2] * dt] };
  });
}
