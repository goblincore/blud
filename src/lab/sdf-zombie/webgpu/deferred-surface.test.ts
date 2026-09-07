import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  selectSurface,
  sdfTargetSize,
  createSurfaceTarget,
  getSurfaceTextures,
  SURFACE_ATTACHMENT_NAMES,
  SURFACE_COLOR_BYTES_PER_SAMPLE,
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
  it('creates the four named attachments in spec order with spec formats', () => {
    const target = createSurfaceTarget(64, 32);
    try {
      expect(target.textures).toHaveLength(4);
      expect(target.textures.map((t) => t.name)).toEqual([...SURFACE_ATTACHMENT_NAMES]);

      const tex = getSurfaceTextures(target);
      for (const name of ['albedoRoughness', 'normalMetalness', 'emissionClass'] as const) {
        expect(tex[name].format).toBe(THREE.RGBAFormat);
        expect(tex[name].type).toBe(THREE.HalfFloatType);
      }
      expect(tex.surfaceDepth.format).toBe(THREE.RedFormat);
      expect(tex.surfaceDepth.type).toBe(THREE.FloatType);

      for (const t of target.textures) {
        expect(t.minFilter).toBe(THREE.NearestFilter);
        expect(t.magFilter).toBe(THREE.NearestFilter);
        expect(t.colorSpace).toBe(THREE.NoColorSpace);
        expect(t.generateMipmaps).toBe(false);
      }

      // Hardware depth for the geometry producers, and the whole budget must
      // stay inside the 32-byte default maxColorAttachmentBytesPerSample.
      expect(target.depthBuffer).toBe(true);
      expect(SURFACE_COLOR_BYTES_PER_SAMPLE).toBeLessThanOrEqual(32);
      expect(SURFACE_COLOR_BYTES_PER_SAMPLE).toBe(3 * 8 + 4);
    } finally {
      target.dispose();
    }
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
