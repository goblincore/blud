// src/lab/sdf-zombie/webgpu/hazard-floor.test.ts
import { describe, expect, it } from 'vitest';
import { newHazard, stepHazard } from './hazard-floor';

describe('stepHazard', () => {
  it('deals whole points once a second while on a hurt floor', () => {
    const h = newHazard();
    let total = 0;
    for (let i = 0; i < 180; i++) total += stepHazard(h, 10, 1 / 60);        // 3 s at 60 Hz
    expect(total).toBe(30);
  });
  it('the first hit lands after half a second, not instantly', () => {
    const h = newHazard();
    let first = -1;
    for (let i = 0; i < 60 && first < 0; i++) if (stepHazard(h, 5, 1 / 60) > 0) first = i;
    expect(first).toBeGreaterThanOrEqual(28);
    expect(first).toBeLessThanOrEqual(31);
  });
  it('stepping off resets it; a safe floor never hurts', () => {
    const h = newHazard();
    for (let i = 0; i < 25; i++) stepHazard(h, 10, 1 / 60);
    expect(stepHazard(h, 0, 1 / 60)).toBe(0);
    let total = 0;
    for (let i = 0; i < 25; i++) total += stepHazard(h, 10, 1 / 60);
    expect(total).toBe(0);                                                   // 25 frames < 0.5 s again
  });
  it('rounds fractional rates to whole points', () => {
    const h = newHazard();
    let total = 0;
    for (let i = 0; i < 120; i++) total += stepHazard(h, 2.6, 1 / 60);
    expect(total).toBe(6);                                                   // round(2.6) = 3, twice
  });
  it('ignores non-finite or non-positive dt', () => {
    const h = newHazard();
    const before = h.acc;
    expect(stepHazard(h, 10, NaN)).toBe(0);
    expect(stepHazard(h, 10, Infinity)).toBe(0);
    expect(stepHazard(h, 10, -1)).toBe(0);
    expect(h.acc).toBe(before);
  });
  it('a small positive rate still hurts by at least a point', () => {
    const h = newHazard();
    let total = 0;
    for (let i = 0; i < 126; i++) total += stepHazard(h, 0.4, 1 / 60);       // 2.1 s
    expect(total).toBe(2);
  });
});
