import { describe, it, expect } from 'vitest';
import { BURN_BEHAVIOUR, createBurnPanic, stepBurnPanic } from './burn-behaviour';

const run = (kind: 'zombie' | 'soldier', secs: number, seed = 7) => {
  const s = createBurnPanic(seed);
  const outs = [];
  for (let t = 0; t < secs; t += 1 / 30) {
    outs.push(stepBurnPanic(s, { kind, self: [0, 0, 0], player: [5, 0, 0], chaseTarget: [5, 0, 0] }, 1 / 30));
  }
  return outs;
};

describe('stepBurnPanic', () => {
  it('soldier targets a point AWAY from the player and never fires', () => {
    const outs = run('soldier', 4);
    for (const o of outs) {
      expect(o.fire).toBe(false);
      expect(o.target![0]).toBeLessThan(0);           // player is at +x
    }
    expect(outs[0]!.cruiseScale).toBeCloseTo(BURN_BEHAVIOUR.soldierSpeed);
  });
  it('zombie keeps its chase target direction, faster, with jitter', () => {
    const outs = run('zombie', 4);
    expect(outs[0]!.cruiseScale).toBeCloseTo(BURN_BEHAVIOUR.zombieSpeed);
    for (const o of outs) expect(o.target![0]).toBeGreaterThan(0);
    const zs = new Set(outs.map(o => o.target![2].toFixed(3)));
    expect(zs.size).toBeGreaterThan(5);                // heading actually wanders
  });
  it('stumbles at least once per stumbleMaxSec and not more often than stumbleMinSec', () => {
    const outs = run('zombie', 12);
    const idx = outs.flatMap((o, i) => (o.stumble ? [i] : []));
    expect(idx.length).toBeGreaterThanOrEqual(Math.floor(12 / BURN_BEHAVIOUR.stumbleMaxSec));
    for (let i = 1; i < idx.length; i++) {
      expect((idx[i]! - idx[i - 1]!) / 30).toBeGreaterThanOrEqual(BURN_BEHAVIOUR.stumbleMinSec - 1e-6);
    }
  });
  it('is deterministic for a seed', () => {
    expect(run('soldier', 3, 11)).toEqual(run('soldier', 3, 11));
  });
});
