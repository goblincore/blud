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
  it('sweeps every limb upward into a tapering flame sheet (hands-on redesign)', () => {
    // The limb point under the sample, the height above it clamped to the
    // sheet length, and the sample pulled back DOWN by it before the capsule
    // distance: flame clings to vertical limbs and streams up off the rest.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let under = a + ab * k;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let sH = clamp(sRaw, 0.0, riseC);');
    // Per-capsule sheet length from the pack's pad slot (headRise on the head).
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let riseFull = max(rise * abs(rec2.w), 1e-3);');
    // Head clearing: every limb's flame thins within ~15 cm of a head capsule.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('shape = shape * mix(headClear, 1.0, smoothstep(0.0, 0.15, dHead));');
    // Over the head column every sheet is SHORTENED to end at headTop + headRise*rise
    // (a taper, not a flat cut).
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let riseHead = clamp(headCeil - under.y, 0.05, riseFull);');
    expect(FIRE_VOLUME_MARCH_WGSL).not.toContain('let over = qw.y');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let q2 = qw - lag - vec3<f32>(0.0, sH, 0.0);');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('radius * (1.0 - 0.55 * u)');
  });
  it('erodes the sheet into crisp tongues with a full-contrast noise', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('erosion = smoothstep(0.3, 0.7, fireFbm(fq));');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let density = saturate((shape - erosion * erodeAmt) * edgeSharp);');
    // Rotated octaves: stretched value noise otherwise stripes along its lattice.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('q = (m * q) * 2.03;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('return v * 1.142857;');
  });
  it('emits and absorbs with ONE coefficient, so thick flame cannot blow out to white', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let alphaF = 1.0 - exp(-density * FIRE_FLAME_SIGMA * densityK * dtFine);');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('* mix(skin, 1.0, smoothstep(0.0, 0.3, u));');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('emission = emission + T * fireRamp(temp) * alphaF * cfg1.w;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('T = T * (1.0 - alphaF);');
  });
  it('scrolls the flame noise down so features rise with the flame', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('fq.y = fq.y - cfg2.z * FIRE_FLAME_SPEED * freq * stretch;');
  });
  it('has no smoke (owner call 2026-09-19: smoke comes from a cheaper effect)', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).not.toContain('fireSoot');
    expect(FIRE_VOLUME_MARCH_WGSL).not.toContain('inscatter');
  });
  it('culls capsules per ray and marches only the union of their intervals', () => {
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('var hitIdx: array<i32, FIRE_RAY_CAPS>;');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let fi = fireRaySphere(origin, rayDir, fc, fR, tNear, tFar);');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('if (hitN == 0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }');
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let stepM = (tMax - tMin) / f32(steps);');
    // Overflow falls back to the full list, so a crowded ray is slower, never wrong.
    expect(FIRE_VOLUME_MARCH_WGSL).toContain('let flameN = select(hitN, capsuleCount, flameAll);');
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
