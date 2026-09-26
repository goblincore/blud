// src/lab/sdf-zombie/webgpu/train-window.test.ts

import { describe, expect, it } from 'vitest';
import { WINDOW_PRESETS, crossAt, onStrip, silhouette } from './train-window';

describe('train window scenery (twin)', () => {
  it('a ray out of the window reaches a side plane at the right z', () => {
    const c = crossAt([0, 1.6, 0], [1, 0, -1], 6)!;
    expect(c.z).toBeCloseTo(-6); expect(c.y).toBeCloseTo(1.6);
    expect(crossAt([0, 1.6, 0], [0, 0, -1], 6)).toBeNull();
  });
  it('strips repeat at their pitch and scroll one pitch in pitch/speed seconds', () => {
    const { polePitch: p, speed: v } = WINDOW_PRESETS.night;
    expect(onStrip(0, 0, v, p, 0.25)).toBe(true);
    expect(onStrip(p, 0, v, p, 0.25)).toBe(true);
    expect(onStrip(p / 2, 0, v, p, 0.25)).toBe(false);
    for (const z of [-3, 0.1, 7.7]) expect(onStrip(z, p / v, v, p, 0.25)).toBe(onStrip(z, 0, v, p, 0.25));
  });
  it('silhouettes stay between 10 % and 100 % of their height', () => {
    for (let s = 0; s < 1000; s += 1.7) {
      const h = silhouette(s, 9, 0.35);
      expect(h).toBeGreaterThanOrEqual(0.9); expect(h).toBeLessThanOrEqual(9);
    }
  });
  it('layers are ordered near to far', () => {
    const n = WINDOW_PRESETS.night;
    expect(n.postDist).toBeLessThan(n.poleDist); expect(n.poleDist).toBeLessThan(n.treeDist); expect(n.treeDist).toBeLessThan(n.hillDist);
  });
});
