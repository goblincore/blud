import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  MAX_DEFERRED_LIGHTS,
  DEFERRED_LIGHT_STRIDE_FLOATS,
  packDeferredLights,
  createDeferredLightTexture,
  uploadDeferredLights,
  type DeferredLight,
} from './deferred-lighting';

const point: DeferredLight = {
  kind: 'point',
  position: [0, 2, 0] as const,
  direction: [0, -1, 0] as const,
  color: [1, 0.5, 0.2] as const,
  intensity: 2,
  range: 8,
  cosInner: 1,
  cosOuter: 0,
};

describe('packDeferredLights', () => {
  it('packs zero lights as count 0 over a full-capacity buffer', () => {
    const packed = packDeferredLights([]);
    expect(packed.count).toBe(0);
    expect(packed.data.length).toBe(MAX_DEFERRED_LIGHTS * DEFERRED_LIGHT_STRIDE_FLOATS);
    expect(Array.from(packed.data)).toEqual(Array(MAX_DEFERRED_LIGHTS * DEFERRED_LIGHT_STRIDE_FLOATS).fill(0));
  });

  it('packs one point light at the documented stride', () => {
    const packed = packDeferredLights([point]);
    expect(packed.count).toBe(1);
    const d = packed.data;
    // v0: position.xyz, kind (0 = point)
    expect([d[0], d[1], d[2], d[3]]).toEqual([0, 2, 0, 0]);
    // v1: direction.xyz, range
    expect([d[4], d[5], d[6], d[7]]).toEqual([0, -1, 0, 8]);
    // v2: color.rgb, intensity (float32 lanes — compare with tolerance)
    expect(d[8]).toBe(1);
    expect(d[9]).toBe(0.5);
    expect(d[10]).toBeCloseTo(0.2, 6);
    expect(d[11]).toBe(2);
    // v3: cosInner, cosOuter, pad, pad
    expect([d[12], d[13], d[14], d[15]]).toEqual([1, 0, 0, 0]);
  });

  it('encodes spot kind as 1 and packs lights back to back', () => {
    const spot: DeferredLight = { ...point, kind: 'spot', position: [3, 4, 5] as const };
    const packed = packDeferredLights([point, spot]);
    expect(packed.count).toBe(2);
    expect(packed.data[DEFERRED_LIGHT_STRIDE_FLOATS + 3]).toBe(1);
    expect(packed.data[DEFERRED_LIGHT_STRIDE_FLOATS + 0]).toBe(3);
    expect(packed.data[DEFERRED_LIGHT_STRIDE_FLOATS + 2]).toBe(5);
  });

  it('zeros inactive slots on every pack, even after larger packs', () => {
    const big = packDeferredLights(Array(4).fill(point));
    expect(big.count).toBe(4);
    const small = packDeferredLights([point]);
    expect(small.count).toBe(1);
    expect(Array.from(small.data.slice(DEFERRED_LIGHT_STRIDE_FLOATS))).toEqual(
      Array((MAX_DEFERRED_LIGHTS - 1) * DEFERRED_LIGHT_STRIDE_FLOATS).fill(0),
    );
  });

  it('rejects overflow beyond the fixed capacity', () => {
    expect(() => packDeferredLights(Array(MAX_DEFERRED_LIGHTS + 1).fill(point))).toThrow();
    expect(() => packDeferredLights(Array(17).fill(point))).toThrow();
    expect(() => packDeferredLights(Array(MAX_DEFERRED_LIGHTS).fill(point))).not.toThrow();
  });

  it('rejects nonfinite light data instead of poisoning the GPU buffer', () => {
    expect(() => packDeferredLights([{ ...point, intensity: Number.NaN }])).toThrow();
    expect(() => packDeferredLights([{ ...point, position: [0, Number.POSITIVE_INFINITY, 0] as const }])).toThrow();
    expect(() => packDeferredLights([{ ...point, range: 0 }])).toThrow();
    expect(() => packDeferredLights([{ ...point, color: [1, -0.5, 0] as const }])).toThrow();
  });
});

describe('deferred light data texture', () => {
  it('is allocated once at full capacity (never resized — the DataTexture trap)', () => {
    const tex = createDeferredLightTexture();
    try {
      expect(tex.image.width).toBe(DEFERRED_LIGHT_STRIDE_FLOATS / 4);
      expect(tex.image.height).toBe(MAX_DEFERRED_LIGHTS);
      expect(tex.format).toBe(THREE.RGBAFormat);
      expect(tex.type).toBe(THREE.FloatType);
      expect(tex.minFilter).toBe(THREE.NearestFilter);
      expect(tex.magFilter).toBe(THREE.NearestFilter);
      expect(tex.colorSpace).toBe(THREE.NoColorSpace);
      expect((tex.image.data as Float32Array).length).toBe(MAX_DEFERRED_LIGHTS * DEFERRED_LIGHT_STRIDE_FLOATS);
    } finally {
      tex.dispose();
    }
  });

  it('upload copies packed data in place and flags the upload', () => {
    const tex = createDeferredLightTexture();
    try {
      const packed = packDeferredLights([point]);
      uploadDeferredLights(tex, packed);
      const data = tex.image.data as Float32Array;
      expect([data[0], data[1], data[2], data[3]]).toEqual([0, 2, 0, 0]);
      expect(data.length).toBe(packed.data.length);
      // A second, smaller upload must leave no residue in inactive slots.
      uploadDeferredLights(tex, packDeferredLights([]));
      expect(Array.from(data)).toEqual(Array(data.length).fill(0));
    } finally {
      tex.dispose();
    }
  });
});
