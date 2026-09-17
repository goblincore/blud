import { describe, it, expect } from 'vitest';
import { burnLightFlicker, burnLightIntensity, burnLightAnchor } from './burn-light';

describe('burn light', () => {
  it('flickers around 1 with bounded depth', () => {
    // Two rates, as the room practicals do, so it never reads as a sine.
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 10; t += 0.01) {
      const f = burnLightFlicker(t, 0.4, 0.5);
      lo = Math.min(lo, f); hi = Math.max(hi, f);
    }
    expect(lo).toBeGreaterThan(1 - 0.5);
    expect(hi).toBeLessThan(1 + 0.5);
    expect(hi - lo).toBeGreaterThan(0.2);
  });

  it('gives no light when a body is not burning and scales with burn', () => {
    expect(burnLightIntensity(0, 0, 26, 0.3, 1)).toBe(0);
    const half = burnLightIntensity(0.5, 0, 26, 0, 1);
    const full = burnLightIntensity(1, 0, 26, 0, 1);
    expect(half).toBeCloseTo(full * 0.5, 6);
    expect(full).toBeCloseTo(26, 6);
  });

  it('dims as a body chars over', () => {
    expect(burnLightIntensity(1, 1, 26, 0, 1)).toBeLessThan(burnLightIntensity(1, 0, 26, 0, 1));
  });

  it('anchors the light at chest height above the body', () => {
    expect(burnLightAnchor([2, 0, -3])).toEqual([2, 1, -3]);
  });
});
