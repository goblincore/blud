import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  MAX_DEFERRED_LIGHTS,
  DEFERRED_LIGHT_STRIDE_FLOATS,
  packDeferredLights,
  createDeferredLightTexture,
  uploadDeferredLights,
  FLESH_KEY_PRESENT_ZERO,
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

describe('march-key flesh fields (M2 task 5 game conversion)', () => {
  it('defaults absent fields to packed zeros (the M1 fixture shape)', () => {
    const packed = packDeferredLights([point]);
    expect(packed.data[14]).toBe(0);
    expect(packed.data[15]).toBe(0);
  });

  it('packs fleshKeyIntensity at o+14 and fleshShoulderKnee at o+15', () => {
    const packed = packDeferredLights([{ ...point, fleshKeyIntensity: 4, fleshShoulderKnee: 0.65 }]);
    expect(packed.data[12]).toBe(point.cosInner);
    expect(packed.data[13]).toBe(point.cosOuter);
    expect(packed.data[14]).toBe(4);
    expect(packed.data[15]).toBeCloseTo(0.65, 6);
  });

  it('zeros the key fields in inactive slots (no residue after a smaller pack)', () => {
    const key: DeferredLight = { ...point, fleshKeyIntensity: 4, fleshShoulderKnee: 0.65 };
    const packed = packDeferredLights([key]);
    expect(packed.data[14 + DEFERRED_LIGHT_STRIDE_FLOATS]).toBe(0);
    expect(packed.data[15 + DEFERRED_LIGHT_STRIDE_FLOATS]).toBe(0);
  });

  it('rejects a negative key intensity', () => {
    expect(() => packDeferredLights([{ ...point, fleshKeyIntensity: -1 }])).toThrow(/fleshKeyIntensity/);
  });

  it('packs a PRESENT ZERO key as the sentinel, never as absent 0 (composition review fix)', () => {
    // The game's beam-gain panel is legal at 0 ("remove the beam"); that
    // state must survive the packing as FLESH_KEY_PRESENT_ZERO so the WGSL
    // takes the march path (contribution exactly 0) instead of falling back
    // to the packed physical intensity.
    const packed = packDeferredLights([{ ...point, fleshKeyIntensity: 0 }]);
    expect(packed.data[14]).toBe(FLESH_KEY_PRESENT_ZERO);
    // Absent stays 0 — the M1 fixture shape.
    const absent = packDeferredLights([point]);
    expect(absent.data[14]).toBe(0);
    // Presence is the API field being defined; knee comes along unchanged.
    const keyed = packDeferredLights([{ ...point, fleshKeyIntensity: 0, fleshShoulderKnee: 0.65 }]);
    expect(keyed.data[14]).toBe(FLESH_KEY_PRESENT_ZERO);
    expect(keyed.data[15]).toBeCloseTo(0.65, 6);
  });

  it('rejects a nonfinite or over-range shoulder knee; every legal panel value packs', () => {
    expect(() => packDeferredLights([{ ...point, fleshShoulderKnee: Number.NaN }])).toThrow(/fleshShoulderKnee/);
    expect(() => packDeferredLights([{ ...point, fleshShoulderKnee: 1 }])).toThrow(/fleshShoulderKnee/);
    expect(() => packDeferredLights([{ ...point, fleshShoulderKnee: 1.01 }])).toThrow(/fleshShoulderKnee/);
    // The march clamp range is [0.05, 0.99]: shoulder 0 -> knee 0 (off),
    // shoulder 0.05 -> knee 0.95, shoulder 0.01 -> knee 0.99. All legal —
    // the old `< 0.95` bound threw on legal panel values every frame.
    expect(() => packDeferredLights([{ ...point, fleshShoulderKnee: 0 }])).not.toThrow();
    expect(() => packDeferredLights([{ ...point, fleshShoulderKnee: 0.95 }])).not.toThrow();
    const packed = packDeferredLights([{ ...point, fleshShoulderKnee: 0.99 }]);
    expect(packed.data[15]).toBeCloseTo(0.99, 6);
  });
});
