// src/lab/sdf-zombie/webgpu/game-meat-gib-sizes.test.ts
//
// The meat pre-warm builds the scaled copies a body can throw (game-meat-gib.ts meatSizesFor): every bucket a throw can
// land in must be among them, or that bucket is cloned in the frame of the hit again.
import { describe, expect, it } from 'vitest';
import { meatSize, meatSizesFor } from './game-meat-gib';
import { FLESH_BITS } from '../flesh-bits';
import type { GoreTuning } from '../gore-tuning';

describe('meatSizesFor', () => {
  it('holds every bucket a throw can land in', () => {
    const gore = { chunks: { pellet: { count: [0.35, 2] as const, scale: 1.3 }, slug: { count: [6, 9] as const, scale: 2.2 } } } as unknown as GoreTuning;
    const sizes = new Set(meatSizesFor(gore).map(s => s.toFixed(3)));
    for (const c of Object.values(gore.chunks!)) {
      if (!c) continue;
      for (let k = 0; k <= 200; k++) {
        const r = (FLESH_BITS.size[0] + (FLESH_BITS.size[1] - FLESH_BITS.size[0]) * k / 200) * c.scale;
        expect(sizes.has(meatSize(r).toFixed(3))).toBe(true);
      }
    }
  });
  it('is empty for a body that throws none', () => {
    expect(meatSizesFor(null)).toEqual([]);
    expect(meatSizesFor({} as GoreTuning)).toEqual([]);
  });
});
