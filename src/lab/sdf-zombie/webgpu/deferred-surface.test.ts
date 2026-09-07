import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  selectSurface,
  sdfTargetSize,
  createSurfaceTarget,
  getSurfaceTextures,
  SURFACE_ATTACHMENT_NAMES,
  SURFACE_COLOR_BYTES_PER_SAMPLE,
  encodeSurfaceClass,
  decodeSurfaceClass,
  SURFACE_CLASS_EMPTY,
  SURFACE_CLASS_MESH,
  SURFACE_CLASS_FLESH,
  SURFACE_CLASS_FLAT,
  packSurfaceParams,
  unpackSurfaceParams,
  SURFACE_PARAM_SPEC_MAX,
  SURFACE_PARAM_FRESNEL_MAX,
} from './deferred-surface';

describe('selectSurface (CPU reference for the resolve rule)', () => {
  it('matches the semantic resolve rule, including ties favouring mesh', () => {
    expect(selectSurface(1, 1)).toBe('empty');
    expect(selectSurface(0.2, 0.8)).toBe('mesh');
    expect(selectSurface(0.8, 0.2)).toBe('sdf');
    expect(selectSurface(0.4, 0.4)).toBe('mesh');
  });

  it('treats depth 1 as a miss on either side independently', () => {
    expect(selectSurface(1, 0.5)).toBe('sdf');
    expect(selectSurface(0.5, 1)).toBe('mesh');
    expect(selectSurface(1, 0.999)).toBe('sdf');
  });

  it('a hit at clip depth 0 is still a hit', () => {
    expect(selectSurface(0, 1)).toBe('mesh');
    expect(selectSurface(1, 0)).toBe('sdf');
  });

  it('rejects nonfinite and out-of-range clip depths', () => {
    expect(() => selectSurface(Number.NaN, 0.5)).toThrow();
    expect(() => selectSurface(0.5, Number.POSITIVE_INFINITY)).toThrow();
    expect(() => selectSurface(-0.1, 0.5)).toThrow();
    expect(() => selectSurface(0.5, 1.1)).toThrow();
  });
});

describe('sdfTargetSize', () => {
  it('scales linearly and rounds', () => {
    expect(sdfTargetSize(960, 540, 0.5)).toEqual({ width: 480, height: 270 });
    expect(sdfTargetSize(960, 540, 1)).toEqual({ width: 960, height: 540 });
    expect(sdfTargetSize(961, 541, 0.5)).toEqual({ width: 481, height: 271 });
  });

  it('clamps fractional positive results to >= 1', () => {
    expect(sdfTargetSize(4, 4, 0.1)).toEqual({ width: 1, height: 1 });
    expect(sdfTargetSize(1, 1, 0.5)).toEqual({ width: 1, height: 1 });
  });

  it('rejects nonpositive scale and nonfinite inputs', () => {
    expect(() => sdfTargetSize(960, 540, 0)).toThrow();
    expect(() => sdfTargetSize(960, 540, -0.5)).toThrow();
    expect(() => sdfTargetSize(960, 540, Number.NaN)).toThrow();
    expect(() => sdfTargetSize(0, 540, 0.5)).toThrow();
    expect(() => sdfTargetSize(960, Number.POSITIVE_INFINITY, 0.5)).toThrow();
  });
});

