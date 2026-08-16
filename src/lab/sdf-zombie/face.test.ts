// src/lab/sdf-zombie/face.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_FACE, facePrims } from './face';
import { MAX_PRIMS } from './validate';

describe('facePrims', () => {
  it('emits a cranium and a jaw, both on the skull bone', () => {
    const prims = facePrims(DEFAULT_FACE);
    expect(prims.map(p => p.tag)).toEqual(['head', 'jaw']);
    for (const p of prims) {
      expect(p.bone).toBe('skull');
      expect(p.limb).toBe('head');
    }
  });

  it('makes the jaw narrower than the cranium, so the skull tapers', () => {
    const [head, jaw] = facePrims(DEFAULT_FACE);
    // A single ellipsoid cannot taper; the pair is what gives the gaunt egg
    // silhouette, and silhouette is the one thing the texture cannot supply.
    expect(jaw!.radius).toBeLessThan(head!.radius);
    expect(jaw!.scale[0]).toBeLessThan(head!.scale[0]);
    expect(jaw!.offset![1]).toBeLessThan(0);
  });

  it('is purely additive — the face is texture, not geometry', () => {
    // Carved sockets, a mouth, a nose and eyeballs were each built and judged
    // on screen. smin's blend zone is wider than a small feature; hard carves
    // fixed that but every primitive still shares one albedo, so a geometric
    // eyeball reads as flesh. And a protruding nose breaks a planar face
    // projection outright by sticking through the projection plane.
    expect(facePrims(DEFAULT_FACE).every(p => p.op !== 'sub')).toBe(true);
    expect(facePrims(DEFAULT_FACE).every(p => !p.mirrorOffset)).toBe(true);
  });

  it('scales the head on each axis independently', () => {
    const tall = facePrims({ ...DEFAULT_FACE, headHeight: 1.8 })[0]!;
    const flat = facePrims({ ...DEFAULT_FACE, headHeight: 0.8 })[0]!;
    expect(tall.scale[1]).toBeGreaterThan(flat.scale[1]);
    expect(tall.scale[0]).toBe(flat.scale[0]);
  });

  it('grows the head with headRadius', () => {
    expect(facePrims({ ...DEFAULT_FACE, headRadius: 0.18 })[0]!.radius)
      .toBeGreaterThan(facePrims({ ...DEFAULT_FACE, headRadius: 0.09 })[0]!.radius);
  });

  it('drops the jaw further with jawDrop', () => {
    const at = (d: number) =>
      facePrims({ ...DEFAULT_FACE, jawDrop: d }).find(p => p.tag === 'jaw')!.offset![1]!;
    expect(at(0.14)).toBeLessThan(at(0.04));
  });

  it('leaves the body plenty of room inside the shader cap', () => {
    expect(21 + facePrims(DEFAULT_FACE).length).toBeLessThanOrEqual(MAX_PRIMS);
  });
});
