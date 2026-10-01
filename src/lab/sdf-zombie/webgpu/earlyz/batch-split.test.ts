// src/lab/sdf-zombie/webgpu/earlyz/batch-split.test.ts
import { describe, it, expect } from 'vitest';
import { boxContainsPoint, splitInstances, NEAR_GUARD_M } from './batch-split';

const box = (c: [number, number, number], h: [number, number, number], id = 0) => ({ centre: c, half: h, id });

describe('camera-inside test (spec D5)', () => {
  it('counts the guard band as inside', () => {
    const b = box([0, 0, -4], [0.5, 1, 0.5]);
    expect(boxContainsPoint(b, [0, 0, -4], NEAR_GUARD_M)).toBe(true);
    expect(boxContainsPoint(b, [0, 0, -3.26], 0.25)).toBe(true);   // 0.24 m past the +z face
    expect(boxContainsPoint(b, [0, 0, -3.24], 0.25)).toBe(false);  // 0.26 m past it
    expect(boxContainsPoint(b, [0.76, 0, -4], 0.25)).toBe(false);
  });
});

describe('splitInstances', () => {
  it('sends camera-inside boxes to back and keeps the input order in both lists', () => {
    const list = [box([0, 0, -1], [0.5, 1, 0.5], 0), box([2, 0, -4], [0.5, 1, 0.5], 1), box([0.1, 0, -0.9], [0.5, 1, 0.5], 2), box([-3, 0, -6], [0.5, 1, 0.5], 3)];
    const { front, back } = splitInstances(list, [0, 0, -0.8]);
    expect(back.map((b) => b.id)).toEqual([0, 2]);
    expect(front.map((b) => b.id)).toEqual([1, 3]);
  });
  it('an empty list splits into two empty lists', () => {
    expect(splitInstances([], [0, 0, 0])).toEqual({ front: [], back: [] });
  });
});
