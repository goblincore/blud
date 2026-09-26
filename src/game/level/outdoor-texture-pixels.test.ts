// src/game/level/outdoor-texture-pixels.test.ts
import { describe, expect, it } from 'vitest';
import { OUTDOOR_TEX_SIZE, edgePixels, groundPixels, skylinePixels } from './outdoor-texture-pixels';

describe('outdoor texture pixels', () => {
  it('are deterministic per seed and differ between seeds', () => {
    expect(groundPixels('grass', 3)).toEqual(groundPixels('grass', 3));
    expect(groundPixels('grass', 3)).not.toEqual(groundPixels('grass', 4));
  });
  it('have the right sizes', () => {
    expect(groundPixels('gravel', 1).length).toBe(OUTDOOR_TEX_SIZE * OUTDOOR_TEX_SIZE * 4);
    expect(skylinePixels('trees', 0.8, 1).length).toBe(2048 * 256 * 4);
  });
  it('the railing has see-through gaps; the hedge is opaque', () => {
    const alpha = (p: Uint8ClampedArray) => { let z = 0; for (let i = 3; i < p.length; i += 4) if (p[i] === 0) z++; return z / (p.length / 4); };
    expect(alpha(edgePixels('railing', 1))).toBeGreaterThan(0.5);
    expect(alpha(edgePixels('leaves', 1))).toBe(0);
  });
  it('a skyline is solid at the bottom and empty at the top', () => {
    const p = skylinePixels('hills', 0.5, 2);
    expect(p[(255 * 2048 + 100) * 4 + 3]).toBe(255);
    expect(p[(0 * 2048 + 100) * 4 + 3]).toBe(0);
  });
});
