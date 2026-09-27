import { describe, expect, it } from 'vitest';
import { BEACON, beaconAxis } from './beacon';

describe('beaconAxis', () => {
  it('is a unit vector tilted BEACON.tilt below horizontal', () => {
    const a = beaconAxis(1.3, 0.7, 0);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 6);
    expect(Math.asin(-a[1])).toBeCloseTo(BEACON.tilt, 6);
  });
  it('turns spin revolutions per second, sign = direction', () => {
    const a0 = beaconAxis(0, 0.5, 0), a1 = beaconAxis(1, 0.5, 0);   // half a turn
    expect(a1[0]).toBeCloseTo(-a0[0], 6); expect(a1[2]).toBeCloseTo(-a0[2], 6);
    const cw = beaconAxis(0.25, 1, 0), ccw = beaconAxis(0.25, -1, 0);
    expect(cw[2]).toBeCloseTo(-ccw[2], 6);   // a quarter turn each way: z flips
  });
  it('phase offsets the sweep', () => {
    const a = beaconAxis(0, 1, Math.PI / 2), b = beaconAxis(0.25, 1, 0);
    expect(a[0]).toBeCloseTo(b[0], 6); expect(a[2]).toBeCloseTo(b[2], 6);
  });
});
