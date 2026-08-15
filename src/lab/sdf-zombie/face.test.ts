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

  it('emits both carves and additions', () => {
    const prims = facePrims(DEFAULT_FACE);
    expect(prims.some(p => p.op === 'sub')).toBe(true);
    expect(prims.some(p => p.op !== 'sub')).toBe(true);
  });

  it('makes bilateral features by offset, never by bone mirroring', () => {
    // `skull` is not a mirrored bone, so mirror:true would throw in expandMirror.
    for (const p of facePrims(DEFAULT_FACE)) expect(p.mirror).toBeFalsy();
    expect(facePrims(DEFAULT_FACE).some(p => p.mirrorOffset)).toBe(true);
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

  it('deepens the eye sockets as socketDepth grows', () => {
    const socket = (d: number) =>
      facePrims({ ...DEFAULT_FACE, socketDepth: d }).find(p => p.tag === 'eye-socket')!;
    expect(socket(0.05).radius).toBeGreaterThan(socket(0.02).radius);
  });
});
