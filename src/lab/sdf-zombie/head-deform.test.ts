// src/lab/sdf-zombie/head-deform.test.ts
//
import { describe, expect, it } from 'vitest';
import { HEAD_DEFORM, addDent, deformHead, headAffine, headAffineMatrix, kickWobble, makeHeadDeform, stepWobble, wobbleValue, type HeadFrame } from './head-deform';
import type { Primitive } from './types';

const frame: HeadFrame = { centre: [0, 1.6, 0], quat: [0, 0, 0, 1], axes: [0.09, 0.11, 0.1] };
const headPrim = (): Primitive => ({ limb: 'head', op: 'union', a: [0, 1.6, 0], b: [0, 1.6, 0], radius: 0.1,
  scale: [0.9, 1.1, 1.0], blendK: 0.01 } as unknown as Primitive);
const torsoPrim = (): Primitive => ({ limb: 'torso', op: 'union', a: [0, 1.2, 0], b: [0, 1.4, 0], radius: 0.15,
  scale: [1, 1, 1], blendK: 0.02 } as unknown as Primitive);
/** Extent of an ellipsoid prim (a === b) along world x. */
const xExtent = (p: Primitive): [number, number] => [p.a[0] - p.radius * p.scale[0], p.a[0] + p.radius * p.scale[0]];

describe('head wobble', () => {
  it('kicks to squash0, rings at ~8 Hz and settles below 1% within 0.8 s', () => {
    let s = kickWobble(makeHeadDeform(), [1, 0, 0]);
    expect(wobbleValue(s)).toBeCloseTo(HEAD_DEFORM.squash0, 9);
    let crossings = 0, prev = wobbleValue(s);
    for (let t = 0; t < 0.8; t += 1 / 240) {
      s = stepWobble(s, 1 / 240);
      const v = wobbleValue(s);
      if (Math.sign(v) !== Math.sign(prev) && prev !== 0) crossings++;
      prev = v;
    }
    expect(crossings).toBeGreaterThanOrEqual(4);                   // it rings (underdamped)
    expect(Math.abs(wobbleValue(s))).toBeLessThan(0.0025);   // settled: < 1% of the head's size
  });
  it('comes to rest at exactly 0, and a rested, undented head is the body untouched', () => {
    let s = kickWobble(makeHeadDeform(), [0, 0, 1]);
    for (let t = 0; t < 1.5; t += 1 / 60) s = stepWobble(s, 1 / 60);
    expect(s.s).toBe(0);
    expect(s.v).toBe(0);
    const body = { prims: [headPrim(), torsoPrim()] };
    expect(deformHead(body, s, frame)).toBe(body);
  });
  it('clamps to ±maxSquash', () => {
    let s = kickWobble(kickWobble(makeHeadDeform(), [1, 0, 0]), [1, 0, 0]);
    expect(Math.abs(wobbleValue(s))).toBeLessThanOrEqual(HEAD_DEFORM.maxSquash);
  });
});

