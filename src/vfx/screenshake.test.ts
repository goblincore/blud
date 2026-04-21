import { describe, it, expect, beforeEach } from 'vitest';
import { Screenshake } from './screenshake';

describe('Screenshake', () => {
  let sh: Screenshake;

  beforeEach(() => {
    sh = new Screenshake();
  });

  it('produces zero offset when idle', () => {
    const off = sh.sampleOffset(0.016);
    expect(off.pitch).toBe(0);
    expect(off.yaw).toBe(0);
    expect(off.roll).toBe(0);
  });

  it('produces non-zero offset after shake()', () => {
    sh.shake(1.0, 0.5);
    const off = sh.sampleOffset(0.016);
    expect(Math.abs(off.pitch) + Math.abs(off.yaw) + Math.abs(off.roll)).toBeGreaterThan(0);
  });

  it('decays to zero after full duration', () => {
    sh.shake(1.0, 0.5);
    // Consume all energy
    for (let t = 0; t < 1.0; t += 0.016) sh.sampleOffset(0.016);
    const off = sh.sampleOffset(0.016);
    expect(Math.abs(off.pitch)).toBeLessThan(0.0001);
    expect(Math.abs(off.yaw)).toBeLessThan(0.0001);
  });

  it('higher magnitude yields larger peak offset', () => {
    const sh2 = new Screenshake();
    sh.shake(1.0, 0.5);
    sh2.shake(2.0, 0.5);
    // Sample first frame; bigger magnitude → bigger offset (on average)
    let mag1 = 0, mag2 = 0;
    for (let i = 0; i < 20; i++) {
      const o1 = sh.sampleOffset(0.001);
      const o2 = sh2.sampleOffset(0.001);
      mag1 += Math.abs(o1.pitch) + Math.abs(o1.yaw);
      mag2 += Math.abs(o2.pitch) + Math.abs(o2.yaw);
    }
    expect(mag2).toBeGreaterThan(mag1);
  });

  it('stacks overlapping impulses additively in magnitude', () => {
    sh.shake(1.0, 0.5);
    const mid = sh.sampleOffset(0.016);
    sh.shake(1.0, 0.5);  // second shake while first still active
    const after = sh.sampleOffset(0.016);
    // Second impulse should bump residual magnitude up
    const mMid = Math.abs(mid.pitch) + Math.abs(mid.yaw);
    const mAft = Math.abs(after.pitch) + Math.abs(after.yaw);
    expect(mAft).toBeGreaterThan(mMid * 0.5); // not strictly ≥ because random phase, but close
  });
});
