// src/sim/step.ts
import type { SimState } from './state';
import type { InputCommand, SimEvent } from './types';

/**
 * Advance the simulation by exactly one 120 Hz tic. PURE with respect to the
 * outside world: no Math.random, no Date/performance.now, no Rapier, no DOM.
 * Mutates `state` in place (cheap; rollback uses cloneSimState to snapshot) and
 * returns the cosmetic events produced this tic.
 *
 * `input` is consumed starting in the player plan (movement/aim/buttons).
 */
export function stepSim(state: SimState, input: InputCommand): SimEvent[] {
  void input; // applied to the player in plan 2
  state.tic++;

  // Integer kinematic integration (BU/tic). Order is array order → stable.
  for (const b of state.bodies) {
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;
  }

  return [];
}
