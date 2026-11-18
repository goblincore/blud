// src/lab/sdf-zombie/webgpu/tesla-stick.test.ts
import { describe, expect, it } from 'vitest';
import { arcSticks, TESLA } from './tesla-stick';

const eye: [number, number, number] = [0, 1.6, 0];
const aimAt = (deg: number): [number, number, number] => {
  const r = deg * Math.PI / 180;
  return [Math.sin(r), 0, -Math.cos(r)];
};

describe('the arc sticks to its target', () => {
  const centre: [number, number, number] = [0, 1.6, -5];
  it('holds while the aim is inside stickDeg of the body centre', () => {
    expect(arcSticks(eye, aimAt(0), centre)).toBe(true);
    expect(arcSticks(eye, aimAt(TESLA.stickDeg - 0.5), centre)).toBe(true);
  });
  it('drops once the aim leaves it', () => {
    expect(arcSticks(eye, aimAt(TESLA.stickDeg + 0.5), centre)).toBe(false);
    expect(arcSticks(eye, aimAt(180), centre)).toBe(false);
  });
  it('drops a target beyond range', () => {
    expect(arcSticks(eye, aimAt(0), [0, 1.6, -(TESLA.rangeM + 1)])).toBe(false);
  });
  it('holds a target the eye is standing in', () => {
    expect(arcSticks(eye, aimAt(90), [0, 1.6, 0])).toBe(true);
  });
});