describe('deformHead', () => {
  it('leaves non-head prims identical (the same objects)', () => {
    const body = { prims: [torsoPrim(), headPrim()] };
    const out = deformHead(body, kickWobble(makeHeadDeform(), [1, 0, 0]), frame);
    expect(out.prims[0]).toBe(body.prims[0]);
  });
  it('a squash along x shortens the head along x and widens it across', () => {
    const body = { prims: [headPrim()] };
    const out = deformHead(body, kickWobble(makeHeadDeform(), [1, 0, 0]), frame).prims[0]!;
    expect(out.scale[0]).toBeLessThan(body.prims[0]!.scale[0]);
    expect(out.scale[1]).toBeGreaterThan(body.prims[0]!.scale[1]);
    expect(out.scale[2]).toBeGreaterThan(body.prims[0]!.scale[2]);
  });
  it('a dent from a blow travelling +x flattens the −x side and leaves the +x side put', () => {
    const body = { prims: [headPrim()] };
    const s = addDent(makeHeadDeform(), [1, 0, 0], 0.018, frame.axes);
    const [lo0, hi0] = xExtent(body.prims[0]!);
    const [lo1, hi1] = xExtent(deformHead(body, s, frame).prims[0]!);
    expect(lo1 - lo0).toBeCloseTo(0.018, 4);
    expect(hi1).toBeCloseTo(hi0, 4);
  });
  it('dents on the same side accumulate and cap at maxDent', () => {
    let s = makeHeadDeform();
    for (let i = 0; i < 5; i++) s = addDent(s, [1, 0, 0], 0.018, frame.axes);
    expect(s.flat[1]).toBeCloseTo(HEAD_DEFORM.maxDent, 9);   // index 1 = the −x side
  });
  it('a head turned 90° about y dents along the head axis, not the world axis', () => {
    const turned: HeadFrame = { ...frame, quat: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };  // head +x → world −z
    const body = { prims: [headPrim()] };
    const s = addDent(makeHeadDeform(), [1, 0, 0], 0.018, turned.axes);   // blow along the HEAD's +x
    const out = deformHead(body, s, turned).prims[0]!;
    expect(out.a[2]).toBeCloseTo(body.prims[0]!.a[2] - 0.009, 4);   // centre shifts half the depth along head +x = world −z
  });
});

describe('the skull deforms with the flesh (Task 10)', () => {
  const bonePrim = (op: 'bone' | 'organ' = 'bone', limb = 'head'): Primitive => ({ limb, op, a: [0.02, 1.62, 0.03],
    b: [-0.01, 1.58, 0.05], radius: 0.06, scale: [0.9, 1.1, 1.0], blendK: 0 } as unknown as Primitive);
  const turned: HeadFrame = { ...frame, quat: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
  const squashedAndDented = () => kickWobble(addDent(addDent(makeHeadDeform(), [0, 0, 1], 0.018, frame.axes), [1, 0, 0], 0.012, frame.axes), [0, 0, 1]);

  it('a head bone prim moves by exactly the flesh transform at the same point (flat + squash, turned head)', () => {
    const flesh = { ...bonePrim(), op: 'union' } as unknown as Primitive;
    const body = { prims: [flesh], bonePrims: [bonePrim('bone'), bonePrim('organ')] };
    const out = deformHead(body, squashedAndDented(), turned);
    for (const b of out.bonePrims) {
      expect(b.a).toEqual(out.prims[0]!.a);
      expect(b.b).toEqual(out.prims[0]!.b);
      expect(b.scale).toEqual(out.prims[0]!.scale);
    }
    expect(out.bonePrims[0]!.a).not.toEqual(body.bonePrims[0]!.a);
  });
  it('leaves non-head bone prims as the same objects', () => {
    const body = { prims: [headPrim()], bonePrims: [bonePrim('bone', 'torso'), bonePrim()] };
    const out = deformHead(body, squashedAndDented(), frame);
    expect(out.bonePrims[0]).toBe(body.bonePrims[0]);
    expect(out.bonePrims[1]).not.toBe(body.bonePrims[1]);
  });
  it('with no deformation, bonePrims comes back as the same array and headAffine is null', () => {
    const body = { prims: [headPrim()], bonePrims: [bonePrim()] };
    expect(deformHead(body, makeHeadDeform(), frame).bonePrims).toBe(body.bonePrims);
    expect(headAffine(makeHeadDeform(), frame)).toBeNull();
  });
  it('headAffineMatrix (column-major 4x4) maps a point exactly as deformHead maps an endpoint', () => {
    const st = squashedAndDented();
    const body = { prims: [headPrim(), { ...headPrim(), a: [0.05, 1.7, -0.04], b: [-0.03, 1.5, 0.08] } as Primitive] };
    const out = deformHead(body, st, turned);
    const m = headAffineMatrix(headAffine(st, turned)!);
    const apply = (p: readonly number[]) => [0, 1, 2].map(r => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!);
    for (const [i, end] of [[1, 'a'], [1, 'b'], [0, 'a']] as const) {
      const got = apply(body.prims[i]![end]), want = out.prims[i]![end];
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k]!, 12);
    }
    expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
  });
});
