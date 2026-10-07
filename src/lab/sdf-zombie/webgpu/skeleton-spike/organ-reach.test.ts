// src/lab/sdf-zombie/webgpu/skeleton-spike/organ-reach.test.ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import zombieSrc from '../../characters/zombie.blob?raw';
import { createSkeletonSources } from './contract';
import { organReached, segmentBoundSphere } from './organ-reach';

describe('organReached', () => {
  it('an empty list reaches nothing', () => {
    expect(organReached([], [0, 0, 0], 1)).toBe(false);
  });
  it('spheres apart do not reach, overlapping ones do', () => {
    expect(organReached([{ pos: [0.301, 0, 0], radius: 0.1 }], [0, 0, 0], 0.2)).toBe(false);
    expect(organReached([{ pos: [0.299, 0, 0], radius: 0.1 }], [0, 0, 0], 0.2)).toBe(true);
  });
  it('any one sphere is enough', () => {
    expect(organReached([{ pos: [5, 0, 0], radius: 0.1 }, { pos: [0, 0.1, 0], radius: 0.05 }], [0, 0, 0], 0.1)).toBe(true);
  });
});

describe('segmentBoundSphere', () => {
  const bounds = { min: [-0.1, 0, -0.02] as const, max: [0.1, 0.2, 0.08] as const };
  it('at the identity is the box centre and half its diagonal', () => {
    const s = segmentBoundSphere(bounds, { origin: [1, 2, 3], quat: [0, 0, 0, 1] });
    expect(s.centre[0]).toBeCloseTo(1, 12); expect(s.centre[1]).toBeCloseTo(2.1, 12); expect(s.centre[2]).toBeCloseTo(3.03, 12);
    expect(s.radius).toBeCloseTo(Math.hypot(0.2, 0.2, 0.1) / 2, 12);
  });
  it('turns the centre with the pose (a quarter turn about y sends +z to +x)', () => {
    const h = Math.SQRT1_2;
    const s = segmentBoundSphere(bounds, { origin: [0, 0, 0], quat: [0, h, 0, h] });
    expect(s.centre[0]).toBeCloseTo(0.03, 9); expect(s.centre[1]).toBeCloseTo(0.1, 9); expect(s.centre[2]).toBeCloseTo(0, 9);
  });
});

describe('on the real zombie', () => {
  const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
  const organs = createSkeletonSources(body, bindRig(body), { character: 'zombie', organs: true }).filter(s => s.kind === 'organ');
  // The cranium: the fattest skull bone prim (a sphere).
  const head = body.bonePrims.filter(b => b.op === 'bone' && b.limb === 'head').reduce((a, b) => (b.radius > a.radius ? b : a)).a;
  it('a head crater reaches no organ segment; a belly crater reaches them', () => {
    expect(organs.length).toBeGreaterThan(0);
    for (const s of organs) {
      const b = segmentBoundSphere(s.bounds, s.pose());
      // The bound really holds the segment: every corner of the local box is inside it.
      for (const x of [s.bounds.min[0], s.bounds.max[0]]) for (const y of [s.bounds.min[1], s.bounds.max[1]]) for (const z of [s.bounds.min[2], s.bounds.max[2]]) {
        const w = s.toWorld([x, y, z]);
        expect(Math.hypot(w[0] - b.centre[0], w[1] - b.centre[1], w[2] - b.centre[2])).toBeLessThanOrEqual(b.radius + 1e-9);
      }
      expect(organReached([{ pos: head, radius: 0.12 }], b.centre, b.radius)).toBe(false);
      expect(organReached([{ pos: [0, 1.03, 0.12], radius: 0.08 }], b.centre, b.radius)).toBe(true);
    }
  });
});
