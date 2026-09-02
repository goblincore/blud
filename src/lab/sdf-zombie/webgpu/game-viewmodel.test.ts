// src/lab/sdf-zombie/webgpu/game-viewmodel.test.ts
import { describe, expect, it } from 'vitest';
import {
  RELOAD, flashEnvelope, hingeOpenFraction, magazineAfterFire, reloadPhaseAt,
} from './game-viewmodel';

describe('flashEnvelope', () => {
  it('is zero before the shot and after the window', () => {
    expect(flashEnvelope(-0.01)).toBe(0);
    expect(flashEnvelope(0.071)).toBe(0);
  });
  it('peaks at 1 immediately at the shot', () => {
    expect(flashEnvelope(0)).toBeCloseTo(1, 5);
  });
  it('decays monotonically across the window', () => {
    let prev = Infinity;
    for (let t = 0; t <= 0.07; t += 0.005) {
      const v = flashEnvelope(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});

describe('magazineAfterFire', () => {
  it('spends one shell per barrel fired', () => {
    expect(magazineAfterFire(2, 1)).toBe(1);
    expect(magazineAfterFire(2, 2)).toBe(0);
  });
  it('never goes negative when both barrels are pulled on one shell', () => {
    expect(magazineAfterFire(1, 2)).toBe(0);
  });
  it('refuses to fire an empty gun', () => {
    expect(magazineAfterFire(0, 1)).toBe(0);
  });
});

describe('reloadPhaseAt', () => {
  it('walks the six beats in order', () => {
    expect(reloadPhaseAt(0.00)).toBe('present');
    expect(reloadPhaseAt(0.25)).toBe('break');
    expect(reloadPhaseAt(0.40)).toBe('eject');
    expect(reloadPhaseAt(0.55)).toBe('load');
    expect(reloadPhaseAt(0.75)).toBe('snap');
    expect(reloadPhaseAt(0.90)).toBe('settle');
  });
  it('is done past the total', () => {
    expect(reloadPhaseAt(RELOAD.totalSec + 0.01)).toBe('done');
  });
});

describe('hingeOpenFraction', () => {
  it('is shut at rest and shut again when the reload ends', () => {
    expect(hingeOpenFraction(0)).toBeCloseTo(0, 6);
    expect(hingeOpenFraction(RELOAD.totalSec)).toBeCloseTo(0, 6);
  });
  it('is fully open across eject and load', () => {
    expect(hingeOpenFraction(0.40)).toBeCloseTo(1, 6);
    expect(hingeOpenFraction(0.55)).toBeCloseTo(1, 6);
  });
  it('opens monotonically through the break beat', () => {
    let prev = -Infinity;
    for (let t = RELOAD.presentSec; t <= RELOAD.breakEndSec; t += 0.01) {
      const v = hingeOpenFraction(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it('never leaves the unit range', () => {
    for (let t = -0.1; t < RELOAD.totalSec + 0.1; t += 0.005) {
      const v = hingeOpenFraction(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
