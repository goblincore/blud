// src/lab/sdf-zombie/blast-player.ts
//
// THE PLAYER'S SHARE OF A BLAST (plan 2026-10-25-sector-levels-3b): the rocket's rule (rockets.ts blastFalloff —
// 1 at the epicentre, quadratic to 0 at the radius) for any blast with a profile. Rockets keep their own functions
// (proven equal in the test); barrels use BLAST_PROFILES.barrel. Dynamite has no profile: it does not hurt the
// player — enemies only (owner, 2026-10-25).
//
// Pure: no three.js, no DOM.
import type { Vec3 } from './types';

export interface BlastProfile { maxDamage: number; radiusM: number }

export const BLAST_PROFILES = {
  /** Doom's barrel kills at point-blank; ours takes half the player's 100 and some (owner may retune). */
  barrel: { maxDamage: 55, radiusM: 4.0 },
} as const satisfies Record<string, BlastProfile>;

export function blastFalloffFor(dist: number, p: BlastProfile): number {
  const u = Math.max(0, 1 - dist / p.radiusM);
  return u * u;
}

export function playerBlastDamage(dist: number, p: BlastProfile): number {
  return Math.round(p.maxDamage * blastFalloffFor(dist, p));
}

/** Blast → the player's capsule centre (feet + height / 2), the distance the rocket path measures. */
export function blastToPlayer(at: Vec3, feet: Vec3, height: number): number {
  return Math.hypot(feet[0] - at[0], feet[1] + height * 0.5 - at[1], feet[2] - at[2]);
}
