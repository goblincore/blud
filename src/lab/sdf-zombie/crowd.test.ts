// src/lab/sdf-zombie/crowd.test.ts
import { describe, it, expect } from 'vitest';
import { CROWD_TUNING, separate, type CrowdAgent } from './crowd';

const z = (x: number, zz: number, r = 0.35): CrowdAgent => ({ x, z: zz, r, mobile: true });
const fixed = (x: number, zz: number, r = 0.32): CrowdAgent => ({ x, z: zz, r, mobile: false });
const dist = (a: CrowdAgent, b: CrowdAgent) => Math.hypot(a.x - b.x, a.z - b.z);

/** Applies one separate() pass and returns the moved agents. */
function relax(agents: CrowdAgent[]): CrowdAgent[] {
  const push = separate(agents);
  return agents.map((a, i) => ({ ...a, x: a.x + push[i]![0], z: a.z + push[i]![1] }));
}

describe('separate', () => {
  it('leaves agents that are not overlapping exactly alone', () => {
    const push = separate([z(0, 0), z(3, 0)]);
    expect(push).toEqual([[0, 0], [0, 0]]);
  });

  it('shrinks a pair overlap by the factor the tuning predicts', () => {
    // Two 0.35 m circles 0.5 m apart: want 0.7, overlap 0.2.
    // Each iteration removes `stiffness` of the CURRENT overlap, so after
    // n iterations the overlap is (1 - stiffness)^n of the original. This is
    // soft on purpose — see the spec; it does NOT fully separate in one frame.
    const before = [z(0, 0), z(0.5, 0)];
    const after = relax(before);
    const expected = 0.2 * (1 - CROWD_TUNING.stiffness) ** CROWD_TUNING.iterations;
    expect(dist(after[0]!, after[1]!)).toBeCloseTo(0.7 - expected, 6);
  });

  it('converges: repeated frames drive the overlap under a millimetre', () => {
    let agents = [z(0, 0), z(0.5, 0)];
    for (let i = 0; i < 40; i++) agents = relax(agents);
    expect(dist(agents[0]!, agents[1]!)).toBeGreaterThan(0.7 - 0.001);
  });

  it('corrections are equal and opposite for two mobile agents', () => {
    const push = separate([z(0, 0), z(0.5, 0)]);
    expect(push[0]![0]).toBeCloseTo(-push[1]![0], 12);
    expect(push[0]![1]).toBeCloseTo(-push[1]![1], 12);
  });

  it('an immobile agent never moves and its partner takes the whole push', () => {
    const push = separate([z(0.5, 0), fixed(0, 0)]);
    expect(push[1]).toEqual([0, 0]);
    // Whole share, not half: overlap 0.67 - 0.5 = 0.17, relaxed twice at 0.5.
    const solo = 0.17 * (1 - (1 - CROWD_TUNING.stiffness) ** CROWD_TUNING.iterations);
    expect(push[0]![0]).toBeCloseTo(solo, 6);
    expect(push[0]![1]).toBeCloseTo(0, 12);
  });

  it('two immobile agents are never pushed apart', () => {
    expect(separate([fixed(0, 0), fixed(0.1, 0)])).toEqual([[0, 0], [0, 0]]);
  });

  it('separates coincident agents deterministically', () => {
    const a = separate([z(1, 1), z(1, 1)]);
    const b = separate([z(1, 1), z(1, 1)]);
    expect(a).toEqual(b);
    expect(Math.hypot(a[0]![0], a[0]![1])).toBeGreaterThan(0);
  });

  it('caps one frame of correction at maxPush', () => {
    // A deep pile: three bodies stacked nearly on one point.
    const push = separate([z(0, 0), z(0.01, 0), z(0.02, 0)]);
    for (const p of push) {
      expect(Math.hypot(p[0], p[1])).toBeLessThanOrEqual(CROWD_TUNING.maxPush + 1e-9);
    }
  });

  it('returns zero-length results for degenerate inputs', () => {
    expect(separate([])).toEqual([]);
    expect(separate([z(0, 0)])).toEqual([[0, 0]]);
  });
});
