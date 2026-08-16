// src/lab/sdf-zombie/face.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_FACE, facePrims } from './face';
import { MAX_PRIMS } from './validate';

describe('facePrims', () => {
  it('puts every feature in the head cluster on the skull bone', () => {
    for (const p of facePrims(DEFAULT_FACE)) {
      expect(p.limb).toBe('head');
      expect(p.bone).toBe('skull');
    }
  });

  it('carves the socket and mouth, and adds the eyeball and lid', () => {
    const byTag = new Map(facePrims(DEFAULT_FACE).map(p => [p.tag, p]));
    expect(byTag.get('eye-socket')!.op).toBe('sub');
    expect(byTag.get('mouth')!.op).toBe('sub');
    // An empty socket reads as a hole; a ball under a lid reads as an eye.
    expect(byTag.get('eyeball')!.op).not.toBe('sub');
    expect(byTag.get('eyelid')!.op).not.toBe('sub');
  });

  it('gives every face FEATURE a hard edge, and the big forms a soft one', () => {
    // blendK 0 makes smin short-circuit to a hard min. Without it the blend
    // zone (k*4) is wider than the feature and it smears into a band — which
    // is exactly how the first four attempts failed.
    const byTag = new Map(facePrims(DEFAULT_FACE).map(p => [p.tag, p]));
    for (const tag of ['eye-socket', 'eyeball', 'eyelid', 'mouth'])
      expect(byTag.get(tag)!.blendK).toBe(0);
    // The nose and brow are large forms that SHOULD melt into the skull.
    for (const tag of ['brow', 'nose-bridge', 'nose-tip'])
      expect(byTag.get(tag)!.blendK).toBeGreaterThan(0);
  });

  it('drops the lid further over the eye as lidDroop grows', () => {
    const lidY = (droop: number) =>
      facePrims({ ...DEFAULT_FACE, lidDroop: droop }).find(p => p.tag === 'eyelid')!.offset![1]!;
    expect(lidY(0.03)).toBeLessThan(lidY(0.0));
  });

  it('never mirrors by bone — `skull` is not a mirrored bone', () => {
    // mirror:true would throw in expandMirror; bilateral features must use
    // mirrorOffset instead.
    for (const p of facePrims(DEFAULT_FACE)) expect(p.mirror).toBeFalsy();
  });

  it('leaves room for the body inside the shader cap', () => {
    // The body is 21 primitives; mirrorOffset doubles some face entries.
    const expanded = facePrims(DEFAULT_FACE)
      .reduce((n, p) => n + (p.mirrorOffset ? 2 : 1), 0);
    expect(21 + expanded).toBeLessThanOrEqual(MAX_PRIMS);
  });

  it('moves the nose tip further out as noseLength grows', () => {
    const tipZ = (len: number) =>
      facePrims({ ...DEFAULT_FACE, noseLength: len }).find(p => p.tag === 'nose-tip')!.offset![2]!;
    // FACE_FORWARD is +z, so a longer nose means a larger z offset.
    expect(tipZ(0.10)).toBeGreaterThan(tipZ(0.04));
  });

  it('keeps the expanded primitive count within budget', () => {
    const expanded = facePrims(DEFAULT_FACE)
      .reduce((n, p) => n + (p.mirrorOffset ? 2 : 1), 0);
    expect(21 + expanded).toBeLessThanOrEqual(MAX_PRIMS);
  });
});
