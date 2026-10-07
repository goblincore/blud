// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-hit-trace.test.ts
//
// traceMeleeHitFrom: the straight, reach-capped ray the rod uses (no gravity, no 60 m march), against stub bodies.
import { describe, expect, it } from 'vitest';
import { traceMeleeHitFrom } from './game-hit-trace';
import { prim } from '../head-pop';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';

/** A torso capsule at x, y 1.0..1.5, radius 0.15, with a cluster sphere around it (the broad phase's input). */
function body(id: number, x: number, z = 0): ZombieActor {
  const posed = () => {
    const torso = prim([x, 1.0, z], [x, 1.5, z], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
    return { prims: [torso], clusters: [{ id: 1, limb: 'torso', start: 0, count: 1, center: [x, 1.25, z] as Vec3, radius: 0.45, alive: true }] };
  };
  return { id, posed } as unknown as ZombieActor;
}
const ctxOf = (...actors: ZombieActor[]) => ({ world: { actors } }) as unknown as GameContext;

describe('traceMeleeHitFrom', () => {
  it('is a straight ray: the hit is exactly on the aim line (no ballistic drop)', () => {
    const r = traceMeleeHitFrom(ctxOf(body(7, 0.4)), [0.4, 1.25, 1.0], [0, 0, -1], 2.2);
    expect(r.actorId).toBe(7);
    expect(r.hit![1]).toBeCloseTo(1.25, 6);
    expect(r.hit![0]).toBeCloseTo(0.4, 6);
    expect(r.hit![2]).toBeCloseTo(0.15, 2);
  });

  it('hits beyond the reach are not found (the ray stops at reach)', () => {
    const r = traceMeleeHitFrom(ctxOf(body(7, 0.4)), [0.4, 1.25, 4.0], [0, 0, -1], 2.2);   // skin 3.85 m away
    expect(r).toEqual({ actorId: -1, hit: null });
    const near = traceMeleeHitFrom(ctxOf(body(7, 0.4)), [0.4, 1.25, 2.0], [0, 0, -1], 2.2);   // skin 1.85 m away
    expect(near.actorId).toBe(7);
  });

  it('the nearest body along the ray wins; a body off the ray is ignored', () => {
    const r = traceMeleeHitFrom(ctxOf(body(8, 0.4, -1), body(7, 0.4, 0), body(9, 3, 0)), [0.4, 1.25, 1.0], [0, 0, -1], 2.2);
    expect(r.actorId).toBe(7);
  });
});
