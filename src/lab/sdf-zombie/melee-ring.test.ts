// src/lab/sdf-zombie/melee-ring.test.ts
import { describe, it, expect } from 'vitest';
import { RING_TUNING, arbitrate, bearingTo, type RingClaimant } from './melee-ring';

const P = { x: 0, z: 0 };

/** A claimant at `deg` around the player (0 = +z), `d` metres out. */
function at(id: number, deg: number, d = 1, over: Partial<RingClaimant> = {}): RingClaimant {
  const r = (deg * Math.PI) / 180;
  return { id, x: Math.sin(r) * d, z: Math.cos(r) * d, committed: false, incumbent: false, ...over };
}

describe('bearingTo', () => {
  it('uses the wander heading convention: 0 = +z, positive clockwise', () => {
    expect(bearingTo(P, { x: 0, z: 1 })).toBeCloseTo(0, 9);
    expect(bearingTo(P, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('arbitrate', () => {
  it('handles the degenerate inputs', () => {
    expect(arbitrate(P, []).holders.size).toBe(0);
    const one = arbitrate(P, [at(1, 0)]);
    expect([...one.holders]).toEqual([1]);
    expect(one.drift.get(1)).toBe(0);
  });

  it('never grants more than `tokens`', () => {
    const many = [at(1, 0), at(2, 90), at(3, 180), at(4, 270)];
    expect(arbitrate(P, many).holders.size).toBe(RING_TUNING.tokens);
  });

  it('refuses a second token closer than minSlotAngle to a holder', () => {
    // 0 deg and 30 deg: well inside the 90 deg minimum.
    const v = arbitrate(P, [at(1, 0, 1), at(2, 30, 1.2)]);
    expect([...v.holders]).toEqual([1]);
  });

  it('grants a second token at exactly minSlotAngle', () => {
    const deg = (RING_TUNING.minSlotAngle * 180) / Math.PI;
    const v = arbitrate(P, [at(1, 0, 1), at(2, deg, 1.2)]);
    expect(v.holders.has(1)).toBe(true);
    expect(v.holders.has(2)).toBe(true);
  });

  it('grants nearest-first among equally legal claimants', () => {
    // Both clear of each other; 2 is nearer, so it is granted first, but both
    // fit inside the cap here — assert the ORDER by starving the cap.
    const v = arbitrate(P, [at(1, 0, 5), at(2, 10, 1), at(3, 180, 4)]);
    // 2 (nearest) takes one; 1 is only 10 deg from it and is refused;
    // 3 is 180 deg away and takes the second.
    expect([...v.holders].sort()).toEqual([2, 3]);
  });

  it('a committed claimant keeps its token even when a nearer body wants one', () => {
    const v = arbitrate(P, [at(1, 0, 3, { committed: true }), at(2, 5, 1)]);
    expect(v.holders.has(1)).toBe(true);
    expect(v.holders.has(2)).toBe(false);
  });

  it('an incumbent beats an equally placed newcomer', () => {
    const v = arbitrate(P, [at(1, 0, 1, { incumbent: true }), at(2, 10, 1)]);
    expect(v.holders.has(1)).toBe(true);
    expect(v.holders.has(2)).toBe(false);
  });

  it('is deterministic: identical input, identical verdict', () => {
    const set = () => [at(1, 0, 1), at(2, 1, 1), at(3, 181, 1)];
    const a = arbitrate(P, set());
    const b = arbitrate(P, set());
    expect([...a.holders].sort()).toEqual([...b.holders].sort());
    expect([...a.drift.entries()].sort()).toEqual([...b.drift.entries()].sort());
  });

  it('drift is 0 for a holder and for a waiter already in a clear bearing', () => {
    // 1 and 3 hold (0 and 180); 2 sits at 90, clear of both.
    const v = arbitrate(P, [at(1, 0, 1), at(3, 180, 1), at(2, 90, 2)]);
    expect(v.drift.get(1)).toBe(0);
    expect(v.drift.get(3)).toBe(0);
    expect(v.drift.get(2)).toBe(0);
  });

  it('drift points a crowded waiter toward the nearer clear bearing', () => {
    // 1 holds at 0. 2 sits at 30 — crowded. The nearest clear bearings are
    // -90 and +90; +90 is nearer to 30, so it drifts positive.
    const v = arbitrate(P, [at(1, 0, 1), at(2, 30, 2), at(3, 200, 1)]);
    expect(v.drift.get(2)).toBe(1);
  });

  it('drift is signed the other way when the other side is nearer', () => {
    // True mirror of the test above: holder 3 sits at 160 deg (NOT 200 — a
    // holder at 200 leaves (90,110) the only clear arc, and drift from -30
    // toward it is +120 deg, i.e. POSITIVE; the plan's draft carried the 200
    // filler over unmirrored, which contradicts the spec's per-bearing rule).
    const v = arbitrate(P, [at(1, 0, 1), at(2, -30, 2), at(3, 160, 1)]);
    expect(v.drift.get(2)).toBe(-1);
  });
});
