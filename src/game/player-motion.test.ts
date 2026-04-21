import { describe, it, expect } from 'vitest';
import { movementDirection } from './player-motion';

const EPS = 1e-6;
function near(a: number, b: number) {
  expect(Math.abs(a - b)).toBeLessThan(EPS);
}

describe('movementDirection', () => {
  it('returns zero vector for no input', () => {
    const v = movementDirection({ forward: false, back: false, left: false, right: false }, 0);
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('maps forward at yaw=0 to -Z', () => {
    const v = movementDirection({ forward: true, back: false, left: false, right: false }, 0);
    near(v.x, 0); near(v.y, 0); near(v.z, -1);
  });

  it('maps back at yaw=0 to +Z', () => {
    const v = movementDirection({ forward: false, back: true, left: false, right: false }, 0);
    near(v.x, 0); near(v.z, 1);
  });

  it('maps left at yaw=0 to -X', () => {
    const v = movementDirection({ forward: false, back: false, left: true, right: false }, 0);
    near(v.x, -1); near(v.z, 0);
  });

  it('maps right at yaw=0 to +X', () => {
    const v = movementDirection({ forward: false, back: false, left: false, right: true }, 0);
    near(v.x, 1); near(v.z, 0);
  });

  it('normalizes forward+right to unit length', () => {
    const v = movementDirection({ forward: true, back: false, left: false, right: true }, 0);
    const len = Math.hypot(v.x, v.z);
    near(len, 1);
  });

  it('cancels opposing inputs', () => {
    const v = movementDirection({ forward: true, back: true, left: true, right: true }, 0);
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rotates by yaw: forward at yaw=π/2 points to -X', () => {
    const v = movementDirection({ forward: true, back: false, left: false, right: false }, Math.PI / 2);
    near(v.x, -1); near(v.z, 0);
  });
});
