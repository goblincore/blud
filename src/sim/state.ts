// src/sim/state.ts
import { createRng, type SimRng } from './rng';
import type { KinematicBody } from './types';
import { createPlayerState, type PlayerState } from './player';
import type { ProjectileState } from './projectile';

/** The entire deterministic simulation state. Plain serializable data only —
 *  no class instances, no Rapier handles, no closures — so it can be hashed and
 *  cloned (rollback-ready). Later plans add typed entity collections
 *  (player, dudes, projectiles); the foundation carries a generic body list. */
export interface SimState {
  tic: number;
  rng: SimRng;
  bodies: KinematicBody[];
  player: PlayerState;
  projectiles: ProjectileState[];
}

export function createSimState(seed: number): SimState {
  return { tic: 0, rng: createRng(seed), bodies: [], player: createPlayerState(), projectiles: [] };
}
