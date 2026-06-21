// src/sim/trig.test.ts
import { describe, it, expect } from 'vitest';
import { BANGLE_FULL, BANGLE_QUARTER, bcos, bsin } from './trig';
import { FP_PER_BU } from './fp';

describe('trig — Blood-angle table (2048 units = 360°), 16.16 output', () => {
  it('angle constants', () => {
    expect(BANGLE_FULL).toBe(2048);
    expect(BANGLE_QUARTER).toBe(512);
  });
  it('bcos(0)=1.0, bsin(0)=0', () => {
    expect(bcos(0)).toBe(FP_PER_BU);   // 65536 == 1.0 in 16.16
    expect(bsin(0)).toBe(0);
  });
  it('bcos(quarter)≈0, bsin(quarter)≈1.0', () => {
    expect(Math.abs(bcos(BANGLE_QUARTER))).toBeLessThan(4); // ~0 within rounding
    expect(Math.abs(bsin(BANGLE_QUARTER) - FP_PER_BU)).toBeLessThan(4);
  });
  it('wraps the angle (negative and >2048)', () => {
    expect(bcos(-BANGLE_FULL)).toBe(bcos(0));
    expect(bsin(BANGLE_FULL + BANGLE_QUARTER)).toBe(bsin(BANGLE_QUARTER));
  });
  it('matches Math.cos/sin within rounding tolerance across the circle', () => {
    for (let a = 0; a < 2048; a += 17) {
      const rad = (a / 2048) * Math.PI * 2;
      expect(bcos(a) / FP_PER_BU).toBeCloseTo(Math.cos(rad), 3);
      expect(bsin(a) / FP_PER_BU).toBeCloseTo(Math.sin(rad), 3);
    }
  });
});
