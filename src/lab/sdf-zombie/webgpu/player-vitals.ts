// src/lab/sdf-zombie/webgpu/player-vitals.ts
//
// PLAYER HEALTH. Pure numbers so the rules are testable without a renderer.
// Two damage kinds, because they arrive differently: a zombie swing reports one
// contact per swing but can re-report while arms overlap, so melee gets a short
// invulnerability window; soldier pellets arrive as several separate pellets in
// one volley and each one should count.
//
// Refreshed 2026-09-26 (docs/superpowers/plans/2026-09-26-game-loop.md): zombie bites by
// proximity (bitesInReach), the bride's sword, new defaults.

import type { Vec3 } from '../types';

/** Defaults (owner 2026-09-26: "make some defaults you think are okay and we can tweak"). */
export const VITALS = {
  maxHealth: 100,
  /** One zombie bite. Zombies never report melee contact, so a live zombie within
   *  `biteReach` of the player bites, rate-limited by `meleeInvulnSec`. */
  zombieBite: 10,
  biteReach: 0.9,
  /** One landed swing of the bride's sword (its mind reports contact). */
  swordHit: 15,
  /** One soldier pellet or cultist SMG round (they share a projectile list). */
  soldierPellet: 3,
  /** After a melee hit, further melee is ignored for this long. */
  meleeInvulnSec: 0.8,
} as const;

export type DamageKind = 'melee' | 'pellet';

export interface Vitals {
  health: number;
  meleeInvulnSec: number;
  dead: boolean;
  /** Seconds since the last damage; drives the hurt flash. */
  hurtAge: number;
}

export function makeVitals(): Vitals {
  return { health: VITALS.maxHealth, meleeInvulnSec: 0, dead: false, hurtAge: Infinity };
}

export function applyDamage(v: Vitals, amount: number, kind: DamageKind): Vitals {
  if (v.dead || amount <= 0) return v;
  if (kind === 'melee' && v.meleeInvulnSec > 0) return v;
  const health = Math.max(0, v.health - amount);
  return {
    health,
    dead: health <= 0,
    hurtAge: 0,
    meleeInvulnSec: kind === 'melee' ? VITALS.meleeInvulnSec : v.meleeInvulnSec,
  };
}

export function heal(v: Vitals, amount: number): Vitals {
  if (v.dead) return v;
  return { ...v, health: Math.min(VITALS.maxHealth, v.health + Math.max(0, amount)) };
}

export function stepVitals(v: Vitals, dt: number): Vitals {
  const d = Math.max(0, dt);
  return { ...v, meleeInvulnSec: Math.max(0, v.meleeInvulnSec - d), hurtAge: v.hurtAge + d };
}

/** Does a pellet's frame segment pass within `radius` of the player's capsule
 *  axis (a vertical segment from feet+radius to feet+height−radius)? Sampled
 *  along the segment at half-radius steps: exact enough for pellets, and a
 *  fast pellet cannot skip the body because the step is fixed in metres. */
export function segmentHitsCapsule(from: Vec3, to: Vec3, feet: Vec3, radius: number, height: number): boolean {
  const lo = feet[1] + radius;
  const hi = feet[1] + height - radius;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const n = Math.max(1, Math.ceil(len / (radius * 0.5)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = from[0] + (to[0] - from[0]) * t;
    const py = from[1] + (to[1] - from[1]) * t;
    const pz = from[2] + (to[2] - from[2]) * t;
    const ay = Math.min(hi, Math.max(lo, py));
    if (Math.hypot(px - feet[0], py - ay, pz - feet[2]) <= radius) return true;
  }
  return false;
}

/** Ids of the zombies close enough to bite: alive (not collapsed), horizontally within `reach`. */
export function bitesInReach(feet: Vec3, zombies: readonly { id: number; pos: Vec3; down: boolean }[], reach: number): number[] {
  return zombies.filter(z => !z.down && Math.hypot(z.pos[0] - feet[0], z.pos[2] - feet[2]) <= reach).map(z => z.id);
}
