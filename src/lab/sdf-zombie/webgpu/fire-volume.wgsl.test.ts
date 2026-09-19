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
  it('erodes the shape into tongues (round 2b)', () => {
    // A noise fbm sampled in flame space, MULTIPLICATIVELY subtracted from the
    // capsule shape with a height-growing amount, then contrast-stretched.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('fireFbm(fq)');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let erodeAmt = erode * smoothstep(0.0, rise * erodeRise, hErode);');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let density = saturate(shape * saturate(1.0 - erosion * erodeAmt) * edgeSharp);');
    // The fbm is normalised so the erosion can actually reach the core value.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('return v * 1.142857;');
    // Temperature for the ramp is the eroded density, cooled with height.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let temp = density * cool;');
  });
  it('scrolls the flame noise down so features rise with the flame', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('fq.y = fq.y - cfg2.z * rise * freq * stretch;');
  });
  it('scatters lit smoke instead of only darkening (round 2b)', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let inscatter = soot * smokeGain * smokeAlbedo');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('smokeAmbient * ambientCol');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('smokeFireLit * glow * fireLitCol');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('emission = emission + T * inscatter * stepM;');
    // sootGain 0 must be a true smoke-off switch (the look metric's twin).
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let smokeGain = clamp(cfg2.x, 0.0, 1.0);');
    // The column widens with height, and smoke is advected harder than flame.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('dS = fireSdCapsule(p + cv * 1.7 - lag, a, b) - radius;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('spread * max(h - 0.4 * rise, 0.0)');
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
  it('returns (emission, transmittance) for the blend and never reads the scene', () => {
    expect(/^fn\s+fireVolumeComposite\s*\(/.test(FIRE_VOLUME_COMPOSITE_WGSL)).toBe(true);
    // The blend factors (One, SrcAlpha) turn this into scene * T + emission in
    // the capture target, so the pass must not sample the target it writes.
    expect(FIRE_VOLUME_COMPOSITE_WGSL).toContain('return vec4<f32>(fire.rgb, fire.a);');
    expect(FIRE_VOLUME_COMPOSITE_WGSL).not.toContain('sceneTex');
  });
});
