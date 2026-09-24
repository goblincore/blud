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
