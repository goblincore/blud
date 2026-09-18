import { describe, it, expect } from 'vitest';
import { FIRE_VOLUME_MAX_BODIES, FIRE_CAPSULE_STRIDE, packFireVolume, fireLagOffset } from './fire-volume-pack';

const cap = (x: number) => ({ a: [x, 0, 0], b: [x, 1, 0], radius: 0.1, limb: 'torso', crown: false, source: 'add' }) as const;
const body = (x: number, burn = 1) => ({ capsules: [cap(x)], velocities: [[1, 0, 0]], burn, centre: [x, 1, 0] }) as any;

describe('packFireVolume', () => {
  it('ranks bodies nearest the camera first and caps at FIRE_VOLUME_MAX_BODIES', () => {
    const bodies = Array.from({ length: 12 }, (_, i) => body(12 - i));
    const p = packFireVolume(bodies, [0, 1, 0]);
    expect(p.bodyCount).toBe(FIRE_VOLUME_MAX_BODIES);
    expect(p.capsuleCount).toBe(FIRE_VOLUME_MAX_BODIES);
    expect(p.data[0]).toBeCloseTo(1);                       // nearest body's capsule a.x first
  });
  it('writes a, radius, b, burn, velocity per capsule at FIRE_CAPSULE_STRIDE', () => {
    const p = packFireVolume([body(2, 0.5)], [0, 1, 0]);
    // Float32 rounds 0.1, so compare at the buffer's own precision.
    const got = Array.from(p.data.slice(0, FIRE_CAPSULE_STRIDE)).map(v => +v.toFixed(5));
    expect(got).toEqual([2, 0, 0, 0.1, 2, 1, 0, 0.5, 1, 0, 0, 0]);
  });
  it('drops bodies with burn 0 and returns an AABB around the rest', () => {
    const p = packFireVolume([body(2, 0), body(3, 1)], [0, 1, 0]);
    expect(p.bodyCount).toBe(1);
    expect(p.boundsMin[0]).toBeLessThanOrEqual(3 - 0.1);
    expect(p.boundsMax[1]).toBeGreaterThan(1);              // padded upward for the rise
  });
  it('reuses a supplied buffer without allocating a new one', () => {
    const out = new Float32Array(4096);
    const p = packFireVolume([body(2, 1)], [0, 1, 0], out);
    expect(p.data).toBe(out);
  });
});

describe('fireLagOffset', () => {
  it('trails opposite the velocity, grows with height, clamps', () => {
    expect(fireLagOffset([2, 0, 0], 0, 0.3, 0.6).map(Math.abs)).toEqual([0, 0, 0]);
    const o = fireLagOffset([2, 0, 0], 0.5, 0.3, 0.6);
    expect(o[0]).toBeCloseTo(-0.3);
    expect(fireLagOffset([100, 0, 0], 1, 0.3, 0.6)[0]).toBeCloseTo(-0.6);
  });
});
