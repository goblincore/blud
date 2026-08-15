// src/lab/sdf-zombie/clusters.test.ts
import { describe, it, expect } from 'vitest';
import { assignClusters } from './clusters';
import { CLUSTER_ORDER, type LimbId, type Primitive } from './types';
import { len, sub } from './vec';

const prim = (limb: LimbId, a: [number, number, number], radius = 0.1): Omit<Primitive, 'cluster'> =>
  ({ a, b: a, radius, scale: [1, 1, 1], blendK: 0.05, limb });

describe('assignClusters', () => {
  // Deliberately out of fold order on input.
  const input = [
    prim('legR', [-0.1, 0.4, 0]),
    prim('head', [0, 1.7, 0]),
    prim('torso', [0, 1.2, 0]),
    prim('legL', [0.1, 0.4, 0]),
    prim('torso', [0, 1.0, 0]),
  ];
  const built = assignClusters(input);

  it('sorts primitives into CLUSTER_ORDER regardless of input order', () => {
    const limbs = built.prims.map(p => p.limb);
    const rank = (l: LimbId) => CLUSTER_ORDER.indexOf(l);
    for (let i = 1; i < limbs.length; i++)
      expect(rank(limbs[i]!)).toBeGreaterThanOrEqual(rank(limbs[i - 1]!));
  });

  it('stamps each primitive with its cluster id matching CLUSTER_ORDER', () => {
    for (const p of built.prims) expect(p.cluster).toBe(CLUSTER_ORDER.indexOf(p.limb));
  });

  it('gives every cluster a contiguous start/count covering its primitives', () => {
    for (const c of built.clusters) {
      const slice = built.prims.slice(c.start, c.start + c.count);
      expect(slice).toHaveLength(c.count);
      for (const p of slice) expect(p.limb).toBe(c.limb);
    }
  });

  it('omits clusters that have no primitives', () => {
    expect(built.clusters.map(c => c.limb)).toEqual(['head', 'torso', 'legL', 'legR']);
  });

  it('produces a bounding sphere that contains every primitive it covers', () => {
    for (const c of built.clusters)
      for (const p of built.prims.slice(c.start, c.start + c.count))
        for (const end of [p.a, p.b]) {
          const maxScale = Math.max(...p.scale);
          expect(len(sub(end, c.center)) + p.radius * maxScale).toBeLessThanOrEqual(c.radius + 1e-9);
        }
  });

  it('starts every cluster alive', () => {
    expect(built.clusters.every(c => c.alive)).toBe(true);
  });
});
