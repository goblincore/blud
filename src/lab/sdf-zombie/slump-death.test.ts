import { describe, expect, it } from 'vitest';
import { SLUMP, planSlump, slumpVelocities } from './slump-death';
import { plantFeet, releaseFeet, type FootPlant } from './collapse';
import type { RigPoint } from './rig';
import type { Vec3 } from './types';

const pt = (pos: Vec3, pinned = false): RigPoint => ({ pos, prev: pos, pinned });
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };

describe('the forward slump (slump-death.ts)', () => {
  it('rolls against its chance, and jitters inside +-25%', () => {
    expect(planSlump(seq(SLUMP.chance + 0.01, 0.5, 0.5, 0.5))).toBeNull();
    const p = planSlump(seq(0, 0, 1, 0.5))!;
    expect(p.tilt).toBeCloseTo(SLUMP.tilt * 0.75);
    expect(p.drop).toBeCloseTo(SLUMP.drop * 1.25);
    expect(p.spin).toBeCloseTo(0);
  });

  it('leaves the feet still and pitches the top forward and down', () => {
    const points = [pt([0, 0.05, 0]), pt([0, 0.55, 0]), pt([0, 1.65, 0])];
    const v = slumpVelocities(points, [0, 0, 1], { tilt: 2, drop: 1, spin: 0 });
    expect(v[0]).toEqual([0, -0, 0]);
    expect(v[2]![2]).toBeCloseTo(2);
    expect(v[2]![1]).toBeCloseTo(-1);
    expect(v[1]![2]).toBeGreaterThan(0);
    expect(v[1]![2]).toBeLessThan(v[2]![2]);
  });
});

describe('plantFeet with knees (the slump)', () => {
  // hip, knee, foot
  const plants: FootPlant[] = [{ hip: 0, knee: 1, foot: 2, thigh: 0.46, shin: 0.5 }];
  const floor = () => 0.05;

  it('plants a knee that comes down onto the floor, at any speed, and frees its foot', () => {
    const knee: RigPoint = { pos: [0, 0.06, 0.3], prev: [0, 0.2, 0.1], pinned: false };
    const out = plantFeet([pt([0, 0.4, 0]), knee, pt([0, 0.05, -0.2], true)], plants, floor, 1 / 60, undefined, true);
    expect(out[1]!.pinned).toBe(true);
    expect(out[1]!.prev).toEqual(out[1]!.pos);
    expect(out[2]!.pinned).toBe(false);
  });

  it('without knees, a knee on the floor stays free', () => {
    const out = plantFeet([pt([0, 0.4, 0]), pt([0, 0.06, 0.3]), pt([0, 0.05, -0.2], true)], plants, floor, 1 / 60, undefined, false);
    expect(out[1]!.pinned).toBe(false);
  });

  it('releaseFeet frees planted knees and feet alike', () => {
    const out = releaseFeet([pt([0, 0.4, 0]), pt([0, 0.06, 0.3], true), pt([0, 0.05, -0.2], true)], plants);
    expect(out.every(p => !p.pinned)).toBe(true);
  });
});
