// src/lab/sdf-zombie/vec.test.ts
import { describe, it, expect } from 'vitest';
import { add, sub, scale, dot, cross, len, normalize, lerp, basisFromAxis } from './vec';
import {
  qIdentity, qFromAxisAngle, qMul, qNormalize, qRotate, type Quat,
} from './vec';

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

describe('quaternions', () => {
  it('identity rotates nothing', () => {
    expect(qRotate(qIdentity(), [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('rotates 90 degrees about y', () => {
    const q = qFromAxisAngle([0, 1, 0], Math.PI / 2);
    const v = qRotate(q, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 6);
    expect(v[1]).toBeCloseTo(0, 6);
    expect(v[2]).toBeCloseTo(-1, 6);
  });

  it('composes: qMul(a, b) applies b then a', () => {
    const a = qFromAxisAngle([0, 1, 0], Math.PI / 2);
    const b = qFromAxisAngle([1, 0, 0], Math.PI / 2);
    const v = qRotate(qMul(a, b), [0, 1, 0]);
    const expected = qRotate(a, qRotate(b, [0, 1, 0]));
    expect(v[0]).toBeCloseTo(expected[0], 6);
    expect(v[1]).toBeCloseTo(expected[1], 6);
    expect(v[2]).toBeCloseTo(expected[2], 6);
  });

  it('normalize returns a unit quaternion', () => {
    const q = qNormalize([1, 2, 3, 4]);
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    expect(n).toBeCloseTo(1, 6);
  });

  it('rotation preserves length', () => {
    const q = qFromAxisAngle([0.3, 0.8, -0.5], 1.234);
    const v = qRotate(q, [2, -1, 0.5]);
    expect(Math.hypot(...v)).toBeCloseTo(Math.hypot(2, -1, 0.5), 6);
  });
});
