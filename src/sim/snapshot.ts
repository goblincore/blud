// src/sim/snapshot.ts
import type { SimState } from './state';

/**
 * Deep copy of the (plain-data) sim state. Explicit field-by-field copy — not
 * structuredClone — so it stays fast and obvious as state grows. This is what a
 * future rollback netcode saves/restores per tic; for now the harness uses it
 * to prove snapshot fidelity. Extend alongside SimState in later plans.
 */
export function cloneSimState(s: SimState): SimState {
  return {
    tic: s.tic,
    rng: { a: s.rng.a },
    bodies: s.bodies.map((b) => ({ ...b })),
    player: { ...s.player },
    projectiles: s.projectiles.map((p) => ({ ...p })),
  };
}
