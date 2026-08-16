// src/lab/sdf-zombie/simplify.test.ts
import { describe, it, expect } from 'vitest';
import { simplifyBody, SIMPLIFY_FATTEN } from './simplify';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { len, sub } from './vec';

const full = buildBody(makeZombie({ ...DEFAULT_FACE }), DEFAULT_BUILD_OPTS);

describe('simplifyBody', () => {
  it('collapses to exactly one primitive per live cluster', () => {
    const s = simplifyBody(full);
    expect(s.prims.length).toBe(full.clusters.filter(c => c.alive).length);
    expect(s.prims.length).toBeLessThan(full.prims.length / 3);
  });

  it('keeps the cluster slices contiguous and self-consistent', () => {
    // pack.ts walks clusters by (start, count) and the shader's fold order is
    // the cluster order, so a stand-in with stale indices would render as
    // garbage rather than as a coarse body.
    const s = simplifyBody(full);
    s.clusters.forEach((c, i) => {
      expect(c.id).toBe(i);
      expect(c.start).toBe(i);
      expect(c.count).toBe(1);
      expect(s.prims[c.start]!.cluster).toBe(i);
    });
  });

  it('drops severed clusters entirely', () => {
    const oneArmed: BuildResult = {
      ...full,
      clusters: full.clusters.map(c => (c.limb === 'armL' ? { ...c, alive: false } : c)),
    };
    const s = simplifyBody(oneArmed);
    expect(s.clusters.some(c => c.limb === 'armL')).toBe(false);
    expect(s.prims.length).toBe(full.clusters.length - 1);
  });

  it('drops carves — a face is texture at this range', () => {
    // The shipped zombie has no carves: the face experiment ended with
    // everything as texture. So the carve has to be introduced here rather
    // than assumed, or this test would pass without exercising anything.
    const head = full.clusters.find(c => c.limb === 'head')!;
    const carved: BuildResult = {
      ...full,
      prims: full.prims.map((p, i) =>
        i === head.start ? { ...p, op: 'sub' as const } : p),
    };
    expect(carved.prims.some(p => p.op === 'sub')).toBe(true);
    expect(simplifyBody(carved).prims.some(p => p.op === 'sub')).toBe(false);
  });

  it('takes thickness from the PRIMITIVES, not the cluster bounds', () => {
    // The regression this guards: using the cluster's bounding radius made
    // every limb as fat as it was long, and the body rendered as a mitten.
    // A limb's stand-in must stay far thinner than the limb is long.
    const s = simplifyBody(full);
    for (const c of s.clusters) {
      if (c.limb === 'head' || c.limb === 'torso') continue;
      const p = s.prims[c.start]!;
      const length = len(sub(p.b, p.a));
      expect(p.radius).toBeLessThan(length);
      expect(p.radius).toBeLessThan(c.radius);
    }
  });

  it('spans each limb along its own longest axis', () => {
    // A sphere per cluster either loses the limb or swallows the gap to its
    // neighbour; the stand-in has to be a capsule that runs down the limb.
    const s = simplifyBody(full);
    const legL = s.clusters.find(c => c.limb === 'legL')!;
    const p = s.prims[legL.start]!;
    // Legs run vertically, so the span must be predominantly in y.
    const d = sub(p.b, p.a);
    expect(Math.abs(d[1])).toBeGreaterThan(Math.abs(d[0]));
    expect(Math.abs(d[1])).toBeGreaterThan(Math.abs(d[2]));
  });

  it('stays inside the detailed body it stands in for, allowing the fattening', () => {
    // A stand-in bigger than the real body pops outward when it swaps in,
    // which is far more visible than one that is slightly slimmer.
    const s = simplifyBody(full);
    for (const c of s.clusters) {
      const detail = full.clusters.find(d => d.limb === c.limb)!;
      const widest = Math.max(
        ...full.prims
          .slice(detail.start, detail.start + detail.count)
          .filter(p => p.op !== 'sub')
          .map(p => p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2])),
      );
      expect(s.prims[c.start]!.radius).toBeCloseTo(widest * SIMPLIFY_FATTEN, 6);
    }
  });

  it('clears errors rather than re-validating a derived body', () => {
    expect(simplifyBody(full).errors).toEqual([]);
  });

  it('survives a body whose cluster has no additive primitives', () => {
    const carveOnly: BuildResult = {
      ...full,
      prims: full.prims.map(p => ({ ...p, op: 'sub' as const })),
    };
    const s = simplifyBody(carveOnly);
    // Falls back to the cluster centre with a sane radius instead of emitting
    // NaN endpoints, which would blow up the march rather than look wrong.
    for (const p of s.prims) {
      expect(Number.isFinite(p.radius)).toBe(true);
      expect(p.radius).toBeGreaterThan(0);
      for (const e of [p.a, p.b]) for (const v of e) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
