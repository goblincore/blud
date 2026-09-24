import { describe, expect, it } from 'vitest';
import { DEATH_THROW, HEM_THROW_SHARE, deathThrowVelocities, launchPoints } from './soft-death';
import type { RigPoint } from './rig';

const pt = (y: number): RigPoint => ({ pos: [0, y, 0], prev: [0, y, 0], pinned: y === 0 });
const pts = [pt(0), pt(0.9), pt(1.7), pt(0.3)];

describe('soft-target death throw', () => {
  it('throws along the shot, the top harder than the feet (a topple, not a slide)', () => {
    const v = deathThrowVelocities(pts, [0, 0.4, -2], DEATH_THROW.slug);
    expect(v[0]![2]).toBeCloseTo(-DEATH_THROW.slug.base, 9);
    expect(v[2]![2]).toBeCloseTo(-(DEATH_THROW.slug.base + DEATH_THROW.slug.tilt), 9);
    expect(v[1]![0]).toBe(0);
    for (const q of v) expect(q[1]).toBe(DEATH_THROW.slug.lift);
  });
  it('the hem pendulum gets a share, so the robe trails', () => {
    const v = deathThrowVelocities(pts, [1, 0, 0], DEATH_THROW.pellet, 3);
    const full = deathThrowVelocities(pts, [1, 0, 0], DEATH_THROW.pellet);
    expect(v[3]![0]).toBeCloseTo(full[3]![0] * HEM_THROW_SHARE, 9);
    expect(v[1]).toEqual(full[1]);
  });
  it('launchPoints encodes the velocity as Verlet history and frees pins', () => {
    const out = launchPoints(pts, deathThrowVelocities(pts, [1, 0, 0], DEATH_THROW.slug), 0.01);
    expect(out[0]!.pinned).toBe(false);
    expect((out[2]!.pos[0] - out[2]!.prev[0]) / 0.01).toBeCloseTo(DEATH_THROW.slug.base + DEATH_THROW.slug.tilt, 6);
  });
});

import { planDeath, deathStyleWeights, addSpin, DEATH_BURST, type DeathStyle } from './soft-death';
import { makeRng } from './wander';

describe('planDeath (owner: deaths were "boring and repetitive")', () => {
  const tally = (hit: Parameters<typeof planDeath>[0]) => {
    const rng = makeRng(7);
    const n: Partial<Record<DeathStyle, number>> = {};
    for (let i = 0; i < 400; i++) { const s = planDeath(hit, rng).style; n[s] = (n[s] ?? 0) + 1; }
    return n;
  };
  it('head shots mostly crumple; arm hits mostly spin; skirt hits mostly faceplant; blasts always throw', () => {
    const head = tally({ limb: 'head', bone: 'skull', weapon: 'pellet' });
    expect(head.crumple!).toBeGreaterThan(200);
    const arm = tally({ limb: 'armR', bone: 'upperArm.r', weapon: 'pellet' });
    expect(arm.spin!).toBeGreaterThan(160);
    const hem = tally({ limb: 'torso', bone: 'hem', weapon: 'pellet' });
    expect(hem.faceplant!).toBeGreaterThan(180);
    expect(tally({ limb: 'torso', bone: 'spine', weapon: 'blast' })).toEqual({ thrown: 400 });
  });
  it('a chest pellet can end five different ways (variety is the point)', () => {
    expect(Object.keys(tally({ limb: 'torso', bone: 'spine', weapon: 'pellet' })).length).toBeGreaterThanOrEqual(4);
    expect(deathStyleWeights({ limb: 'torso', bone: 'spine', weapon: 'pellet' }).length).toBe(4);
  });
  it('is deterministic for a seed, and jitters between deaths', () => {
    const a = planDeath({ limb: 'torso', bone: 'spine', weapon: 'slug' }, makeRng(3));
    const b = planDeath({ limb: 'torso', bone: 'spine', weapon: 'slug' }, makeRng(3));
    const c = planDeath({ limb: 'torso', bone: 'spine', weapon: 'slug' }, makeRng(4));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it('only a stagger waits or bursts; bursts stay in range', () => {
    const rng = makeRng(11);
    for (let i = 0; i < 300; i++) {
      const p = planDeath({ limb: 'torso', bone: 'spine', weapon: 'pellet' }, rng);
      if (p.style !== 'stagger') { expect(p.delaySec).toBe(0); expect(p.burst).toBe(0); }
      else {
        expect(p.delaySec).toBeGreaterThanOrEqual(0.35);
        if (p.burst) { expect(p.burst).toBeGreaterThanOrEqual(DEATH_BURST.min); expect(p.burst).toBeLessThanOrEqual(DEATH_BURST.max); }
      }
    }
  });
  it('an arm hit twists him away from the arm struck', () => {
    const rng = makeRng(5);
    for (let i = 0; i < 50; i++) {
      expect(planDeath({ limb: 'armL', bone: 'upperArm.l', weapon: 'pellet' }, rng).spin).toBeLessThanOrEqual(0);
      expect(planDeath({ limb: 'armR', bone: 'upperArm.r', weapon: 'pellet' }, rng).spin).toBeGreaterThanOrEqual(0);
    }
  });
  it('addSpin turns the points about their centroid', () => {
    const pts = [pt(0), pt(1)].map((p, i) => ({ ...p, pos: [i ? 1 : -1, 1, 0] as [number, number, number] }));
    const v = addSpin(pts, [[0, 0, 0], [0, 0, 0]], 2);
    expect(v[0]![2]).toBeCloseTo(2, 9);   // -omega * rx, rx = -1
    expect(v[1]![2]).toBeCloseTo(-2, 9);
  });
});
