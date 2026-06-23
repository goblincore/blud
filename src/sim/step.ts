// src/sim/step.ts
import type { SimState } from './state';
import type { InputCommand, SimEvent } from './types';
import { stepPlayer } from './player';
import type { SimAABB } from './geometry';
import { stepProjectiles } from './projectile';
import { stepHeads, kickHeads } from './head';

/**
 * Advance the simulation by exactly one 120 Hz tic. PURE with respect to the
 * outside world: no Math.random, no Date/performance.now, no Rapier, no DOM.
 * Mutates `state` in place (cheap; rollback uses cloneSimState to snapshot) and
 * returns the cosmetic events produced this tic.
 */
export function stepSim(state: SimState, input: InputCommand, geo: SimAABB[]): SimEvent[] {
  state.tic++;
  stepPlayer(state.player, input, geo);

  // Integer kinematic integration (BU/tic). Order is array order → stable.
  for (const b of state.bodies) {
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;
  }

  const events: SimEvent[] = [];
  stepProjectiles(state.projectiles, geo, state.tic, events);
  stepHeads(state.heads, geo, state.tic);
  kickHeads(state.player, state.heads);
  return events;
}
