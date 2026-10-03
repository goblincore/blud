// src/lab/sdf-zombie/damage-merge.test.ts
import { describe, expect, it } from 'vitest';
import { MERGE, pushWound, type Wound } from './damage';

const w = (id: number, primIdx: number, local: [number, number, number], radius = 0.05, extra: Partial<Wound> = {}): Wound =>
  ({ eventId: id, primIdx, local, radius, type: 'pellet', ageSec: 0, ...extra });

describe('pushWound merges instead of evicting', () => {
  it('a full ring merges the oldest crater into its nearest same-prim neighbour', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0]), w(2, 0, [0.04, 0, 0]), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring).toHaveLength(3);
    expect(ring.map(x => x.eventId)).not.toContain(1);
    const merged = ring.find(x => x.eventId === 2)!;
    expect(merged.local[0]).toBeCloseTo(0.02, 6);                 // radius-weighted centre of the two
    expect(merged.radius).toBeGreaterThanOrEqual(0.05 + 0.02 - 1e-9); // covers both originals
    expect(merged.radius).toBeLessThanOrEqual(MERGE.maxRadius);
  });
  it('with no same-prim neighbour in reach the oldest is evicted, exactly as before', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0]), w(2, 1, [0, 0, 0]), w(3, 2, [0, 0, 0])];
    ring = pushWound(ring, w(4, 3, [0, 0, 0]), 3);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
  });
  it('neighbours farther than MERGE.reach (times their radii) are not merged', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0]), w(2, 0, [0.5, 0, 0]), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
  });
  it('cuts are never merged and never absorb a crater', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0], 0.1, { shape: 'cut' }), w(2, 0, [0.02, 0, 0]), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
    expect(ring.find(x => x.eventId === 2)!.radius).toBe(0.05);
  });
  it('a merged crater keeps the deeper carve and the larger sever calibre', () => {
    let ring: Wound[] = [
      w(1, 0, [0, 0, 0], 0.05, { carveDepth: 0.02, severRadius: 0.1, carveN: [0, 0, 1] }),
      w(2, 0, [0.03, 0, 0], 0.05, { carveDepth: 0.03, severRadius: 0.05, carveN: [0, 0, 1] }),
      w(3, 1, [0, 0, 0]),
    ];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    const merged = ring.find(x => x.eventId === 2)!;
    expect(merged.carveDepth).toBe(0.03);
    expect(merged.severRadius).toBe(0.1);
  });
  it('an ordinary victim beside a same-prim head keep crater is evicted; the head crater is untouched', () => {
    const head = w(2, 0, [0.03, 0, 0], 0.05, { headSlot: 'keep', headRegion: 'brow', carveDepth: 0.02, severRadius: 0 });
    let ring: Wound[] = [w(1, 0, [0, 0, 0]), head, w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
    const kept = ring.find(x => x.eventId === 2)!;
    expect(kept.local).toEqual([0.03, 0, 0]);
    expect(kept.radius).toBe(0.05);
    expect(kept.severRadius).toBe(0);
    expect(kept.carveDepth).toBe(0.02);
  });
  it('a face head victim with an ordinary neighbour in reach is evicted, not merged', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0], 0.05, { headSlot: 'face' }), w(2, 0, [0.03, 0, 0]), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
    const n = ring.find(x => x.eventId === 2)!;
    expect(n.local).toEqual([0.03, 0, 0]);
    expect(n.radius).toBe(0.05);
  });
  it('a deliberate no-sever (severRadius 0) on either crater keeps the merged wound at 0', () => {
    let ring: Wound[] = [w(1, 0, [0, 0, 0], 0.05, { severRadius: 0 }), w(2, 0, [0.03, 0, 0], 0.05, { severRadius: 0.1 }), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring.find(x => x.eventId === 2)!.severRadius).toBe(0);
    ring = [w(1, 0, [0, 0, 0], 0.05, { severRadius: 0.1 }), w(2, 0, [0.03, 0, 0], 0.05, { severRadius: 0 }), w(3, 1, [0, 0, 0])];
    ring = pushWound(ring, w(4, 2, [0, 0, 0]), 3);
    expect(ring.find(x => x.eventId === 2)!.severRadius).toBe(0);
  });
});
