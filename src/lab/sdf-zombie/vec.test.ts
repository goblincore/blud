// src/lab/sdf-zombie/vec.test.ts
import { describe, it, expect } from 'vitest';
import { add, sub, scale, dot, cross, len, normalize, lerp, basisFromAxis } from './vec';

describe('vec helpers', () => {
  it('does elementwise arithmetic', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(sub([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it('computes dot, cross and length', () => {
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(len([3, 4, 0])).toBe(5);
  });

  it('normalizes to unit length and leaves the zero vector alone', () => {
    const n = normalize([0, 3, 0]);
    expect(len(n)).toBeCloseTo(1, 10);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('lerps between endpoints', () => {
    expect(lerp([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });

  it('builds an orthonormal basis around any axis', () => {
    for (const axis of [[0, 1, 0], [1, 0, 0], [0.3, -0.9, 0.2]] as const) {
      const { u, v, w } = basisFromAxis(axis);
      expect(len(u)).toBeCloseTo(1, 6);
      expect(len(v)).toBeCloseTo(1, 6);
      expect(len(w)).toBeCloseTo(1, 6);
      expect(dot(u, v)).toBeCloseTo(0, 6);
      expect(dot(u, w)).toBeCloseTo(0, 6);
      expect(dot(v, w)).toBeCloseTo(0, 6);
    }
  });
});
