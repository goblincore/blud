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
  describe('merge geometry', () => {
    const encloses = (m: Wound, c: Wound): boolean =>
      Math.hypot(m.local[0] - c.local[0], m.local[1] - c.local[1], m.local[2] - c.local[2]) + c.radius <= m.radius + 1e-9;
    const mergeTwo = (a: Wound, b: Wound): Wound => {
      const ring = pushWound([a, b, w(3, 1, [0, 0, 0])], w(4, 2, [0, 0, 0]), 3);
      expect(ring.map(x => x.eventId)).toEqual([b.eventId, 3, 4]);
      return ring[0]!;
    };
    it('the merged sphere is the minimal enclosing sphere of unequal craters', () => {
      const a = w(1, 0, [0, 0, 0], 0.05), b = w(2, 0, [0.09, 0, 0], 0.01);
      const m = mergeTwo(a, b);
      expect(encloses(m, a)).toBe(true);
      expect(encloses(m, b)).toBe(true);
      expect(m.radius).toBeCloseTo(0.075, 9);
      expect(m.local[0]).toBeCloseTo(0.025, 9);
    });
    it('a crater already inside the other merges to the larger sphere unchanged', () => {
      const a = w(1, 0, [0, 0, 0], 0.1), b = w(2, 0, [0.05, 0, 0], 0.01);
      const m = mergeTwo(a, b);
      expect(m.local).toEqual([0, 0, 0]);
      expect(m.radius).toBe(0.1);
      const a2 = w(1, 0, [0.05, 0, 0], 0.01), b2 = w(2, 0, [0, 0, 0], 0.1);
      const m2 = mergeTwo(a2, b2);
      expect(m2.local).toEqual([0, 0, 0]);
      expect(m2.radius).toBe(0.1);
    });
    it('zero-radius craters merge without NaN', () => {
      const m = mergeTwo(w(1, 0, [0, 0, 0], 0), w(2, 0, [0, 0, 0], 0));
      expect(m.local).toEqual([0, 0, 0]);
      expect(m.radius).toBe(0);
    });
    it('when the enclosing sphere would pass MERGE.maxRadius the oldest is evicted, the other unchanged', () => {
      const a = w(1, 0, [0, 0, 0], 0.13, { type: 'blast' }), b = w(2, 0, [0.38, 0, 0], 0.13, { type: 'blast' });
      const ring = pushWound([a, b, w(3, 1, [0, 0, 0])], w(4, 2, [0, 0, 0]), 3);
      expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
      expect(ring[0]).toBe(b);
    });
    it('a merge never raises the sever calibre: absent severRadius pins to the larger original radius', () => {
      const m = mergeTwo(w(1, 0, [0, 0, 0], 0.05), w(2, 0, [0.04, 0, 0], 0.03));
      expect(m.radius).toBeGreaterThan(0.05);
      expect(m.severRadius).toBe(0.05);
    });
    it('tear and wetLip survive as the larger of the two', () => {
      const m = mergeTwo(w(1, 0, [0, 0, 0], 0.05, { tear: 0.8 }), w(2, 0, [0.03, 0, 0], 0.05, { wetLip: 0.5, tear: 0.2 }));
      expect(m.tear).toBe(0.8);
      expect(m.wetLip).toBe(0.5);
    });
    it('cloth and non-cloth craters do not merge', () => {
      const ring = pushWound([w(1, 0, [0, 0, 0]), w(2, 0, [0.03, 0, 0], 0.05, { cloth: 'tear' }), w(3, 1, [0, 0, 0])], w(4, 2, [0, 0, 0]), 3);
      expect(ring.map(x => x.eventId)).toEqual([2, 3, 4]);
      expect(ring[0]!.radius).toBe(0.05);
    });
  });
});
