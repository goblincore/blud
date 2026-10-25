import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import type { Aabb } from './game-level';
import { BARREL, barrelCentre, chainDelay } from './barrel-state';
import { barrelBox, createBarrelCore, type BarrelRuntime } from './barrel-runtime';

const DEFS = [
  { id: 'b1', pos: [0, 0, 0] as Vec3 },
  { id: 'b2', pos: [1.1, 0, 0] as Vec3 },
  { id: 'b3', pos: [9, 0, 0] as Vec3 },
];

/** A core whose explode does what game-barrels does with the blast: detonateAt ends in catchBlast. */
function rig(shielded?: (from: Vec3, to: Vec3) => boolean) {
  const wall: Aabb = { min: [-9, 0, -9], max: [-8, 3, 9] };
  const colliders: Aabb[] = [wall];
  const booms: { id: string; at: Vec3; feet: Vec3 }[] = [];
  let rt: BarrelRuntime;
  rt = createBarrelCore(DEFS, colliders, {
    ...(shielded ? { shielded } : {}),
    explode(id, at, feet) { booms.push({ id, at, feet }); rt.catchBlast(at); },
  });
  return { rt, colliders, booms, wall };
}

const run = (rt: BarrelRuntime, sec: number, dt = 1 / 60) => { for (let t = 0; t < sec - 1e-9; t += dt) rt.step(dt); };

describe('barrel runtime (pure core)', () => {
  it('a barrel box is its drum: feet to top, radius round the centre line', () => {
    expect(barrelBox({ pos: [1, 2, 3] })).toEqual({
      min: [1 - BARREL.radiusM, 2, 3 - BARREL.radiusM], max: [1 + BARREL.radiusM, 2 + BARREL.heightM, 3 + BARREL.radiusM],
    });
  });

  it('pushes one box per barrel into the SAME collider array, and takes a box out when its drum goes', () => {
    const { rt, colliders, wall } = rig();
    expect(colliders.length).toBe(4);
    expect(rt.liveBoxes().length).toBe(3);
    rt.hit('b3', 'slug');
    expect(rt.states.find(b => b.id === 'b3')!.phase).toBe('lit');
    expect(colliders.length).toBe(4);                                 // lit, not gone: the drum still stands
    rt.step(1 / 60);
    expect(rt.states.find(b => b.id === 'b3')!.phase).toBe('gone');
    expect(colliders.length).toBe(3);
    expect(colliders[0]).toBe(wall);
    expect(rt.liveBoxes().length).toBe(2);
  });

  it('a hit to 0 HP goes up on the next step; the blast chains to b2 after its hashed delay; b3 stays', () => {
    const { rt, booms } = rig();
    rt.hit('b1', 'slug');
    expect(booms).toEqual([]);                                        // never inside the hit itself
    run(rt, 1.0);
    expect(booms.map(b => b.id)).toEqual(['b1', 'b2']);
    expect(booms[0]!.at).toEqual(barrelCentre(rt.states[0]!));
    expect(booms[0]!.feet).toEqual([0, 0, 0]);
    expect(rt.log.map(l => [l.id, l.cause])).toEqual([['b1', 'hit'], ['b2', 'chain']]);
    expect(rt.blasts).toBe(2);
    expect(rt.states.map(b => b.phase)).toEqual(['gone', 'gone', 'intact']);
    // b1 went on the first step (clock 1/60); b2 was lit then and goes once its fuse has burned.
    expect(rt.log[1]!.t).toBeCloseTo(1 / 60, 9);
    expect(rt.clock).toBeCloseTo(1.0, 6);
  });

  it('the chain fuse matches the hash (± one step)', () => {
    const { rt } = rig();
    const goneAt: Record<string, number> = {};
    rt.hit('b1', 'slug');
    for (let i = 0; i < 120; i++) {
      rt.step(1 / 120);
      for (const b of rt.states) if (b.phase === 'gone' && goneAt[b.id] === undefined) goneAt[b.id] = rt.clock;
    }
    const gap = goneAt.b2! - goneAt.b1!;
    expect(gap).toBeGreaterThanOrEqual(chainDelay('b2', 1) - 1e-9);
    expect(gap).toBeLessThanOrEqual(chainDelay('b2', 1) + 1 / 120 + 1e-9);
  });

  it('a shielded barrel does not catch the blast', () => {
    const { rt, booms } = rig(() => true);
    rt.hit('b1', 'slug');
    run(rt, 1.0);
    expect(booms.map(b => b.id)).toEqual(['b1']);
    expect(rt.states[1]!.phase).toBe('intact');
  });

  it('any blast lights barrels in reach (dynamite, a rocket), logged as a chain', () => {
    const { rt, booms } = rig();
    rt.catchBlast([9, 0.5, 0.5]);
    expect(rt.states[2]!.phase).toBe('lit');
    expect(rt.log).toEqual([{ id: 'b3', t: 0, cause: 'chain' }]);
    run(rt, 0.5);
    expect(booms.map(b => b.id)).toEqual(['b3']);
  });

  it('hits on unknown or gone barrels are ignored; pellets add up', () => {
    const { rt } = rig();
    rt.hit('nope', 'slug');
    for (let i = 0; i < 4; i++) rt.hit('b3', 'pellet');
    expect(rt.states[2]!.hp).toBe(BARREL.hp - 4 * BARREL.damage.pellet);
    rt.hit('b3', 'pellet');
    expect(rt.states[2]!.phase).toBe('lit');
    rt.step(1 / 60);
    rt.hit('b3', 'slug');
    expect(rt.log.length).toBe(1);
  });

  it('segmentHit returns the nearest standing drum and skips gone ones', () => {
    const { rt } = rig();
    const a: Vec3 = [-2, 0.5, 0], b: Vec3 = [12, 0.5, 0];
    const h = rt.segmentHit(a, b)!;
    expect(h.id).toBe('b1');
    expect(h.t).toBeCloseTo((2 - BARREL.radiusM) / 14, 6);
    expect(rt.segmentHit(a, b, 0.1)!.t).toBeCloseTo((2 - BARREL.radiusM - 0.1) / 14, 6);
    rt.hit('b1', 'slug'); rt.step(1 / 60);                                     // b1 gone, b2 lit (still standing)
    expect(rt.segmentHit(a, b)!.id).toBe('b2');
    expect(rt.segmentHit([0, 2, 5], [0, 2, -5])).toBeNull();                   // over the drums
  });
});
