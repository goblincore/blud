import { describe, expect, it } from 'vitest';
import {
  BODY_LOD_DEFAULTS, bodyLodConfigFrom, bodyLodEligible, inMeshBand, restBakeBounds, skinWeights, stickyRefine,
  type BodyLodFacts,
} from './body-lod';
import type { Primitive } from './types';

const prim = (a: [number, number, number], b: [number, number, number], bone: string, extra: Partial<Primitive> = {}): Primitive => ({
  a, b, bone, radius: 0.05, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, ...extra,
} as Primitive);

const intact: BodyLodFacts = { standing: true, burning: false, tearing: false, wounded: false, severed: false };

describe('body-lod config', () => {
  it('defaults on, and ?bodylod=0 is off', () => {
    expect(bodyLodConfigFrom('')).toEqual(BODY_LOD_DEFAULTS);
    expect(bodyLodConfigFrom('?bodylod=0').on).toBe(false);
  });
  it('reads the band, the wound rule and the look', () => {
    const c = bodyLodConfigFrom('?bodylodm=14&bodylodh=2&bodylodwound=keep&bodylodlook=corpse');
    expect(c).toMatchObject({ switchM: 14, hysteresisM: 2, wound: 'keep', look: 'corpse' });
    expect(bodyLodConfigFrom('?bodylodm=nope').switchM).toBe(BODY_LOD_DEFAULTS.switchM);
  });
});

describe('inMeshBand', () => {
  const cfg = { switchM: 10, hysteresisM: 1 };
  it('enters beyond switch + h/2 and leaves inside switch - h/2', () => {
    expect(inMeshBand(false, 10.4, cfg)).toBe(false);
    expect(inMeshBand(false, 10.6, cfg)).toBe(true);
    expect(inMeshBand(true, 9.6, cfg)).toBe(true);
    expect(inMeshBand(true, 9.4, cfg)).toBe(false);
  });
});

describe('bodyLodEligible / stickyRefine', () => {
  it('refine: only an intact standing body', () => {
    expect(bodyLodEligible(intact, 'refine')).toBe(true);
    for (const k of ['burning', 'tearing', 'wounded', 'severed'] as const)
      expect(bodyLodEligible({ ...intact, [k]: true }, 'refine')).toBe(false);
    expect(bodyLodEligible({ ...intact, standing: false }, 'refine')).toBe(false);
  });
  it('keep: a wound alone stays meshed, a sever does not', () => {
    expect(bodyLodEligible({ ...intact, wounded: true }, 'keep')).toBe(true);
    expect(bodyLodEligible({ ...intact, severed: true }, 'keep')).toBe(false);
  });
  it('refine is sticky on damage, keep is not', () => {
    expect(stickyRefine('refine', { ...intact, wounded: true })).toBe(true);
    expect(stickyRefine('keep', { ...intact, wounded: true })).toBe(false);
    expect(stickyRefine('refine', intact)).toBe(false);
  });
});

describe('restBakeBounds', () => {
  it('boxes the live additive prims and skips sub and dead', () => {
    const b = restBakeBounds([prim([0, 0, 0], [0, 1, 0], 'spine'), prim([5, 5, 5], [5, 5, 5], 'x', { op: 'sub' }),
      prim([-5, 0, 0], [-5, 0, 0], 'y', { dead: true })])!;
    expect(b.centre[0]).toBeCloseTo(0);
    expect(b.centre[1]).toBeCloseTo(0.5);
    expect(b.halfExtent[1]).toBeCloseTo(0.5 + 0.075);
    expect(restBakeBounds([prim([0, 0, 0], [0, 0, 0], 'a', { dead: true })])).toBeNull();
  });
});

describe('skinWeights', () => {
  const prims = [prim([0, 0, 0], [0, 1, 0], 'upper'), prim([0, 1, 0], [0, 2, 0], 'lower')];
  const bones = ['upper', 'lower'];
  it('a vertex deep in one segment is fully that bone; one at the joint is split', () => {
    const pos = new Float32Array([0.05, 0.3, 0, 0.05, 1.0, 0, 0.05, 1.7, 0]);
    const { index, weight } = skinWeights(pos, prims, bones);
    expect(index[0]).toBe(0); expect(weight[0]).toBeGreaterThan(0.99);
    expect(index[8]).toBe(1); expect(weight[8]).toBeGreaterThan(0.99);
    expect(weight[4]! + weight[5]!).toBeCloseTo(1);
    expect(weight[4]).toBeCloseTo(0.5, 1);
  });
  it('weights always sum to one; an unclaimed vertex goes to bone 0', () => {
    const pos = new Float32Array([0.3, 0.9, 0.1]);
    const { weight } = skinWeights(pos, prims, bones);
    expect(weight[0]! + weight[1]! + weight[2]! + weight[3]!).toBeCloseTo(1);
    const none = skinWeights(new Float32Array([0, 0, 0]), prims, ['other']);
    expect(none.index[0]).toBe(0); expect(none.weight[0]).toBe(1);
  });
});
