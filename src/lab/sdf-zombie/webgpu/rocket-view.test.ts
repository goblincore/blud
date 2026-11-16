import { describe, it, expect } from 'vitest';
import { flameAlpha } from './rocket-view';

describe('the rocket exhaust card', () => {
  it('fades to nothing at every edge (no seam however it is stretched)', () => {
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      expect(flameAlpha(0, t)).toBeLessThan(0.01);        // the tail end
      expect(flameAlpha(1, t)).toBeLessThan(0.01);        // the nozzle end
      expect(flameAlpha(t, 0)).toBeLessThan(0.05);        // the long edges
      expect(flameAlpha(t, 1)).toBeLessThan(0.05);
    }
  });
  it('burns brightest just behind the nozzle, on the axis', () => {
    expect(flameAlpha(0.85, 0.5)).toBeGreaterThan(0.9);
    expect(flameAlpha(0.85, 0.5)).toBeGreaterThan(flameAlpha(0.4, 0.5));
    expect(flameAlpha(0.85, 0.5)).toBeGreaterThan(flameAlpha(0.85, 0.8));
  });
});
