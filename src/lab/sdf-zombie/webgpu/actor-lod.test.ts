// src/lab/sdf-zombie/webgpu/actor-lod.test.ts
import { describe, expect, it } from 'vitest';
import { ACTOR_LOD, countTiers, lodStepDt, lodTier, type LodFacts } from './actor-lod';

const unseenIdle: LodFacts = { inView: false, sectorVisible: false, distM: 30, mode: 'idle', orderVisible: false, alert: false, restless: false };

describe('lodTier', () => {
  it('sleeps an idle body out of sight and away from the player', () => {
    expect(lodTier(unseenIdle)).toBe('sleep');
  });
  it('anything the player could see, or that is near, restless or seen by the director, is full', () => {
    expect(lodTier({ ...unseenIdle, inView: true })).toBe('full');
    expect(lodTier({ ...unseenIdle, sectorVisible: true })).toBe('full');
    expect(lodTier({ ...unseenIdle, distM: ACTOR_LOD.nearM - 0.1 })).toBe('full');
    expect(lodTier({ ...unseenIdle, restless: true })).toBe('full');
    expect(lodTier({ ...unseenIdle, orderVisible: true })).toBe('full');
  });
  it('an alert body stays full near and in combat, and drops to the quarter rate only far and unseen', () => {
    expect(lodTier({ ...unseenIdle, mode: 'pursue', alert: true })).toBe('quarter');
    expect(lodTier({ ...unseenIdle, mode: 'pursue', alert: true, distM: ACTOR_LOD.farM - 1 })).toBe('full');
    expect(lodTier({ ...unseenIdle, mode: 'combat', alert: true })).toBe('full');
    expect(lodTier({ ...unseenIdle, mode: 'yield' })).toBe('full');
    // Idle by order but alert in its own mind (it heard something): not asleep.
    expect(lodTier({ ...unseenIdle, alert: true })).toBe('quarter');
  });
});

describe('lodStepDt', () => {
  it('full steps every frame with what it is owed', () => {
    const c = { owed: 0 };
    expect(lodStepDt('full', c, 1 / 30, 3, 0)).toBeCloseTo(1 / 30);
    expect(c.owed).toBe(0);
  });
  it('quarter steps one frame in four, staggered by id, and keeps the time (no time lost)', () => {
    const c = { owed: 0 };
    let total = 0, steps = 0;
    for (let f = 0; f < 12; f++) { const d = lodStepDt('quarter', c, 0.03, 1, f); if (d > 0) { steps++; total += d; } }
    expect(steps).toBe(3);
    expect(total + c.owed).toBeCloseTo(12 * 0.03, 9);
    // A body coming back to full is stepped with what it is owed plus this frame.
    const owed = c.owed;
    expect(lodStepDt('full', c, 0.03, 1, 12)).toBeCloseTo(owed + 0.03, 9);
  });
  it('two ids are stepped on different frames', () => {
    const due = (id: number) => [0, 1, 2, 3].filter(f => lodStepDt('quarter', { owed: 0 }, 0.03, id, f) > 0);
    expect(due(0)).toEqual([0]);
    expect(due(1)).toEqual([3]);
  });
  it('sleep drops its time', () => {
    const c = { owed: 0.1 };
    expect(lodStepDt('sleep', c, 0.03, 0, 0)).toBe(0);
    expect(c.owed).toBe(0);
  });
  it('counts tiers', () => {
    expect(countTiers(['full', 'sleep', 'sleep'])).toEqual({ full: 1, quarter: 0, sleep: 2 });
  });
});
