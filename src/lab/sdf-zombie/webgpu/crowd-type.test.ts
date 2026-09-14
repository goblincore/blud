// src/lab/sdf-zombie/webgpu/crowd-type.test.ts
//
// Pure-CPU pins for the crowd type's slot allocator and instance-attribute
// packing. The material/atlas/record wiring is exercised by the game page
// (`?crowd=1`) and its march-hash parity gate — these are the parts that can
// be pinned without a GPU.
import { describe, it, expect } from 'vitest';
import { allocateSlot, packInstanceAttrs, highWater, budgetFit, INST_FLOATS } from './crowd-type';
import source from './crowd-type?raw';

describe('crowd type slots', () => {
  it('hands out the lowest free slot and recycles', () => {
    const free = new Set([0, 1, 2, 3]);
    expect(allocateSlot(free)).toBe(0);
    expect(allocateSlot(free)).toBe(1);
    free.add(0);
    expect(allocateSlot(free)).toBe(0);
    free.clear();
    expect(allocateSlot(free)).toBe(-1);
  });
  it('packs centre, half and slot per instance', () => {
    const out = new Float32Array(2 * INST_FLOATS);
    const n = packInstanceAttrs([
      { slot: 3, centre: [1, 2, 3], half: [0.5, 1, 0.5], visible: true },
      { slot: 5, centre: [0, 0, 0], half: [1, 1, 1], visible: false },
    ], out);
    expect(n).toBe(1);
    expect(Array.from(out.subarray(0, INST_FLOATS))).toEqual([1, 2, 3, 0.5, 1, 0.5, 3]);
  });
});

describe('crowd type loop bound (perf 7d)', () => {
  it('high-water marks the drawn slots, not the capacity', () => {
    expect(highWater([])).toBe(0);
    expect(highWater([0])).toBe(1);
    expect(highWater([0, 1, 2])).toBe(3);
    // A mid-range detach leaves a gap: the bound is still max + 1 (the free
    // slots below it carry alive = 0 and the per-step gate skips them).
    expect(highWater([0, 2])).toBe(3);
    expect(highWater([0, 1])).toBe(2);
  });

  it('caps the group list nearest-first, culling the far tail', () => {
    expect(budgetFit([], 10)).toEqual({ kept: 0, culled: 0 });
    expect(budgetFit([5, 5], 10)).toEqual({ kept: 2, culled: 0 });
    expect(budgetFit([10, 10, 10], 25)).toEqual({ kept: 2, culled: 1 });
    // A hard stop: the instance that would overflow ends the list, so the
    // smaller INSTANCE 2 is culled too rather than back-filled.
    expect(budgetFit([10, 20, 5], 25)).toEqual({ kept: 1, culled: 2 });
  });

  it('never zeroes the tile gate on overflow', () => {
    // The unbounded fallback (tileCfg.x = 0 + full cluster walk per slot) is
    // what hung the GPU on 2026-09-14; overflow now caps the group list or
    // zeroes instCfg.x for one frame (every pixel discards).
    expect(source).not.toContain('tileCfg.value.x = 0');
    expect(source).toContain('instCfg.value.set(0, 1, 0, 0)');
  });
});
