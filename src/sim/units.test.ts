// src/sim/units.test.ts
import { describe, it, expect } from 'vitest';
import {
  BU_PER_METER, TICS_PER_SEC, BLOOD_ANGLE_UNITS,
  mulscale, dmulscale,
  buToMeters, metersToBu, ticsToSeconds, bloodAngleToRadians,
} from './units';

describe('sim units — constants', () => {
  it('anchors match Blood-native scale', () => {
    expect(BU_PER_METER).toBe(256);
    expect(TICS_PER_SEC).toBe(120);
    expect(BLOOD_ANGLE_UNITS).toBe(2048);
  });
});

describe('mulscale / dmulscale (fixed-point)', () => {
  it('mulscale(a,b,16) = floor(a*b / 2^16)', () => {
    expect(mulscale(0x10000, 5, 16)).toBe(5);          // 1.0 * 5
    expect(mulscale(0x8000, 10, 16)).toBe(5);          // 0.5 * 10
    expect(mulscale(3, 3, 16)).toBe(0);                // tiny → 0
  });
  it('rounds toward -inf for negatives (matches arithmetic >>)', () => {
    expect(mulscale(-1, 1, 1)).toBe(-1);               // floor(-1/2) = -1
    expect(mulscale(-3, 1, 1)).toBe(-2);               // floor(-3/2) = -2
  });
  it('dmulscale(a,b,c,d,n) = floor((a*b + c*d) / 2^n)', () => {
    expect(dmulscale(0x10000, 3, 0x10000, 4, 16)).toBe(7);
  });
});

describe('render-boundary conversions', () => {
  it('BU <-> meters', () => {
    expect(buToMeters(256)).toBeCloseTo(1, 9);
    expect(metersToBu(1)).toBe(256);
    expect(metersToBu(1.5)).toBe(384);
  });
  it('tics -> seconds', () => {
    expect(ticsToSeconds(120)).toBeCloseTo(1, 9);
  });
  it('blood angle -> radians', () => {
    expect(bloodAngleToRadians(1024)).toBeCloseTo(Math.PI, 9);
    expect(bloodAngleToRadians(2048)).toBeCloseTo(Math.PI * 2, 9);
  });
});