describe('createSurfaceTarget', () => {
  it('creates the five named attachments in spec order with spec formats', () => {
    const target = createSurfaceTarget(64, 32);
    try {
      expect(target.textures).toHaveLength(5);
      expect(target.textures.map((t) => t.name)).toEqual([...SURFACE_ATTACHMENT_NAMES]);

      const tex = getSurfaceTextures(target);
      for (const name of ['albedoRoughness', 'normalMetalness', 'emissionClass'] as const) {
        expect(tex[name].format).toBe(THREE.RGBAFormat);
        expect(tex[name].type).toBe(THREE.HalfFloatType);
      }
      expect(tex.surfaceDepth.format).toBe(THREE.RedFormat);
      expect(tex.surfaceDepth.type).toBe(THREE.FloatType);
      expect(tex.surfaceParams.format).toBe(THREE.RedFormat);
      expect(tex.surfaceParams.type).toBe(THREE.FloatType);

      for (const t of target.textures) {
        expect(t.minFilter).toBe(THREE.NearestFilter);
        expect(t.magFilter).toBe(THREE.NearestFilter);
        expect(t.colorSpace).toBe(THREE.NoColorSpace);
        expect(t.generateMipmaps).toBe(false);
      }

      // Hardware depth for the geometry producers, and the whole budget must
      // stay inside the 32-byte default maxColorAttachmentBytesPerSample —
      // the M2 task 7 surfaceParams attachment consumes the last 4 bytes.
      expect(target.depthBuffer).toBe(true);
      expect(SURFACE_COLOR_BYTES_PER_SAMPLE).toBeLessThanOrEqual(32);
      expect(SURFACE_COLOR_BYTES_PER_SAMPLE).toBe(3 * 8 + 4 + 4);
    } finally {
      target.dispose();
    }
  });

  it('pins the literal attachment order the G-buffer consumers rely on', () => {
    // NOT [...SURFACE_ATTACHMENT_NAMES] on purpose: fixtures and the resolve
    // pass reason about POSITIONS (0=albedo … 3=depth) and the task-3 GPU
    // gate read by name. A reorder here must fail loudly, not silently
    // re-bind which attachment carries the class vs the depth.
    expect([...SURFACE_ATTACHMENT_NAMES]).toEqual([
      'albedoRoughness', 'normalMetalness', 'emissionClass', 'surfaceDepth', 'surfaceParams',
    ]);
  });

  it('clamps fractional positive dimensions to >= 1 texel', () => {
    const target = createSurfaceTarget(0.4, 2.6);
    try {
      expect(target.width).toBe(1);
      expect(target.height).toBe(3);
    } finally {
      target.dispose();
    }
  });

  it('rejects nonfinite and nonpositive sizes', () => {
    expect(() => createSurfaceTarget(0, 10)).toThrow();
    expect(() => createSurfaceTarget(10, -1)).toThrow();
    expect(() => createSurfaceTarget(Number.NaN, 10)).toThrow();
    expect(() => createSurfaceTarget(10, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('resizes reallocate rather than mutating a DataTexture', () => {
    const target = createSurfaceTarget(8, 8);
    try {
      target.setSize(16, 4);
      expect(target.width).toBe(16);
      expect(target.height).toBe(4);
    } finally {
      target.dispose();
    }
  });
});

describe('surface-class receiver metadata (hybrid deferred M2 task 1)', () => {
  // The contract: low four bits retain classes 0..3, bit 4 selects the
  // level-only shadow receiver, full has no bit, and EMPTY stays exactly zero
  // (the clear sentinel must never grow a receiver bit).
  it('encodes the plan examples exactly', () => {
    expect(encodeSurfaceClass(1, 'level-only')).toBe(17);
    expect(encodeSurfaceClass(2, 'full')).toBe(2);
    expect(encodeSurfaceClass(0, 'level-only')).toBe(0);
  });

  it('decodes the plan examples exactly', () => {
    expect(decodeSurfaceClass(18)).toEqual({ baseClass: 2, receiver: 'level-only' });
    expect(decodeSurfaceClass(17)).toEqual({ baseClass: 1, receiver: 'level-only' });
    expect(decodeSurfaceClass(3)).toEqual({ baseClass: 3, receiver: 'full' });
    expect(decodeSurfaceClass(0)).toEqual({ baseClass: 0, receiver: 'full' });
  });

  it('full receiver is the identity on every existing class', () => {
    for (const cls of [SURFACE_CLASS_EMPTY, SURFACE_CLASS_MESH, SURFACE_CLASS_FLESH, SURFACE_CLASS_FLAT]) {
      expect(encodeSurfaceClass(cls, 'full')).toBe(cls);
      // So the M1 producers (which write the bare constants) are already
      // valid full-receiver encodings without any producer change.
      expect(decodeSurfaceClass(cls)).toEqual({ baseClass: cls, receiver: 'full' });
    }
  });

  it('round-trips every base class through both receivers', () => {
    // Base 0 is exempt BY CONTRACT (empty stays exactly zero, tested above).
    for (let base = 1; base <= 15; base++) {
      for (const receiver of ['full', 'level-only'] as const) {
        const encoded = encodeSurfaceClass(base, receiver);
        expect(decodeSurfaceClass(encoded)).toEqual({ baseClass: base, receiver });
      }
    }
  });

  it('level-only sets exactly bit 4 and leaves the low bits untouched', () => {
    for (let base = 1; base <= 15; base++) {
      expect(encodeSurfaceClass(base, 'level-only') & 0b1111).toBe(base);
      expect(encodeSurfaceClass(base, 'level-only') & 0b10000).toBe(0b10000);
      expect(encodeSurfaceClass(base, 'level-only') - encodeSurfaceClass(base, 'full')).toBe(16);
    }
  });

  it('rejects invalid base classes rather than corrupting packed metadata', () => {
    expect(() => encodeSurfaceClass(1.5, 'full')).toThrow(/integer/);
    expect(() => encodeSurfaceClass(-1, 'level-only')).toThrow();
    expect(() => encodeSurfaceClass(16, 'full')).toThrow();
    expect(() => encodeSurfaceClass(Number.NaN, 'full')).toThrow();
    expect(() => encodeSurfaceClass(Number.POSITIVE_INFINITY, 'full')).toThrow();
  });

  it('rejects unknown receivers', () => {
    expect(() => encodeSurfaceClass(1, 'sometimes' as never)).toThrow(/receiver/);
  });

  it('decode rejects values that cannot have been produced by encode', () => {
    expect(() => decodeSurfaceClass(-1)).toThrow();
    expect(() => decodeSurfaceClass(32)).toThrow();
    expect(() => decodeSurfaceClass(2.5)).toThrow();
    expect(() => decodeSurfaceClass(Number.NaN)).toThrow();
  });
});

describe('getSurfaceTextures', () => {
  it('looks attachments up by name, never by incidental ordering', () => {
    const target = createSurfaceTarget(4, 4);
    try {
      // Scramble array order: name lookup must still find each attachment.
      target.textures.reverse();
      const tex = getSurfaceTextures(target);
      expect(tex.albedoRoughness.name).toBe('albedoRoughness');
      expect(tex.normalMetalness.name).toBe('normalMetalness');
      expect(tex.emissionClass.name).toBe('emissionClass');
      expect(tex.surfaceDepth.name).toBe('surfaceDepth');
    } finally {
      target.dispose();
    }
  });

  it('throws when an attachment is missing rather than guessing an index', () => {
    const target = createSurfaceTarget(4, 4);
    try {
      target.textures[0]!.name = 'renamed';
      expect(() => getSurfaceTextures(target)).toThrow();
    } finally {
      target.dispose();
    }
  });
});

describe('surfaceParams packing (M2 task 7 material-parity repair)', () => {
  it('round-trips the authored response lanes at 8-bit precision', () => {
    // The zombie's authored cruise: spec 0.95, fresnel 0.85, mid AO.
    const packed = packSurfaceParams(0.95, 0.85, 0.72);
    const out = unpackSurfaceParams(packed);
    expect(Math.abs(out.specIntensity - 0.95)).toBeLessThanOrEqual(SURFACE_PARAM_SPEC_MAX / 255);
    expect(Math.abs(out.fresnelBoost - 0.85)).toBeLessThanOrEqual(SURFACE_PARAM_FRESNEL_MAX / 255);
    expect(Math.abs(out.ao - 0.72)).toBeLessThanOrEqual(1 / 255);
  });

  it('stays inside the exact-float32 integer range for every lane', () => {
    const worst = packSurfaceParams(SURFACE_PARAM_SPEC_MAX, SURFACE_PARAM_FRESNEL_MAX, 1);
    expect(worst).toBeLessThanOrEqual(16777215);
    expect(worst).toBe(255 * 65536 + 255 * 256 + 255);
    const out = unpackSurfaceParams(worst);
    expect(out.specIntensity).toBeCloseTo(SURFACE_PARAM_SPEC_MAX, 5);
    expect(out.fresnelBoost).toBeCloseTo(SURFACE_PARAM_FRESNEL_MAX, 5);
    expect(out.ao).toBeCloseTo(1, 5);
  });

  it('keeps upper-lane saturation decodable (no mixed-radix spill)', () => {
    // p8 = 255 with maximal lower lanes: floor(v / 65536) must stay 255.
    const v = packSurfaceParams(SURFACE_PARAM_SPEC_MAX, SURFACE_PARAM_FRESNEL_MAX, 1);
    expect(Math.floor(v / 65536)).toBe(255);
    const out = unpackSurfaceParams(v);
    expect(out.ao).toBeCloseTo(1, 5);
  });

  it('clamps out-of-range lanes and maps zero to the absent sentinel', () => {
    expect(packSurfaceParams(-1, 999, 0.5)).toBe(packSurfaceParams(0, SURFACE_PARAM_FRESNEL_MAX, 0.5));
    expect(packSurfaceParams(0, 0, 0)).toBe(0);
    expect(unpackSurfaceParams(0)).toEqual({ specIntensity: 0, fresnelBoost: 0, ao: 0 });
  });

  it('rejects values that cannot be a packed lane product', () => {
    expect(() => unpackSurfaceParams(-1)).toThrow(RangeError);
    expect(() => unpackSurfaceParams(16777216)).toThrow(RangeError);
    expect(() => unpackSurfaceParams(Number.NaN)).toThrow(RangeError);
  });

  it('mirrors the WGSL decode constants in the surface tail and light pass', () => {
    // The WGSL duplicates the 3x8 arithmetic because wgslFn takes one fn per
    // string (the bone-tubes lesson). These pins keep the two in lockstep —
    // a constant changed on one side must fail here.
    expect(SURFACE_PARAM_SPEC_MAX).toBe(3.5);
    expect(SURFACE_PARAM_FRESNEL_MAX).toBe(5.0);
  });
});
