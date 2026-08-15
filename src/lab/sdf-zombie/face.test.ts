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

  it('is purely additive — features are the texture\'s job, not geometry\'s', () => {
    // Carved sockets/mouth/temples were tried and removed: smin's blend zone
    // (k*4) is wider than the features themselves, so they smear into a band.
    // Carving infrastructure still exists for wounds and the skeleton field.
    expect(facePrims(DEFAULT_FACE).every(p => p.op !== 'sub')).toBe(true);
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

  it('keeps the primitive count low — detail moved to texture', () => {
    expect(facePrims(DEFAULT_FACE).length).toBeLessThanOrEqual(4);
  });
});
