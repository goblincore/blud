// src/lab/sdf-zombie/build-body.test.ts
import { describe, it, expect } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE, makeZombie } from './body';
import { DEFAULT_FACE, facePrims } from './face';
import { CLUSTER_ORDER } from './types';
import { MAX_PRIMS } from './validate';

describe('buildBody with the shipped zombie', () => {
  const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

  it('produces a body that passes every check', () => {
    expect(built.errors).toEqual([]);
  });

  it('has all six clusters, in fold order', () => {
    expect(built.clusters.map(c => c.limb)).toEqual([...CLUSTER_ORDER]);
  });

  it('stays within the shader ceilings', () => {
    expect(built.prims.length).toBeGreaterThanOrEqual(15);
    expect(built.prims.length).toBeLessThanOrEqual(MAX_PRIMS);
  });

  it('is bilaterally symmetric in x', () => {
    const flip = (n: number) => Math.round(n * 1e6) / 1e6;
    const left = built.prims.filter(p => p.limb === 'armL').map(p => flip(p.a[0]));
    const right = built.prims.filter(p => p.limb === 'armR').map(p => flip(-p.a[0]));
    expect(left).toEqual(right);
  });

  it('applies an override layer over the base definition', () => {
    const o = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, { primRadius: { 0: 0.99 } });
    expect(o.prims[0]!.radius).toBe(0.99);
    // The base definition is not mutated.
    expect(buildBody(ZOMBIE, DEFAULT_BUILD_OPTS).prims[0]!.radius).not.toBe(0.99);
  });

  it('reports errors instead of throwing when an override breaks a check', () => {
    const o = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, { primBlendK: { 0: 0 } });
    expect(Array.isArray(o.errors)).toBe(true);
  });
});

describe('makeZombie', () => {
  const built = buildBody(makeZombie(DEFAULT_FACE), DEFAULT_BUILD_OPTS);

  it('builds a valid body with the face attached', () => {
    expect(built.errors).toEqual([]);
  });

  it('adds the face to the head cluster and nowhere else', () => {
    const head = built.clusters.find(c => c.limb === 'head')!;
    const faceCount = facePrims(DEFAULT_FACE).length;
    // The face grows the head cluster and leaves the other five untouched.
    expect(head.count).toBe(3 + faceCount);
    for (const p of built.prims.slice(head.start, head.start + head.count))
      expect(p.limb).toBe('head');
  });

  it('carries no carves — face detail is the texture\'s job', () => {
    // Carved sockets/mouth/temples were built, judged, and removed: smin's
    // blend zone is wider than the features, and a primitive costs
    // prims x steps x pixels while a texture costs one sample at the hit point.
    expect(built.prims.every(p => p.op !== 'sub')).toBe(true);
  });

  it('stays inside the shader primitive cap', () => {
    expect(built.prims.length).toBeLessThanOrEqual(MAX_PRIMS);
  });
});
