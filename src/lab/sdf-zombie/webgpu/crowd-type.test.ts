// src/lab/sdf-zombie/webgpu/crowd-type.test.ts
//
// Pure-CPU pins for the crowd type's slot allocator and instance-attribute
// packing. The material/atlas/record wiring is exercised by the game page
// (`?crowd=1`) and its march-hash parity gate — these are the parts that can
// be pinned without a GPU.
import { describe, it, expect } from 'vitest';
import { allocateSlot, packInstanceAttrs, INST_FLOATS } from './crowd-type';

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
