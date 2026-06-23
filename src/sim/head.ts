// src/sim/head.ts
import { fpFromMeters, metersPerSecToFp } from './fp';
import { TICS_PER_SEC } from './units';
import { stepThing, type ThingState } from './thing';
import type { SimAABB } from './geometry';

/** A severed zombie head: a deterministic kThing (gravity + floor/wall bounce)
 *  that the player can kick. Shared/interactable — lives on SimState so co-op
 *  peers see the same head land in the same place. */
export interface HeadState extends ThingState {
  kickCooldownTics: number; // ticks until the head can be kicked again (anti-pin)
  spawnTic: number;         // tic of spawn, for age-despawn
}

export const HEAD_RADIUS = fpFromMeters(0.18);  // matches the old ball collider (0.18 m)
export const HEAD_ELASTIC = 42598;              // 0.65 restitution in 16.16 — lively roll/bounce
export const HEAD_MAX_AGE_TICS = Math.round(30 * TICS_PER_SEC); // 30 s, then despawn

/** Spawn a head into the sim. Position is fp (y = bottom; floor = 0); velocity is fp/tic. */
export function spawnHead(
  heads: HeadState[],
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  tic: number,
): void {
  heads.push({
    x, y, z, vx, vy, vz,
    radius: HEAD_RADIUS, elastic: HEAD_ELASTIC, resting: false,
    kickCooldownTics: 0, spawnTic: tic,
  });
}

/** Advance all heads one tic: decay kick cooldown, integrate physics, age-despawn.
 *  `tic` is the current SimState.tic. Mutates `heads`. */
export function stepHeads(heads: HeadState[], geo: SimAABB[], tic: number): void {
  for (let i = heads.length - 1; i >= 0; i--) {
    const h = heads[i]!;
    if (h.kickCooldownTics > 0) h.kickCooldownTics--;
    stepThing(h, geo);
    if (tic - h.spawnTic >= HEAD_MAX_AGE_TICS) heads.splice(i, 1);
  }
}
