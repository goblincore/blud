// src/lab/sdf-zombie/webgpu/hazard-floor.ts
//
// HURT FLOORS (spec 2026-10-24 §8): standing on a hurt sector deals whole points of damage once a
// second, the first after half a second (Doom hits every 32 tics; a whole-point tick keeps the HUD
// and the red flash readable). Stepping off resets it. Pure: no three.js, no DOM.

const PERIOD_S = 1;
const FIRST_S = 0.5;

export interface HazardState { acc: number }

export function newHazard(): HazardState {
  return { acc: PERIOD_S - FIRST_S };
}

/** One sim step on a floor hurting `hurtPerSec` (0 = safe). Returns the damage to apply now. */
export function stepHazard(h: HazardState, hurtPerSec: number, dt: number): number {
  if (!(hurtPerSec > 0)) { h.acc = PERIOD_S - FIRST_S; return 0; }
  h.acc += dt;
  let dmg = 0;
  while (h.acc >= PERIOD_S) { h.acc -= PERIOD_S; dmg += Math.round(hurtPerSec * PERIOD_S); }
  return dmg;
}
