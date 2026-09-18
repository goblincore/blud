import { describe, it, expect } from 'vitest';
import {
  FIRE_VOLUME_MARCH_WGSL, FIRE_VOLUME_RESOLVE_WGSL, FIRE_VOLUME_COMPOSITE_WGSL,
} from './fire-volume.wgsl';

// The same text guards the sibling WGSL tests apply: the wgslFn ^-anchored
// parse contract, the specific traps the plan names, and the lag mirror.

describe('fire volume march WGSL', () => {
  it('starts with its main fn (three anchors the parse to ^)', () => {
    expect(/^fn\s+fireVolumeMarch\s*\(/.test(FIRE_VOLUME_MARCH_WGSL)).toBe(true);
  });
  it('samples the SCENE depth texture, never the fragment depth', () => {
    // The soft-fade trap: the pass must cap at the capture's depth texture.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('depthTex: texture_depth_2d');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('textureLoad(depthTex, pix, 0)');
    expect(FIRE_VOLUME_MARCH_WGSL).not.toContain('depth()');
  });
  it('carries the lag formula and clamps it to lagMaxM', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('lag * h');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('lagMaxM');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('len > lagMaxM');
  });
  it('early-outs when steps == 0 (the pipeline-free off switch)', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('if (steps <= 0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }');
  });
  it('uses curl from the shared volume accessor contract', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('curlTex: texture_3d<f32>');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('fireCurl(curlTex, curlSamp, curlUvw)');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('textureSampleLevel(tex, samp, uvw, 0.0)');
  });
  it('declares the packed capsule stride the packer writes', () => {
    // a.xyz | radius | b.xyz | burn | vel.xyz | pad in vec4 chunks.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let a = rec0.xyz;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let radius = rec0.w;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let b = rec1.xyz;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let burn = rec1.w;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('fireLag(rec2.xyz');
  });
  it('returns transmittance in alpha (never alphaHash/alphaTest — no such tokens)', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('return vec4<f32>(emission, T);');
    expect(FIRE_VOLUME_MARCH_WGSL).not.toContain('alphaHash');
    expect(FIRE_VOLUME_MARCH_WGSL).not.toContain('alphaTest');
  });
});

describe('fire volume resolve WGSL', () => {
  it('starts with its main fn', () => {
    expect(/^fn\s+fireVolumeResolve\s*\(/.test(FIRE_VOLUME_RESOLVE_WGSL)).toBe(true);
  });
  it('reprojects through the previous view-projection and clamps the history', () => {
    expect(FIRE_VOLUME_RESOLVE_WGSL).toContain('prevViewProj * vec4<f32>(world, 1.0)');
    expect(FIRE_VOLUME_RESOLVE_WGSL).toContain('clamp(hist, mn, mx)');
    expect(FIRE_VOLUME_RESOLVE_WGSL).toContain('if (cfg.y > 0.5) { return cur; }');
  });
});

describe('fire volume composite WGSL', () => {
  it('starts with its main fn and is scene * T + emission', () => {
    expect(/^fn\s+fireVolumeComposite\s*\(/.test(FIRE_VOLUME_COMPOSITE_WGSL)).toBe(true);
    expect(FIRE_VOLUME_COMPOSITE_WGSL).toContain('scene * fire.a + fire.rgb');
  });
});
