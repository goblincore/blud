// src/sim/fp.test.ts
import { describe, it, expect } from 'vitest';
import {
  FP_PER_BU, FP_PER_METER,
  fpFromBU, fpToBU, fpFromMeters, fpToMeters, metersPerSecToFp, mulfp,
} from './fp';

describe('fp — 16.16 fixed-point Build units', () => {
  it('scale constants', () => {
    expect(FP_PER_BU).toBe(65536);
    expect(FP_PER_METER).toBe(256 * 65536); // 16,777,216
  });
  it('BU <-> fp', () => {
    expect(fpFromBU(1)).toBe(65536);
    expect(fpToBU(65536)).toBe(1);
    expect(fpToBU(98304)).toBe(1); // 1.5 BU floors to 1 BU
  });
  it('meters <-> fp', () => {
    expect(fpFromMeters(1)).toBe(16_777_216);
    expect(fpToMeters(16_777_216)).toBeCloseTo(1, 9);
    expect(fpToMeters(fpFromMeters(2.5))).toBeCloseTo(2.5, 6);
  });
  it('metersPerSecToFp: 6 m/s ≈ 12.8 BU/tic', () => {
    // 6 m/s * 16,777,216 fp/m / 120 tic = 838860.8 → 838861 fp/tic
    expect(metersPerSecToFp(6)).toBe(838861);
  });
  it('mulfp(a,b) = floor(a*b / 65536) (16.16 multiply, floor not >>)', () => {
    expect(mulfp(fpFromBU(2), fpFromBU(3))).toBe(fpFromBU(6)); // 2*3 = 6 BU
    expect(mulfp(65536, -1)).toBe(-1);                          // floor(-1/1)
    expect(mulfp(-3, 32768)).toBe(-2);                          // floor(-3*0.5)= -1.5 → -2
  });
});
