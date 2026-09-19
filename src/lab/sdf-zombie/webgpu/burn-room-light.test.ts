// What this protects: the SLOT POLICY, which is the whole point of the module.
// The room's gather has 8 slots shared with flashes, explosions and tracers, so
// fire gets a small fixed cap; the tests pin that a surplus burner is MERGED
// into the nearest kept slot (intensity summed at the intensity-weighted
// position) rather than dropped — the room must not go dark when a third body
// catches. The mesh pool is the simpler sibling: nearest-first, zero-filled.
import { describe, it, expect } from 'vitest';
import { fireGatherLights, assignFirePool, type FireLightSource } from './burn-room-light';

const src = (x: number, intensity: number): FireLightSource => ({ pos: [x, 1, 0], intensity });

describe('fireGatherLights', () => {
  it('returns nothing for no burners or zero cap', () => {
    expect(fireGatherLights([], [0, 1, 0], 2)).toEqual([]);
    expect(fireGatherLights([src(1, 5)], [0, 1, 0], 0)).toEqual([]);
  });
  it('keeps one slot per burner while under the cap, nearest first', () => {
    const out = fireGatherLights([src(5, 1), src(1, 1)], [0, 1, 0], 2);
    expect(out.map(l => l.pos[0])).toEqual([1, 5]);
  });
  it('merges surplus burners into the nearest kept slot, conserving intensity', () => {
    const out = fireGatherLights([src(1, 2), src(2, 2), src(9, 4)], [0, 1, 0], 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.intensity).toBeCloseTo(8);
    // intensity-weighted position: (1*2 + 2*2 + 9*4) / 8
    expect(out[0]!.pos[0]).toBeCloseTo(5.25);
  });
  it('skips burners with zero intensity', () => {
    expect(fireGatherLights([src(1, 0)], [0, 1, 0], 2)).toEqual([]);
  });
});

describe('assignFirePool', () => {
  it('fills slots nearest-first and zeroes the rest', () => {
    const out = assignFirePool([src(4, 3), src(1, 2)], [0, 1, 0], 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ pos: [1, 1, 0], intensity: 2 });
    expect(out[1]).toEqual({ pos: [4, 1, 0], intensity: 3 });
    expect(out[2]!.intensity).toBe(0);
  });
});
