import { describe, it, expect } from 'vitest';
import { MUZZLE_SMOKE, puffEnvelope } from './muzzle-smoke';

describe('muzzle smoke puffs', () => {
  it('swell from size0 to size1, fade in fast and out to nothing', () => {
    expect(puffEnvelope(0).size).toBeCloseTo(MUZZLE_SMOKE.size0);
    expect(puffEnvelope(1).size).toBeCloseTo(MUZZLE_SMOKE.size1);
    expect(puffEnvelope(0).opacity).toBe(0);
    expect(puffEnvelope(0.1).opacity).toBeGreaterThan(MUZZLE_SMOKE.opacity * 0.7);
    expect(puffEnvelope(1).opacity).toBe(0);
    for (let u = 0.1; u < 1; u += 0.1) expect(puffEnvelope(u + 0.1).opacity).toBeLessThanOrEqual(puffEnvelope(u).opacity + 1e-9);
  });
});
