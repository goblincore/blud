// src/sim/step.ts
import type { SimState } from './state';
import type { InputCommand, SimEvent } from './types';
import { stepPlayer, clampPlayerHp } from './player';
import type { SimAABB } from './geometry';
import { stepProjectiles } from './projectile';
import { stepHeads, kickHeads } from './head';
import { stepDudes } from './dude';
import { applyExplosionToPlayer } from './explosion';

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
  // Deterministic explosion-vs-player: every dynamite detonation this tic applies
  // falloff damage to the sim-authoritative player. (The legacy AOE loop is
  // player-excluded in main.ts — Task 10 — so the two don't double-count.)
  for (const ev of events) {
    if (ev.kind === 'explosion') {
      applyExplosionToPlayer(state.player, ev.x, ev.y, ev.z, state.rng);
    }
  }
  stepHeads(state.heads, geo, state.tic);
  kickHeads(state.player, state.heads);
  stepDudes(state.dudes, state.player, geo, state.rng, state.tic, events);
  // Both explosion damage (above) and cultist pellet damage (stepDudes) subtract
  // from player.hp this tic; clamp once at the end so it never goes negative.
  clampPlayerHp(state.player);
  return events;
}
