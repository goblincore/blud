import { describe, it, expect } from 'vitest';
import { burnDistortStrength, burnDistortRadiusM, burnWobble } from './burn-distort';

describe('burn distortion', () => {
  it('scales with burn and dies with char', () => {
    expect(burnDistortStrength(0, 0, 0.006)).toBe(0);
    expect(burnDistortStrength(1, 0, 0.006)).toBeCloseTo(0.006, 6);
    expect(burnDistortStrength(1, 1, 0.006)).toBeLessThan(burnDistortStrength(1, 0, 0.006));
  });

  it('covers the body and a little of the air above it', () => {
    expect(burnDistortRadiusM(1.8)).toBeGreaterThan(0.9);
    expect(burnDistortRadiusM(1.8)).toBeLessThan(2.5);
  });

  it('wobbles bounded, rises over time, and is stable per body', () => {
    for (let t = 0; t < 5; t += 0.01) {
      const w = burnWobble(t, 0.3);
      expect(w).toBeGreaterThanOrEqual(-1);
      expect(w).toBeLessThanOrEqual(1);
    }
    expect(burnWobble(1, 0.3)).not.toBeCloseTo(burnWobble(1, 2.9), 3);
    expect(burnWobble(1, 0.3)).toBe(burnWobble(1, 0.3));
  });
});
