// src/lab/sdf-zombie/webgpu/post-sscs.wgsl.test.ts
//
// The wgslFn parse contract for POST_SSCS_WGSL — the same guard
// post-vhs.wgsl.test.ts pins: nothing in this repo compiles a shader, so the
// only automatic guard against a signature slip is three's own parser
// (WGSLNodeFunction). A reordered or renamed parameter silently hands the
// shader the wrong uniform at the call site (the positional-binding trap
// march.wgsl.test.ts documents), so the ordered list is pinned exactly.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (see march.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { POST_SSCS_WGSL, SSCS_DEFAULTS, SSCS_TERM_RANGES, SSCS_STEPS } from './post-sscs';

describe('postSscs WGSL parse contract', () => {
  it('parses with three\'s WGSLNodeFunction', () => {
    expect(() => new WGSLNodeFunction(POST_SSCS_WGSL)).not.toThrow();
  });

  it('declares the ordered parameter list the chain binds positionally', () => {
    const parsed = new WGSLNodeFunction(POST_SSCS_WGSL);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    expect(names).toEqual([
      'tex', 'depthTex', 'fleshTex', 'uv', 'vp', 'invVp', 'light', 'cfg',
    ]);
  });

  it('interpolates the shared step count into the loop bounds', () => {
    // SSCS_STEPS is the one constant the WGSL string inlines from TS; a
    // change must reach the shader or the tap count silently disagrees
    // with the header comment that documents it.
    expect(POST_SSCS_WGSL).toContain(`i <= ${SSCS_STEPS}`);
    expect(POST_SSCS_WGSL).toContain(`/ ${SSCS_STEPS}.0`);
  });

  it('keeps textureLoad-only taps (no sampler binding exists)', () => {
    // The capture target is NearestFilter, and three emits no sampler for a
    // nearest target — a textureSample anywhere in this shader would fail to
    // bind at pipeline build, on a GPU only.
    expect(POST_SSCS_WGSL).not.toContain('textureSample');
    expect(POST_SSCS_WGSL).toContain('textureLoad');
  });
});

describe('SSCS defaults and ranges', () => {
  // The shipped look, pinned like VHS_PRESETS: silent drift changes the
  // frame with no error.
  it('ships the documented defaults', () => {
    expect(SSCS_DEFAULTS).toEqual({ strength: 0.35, maxDist: 0.8, bias: 0.02 });
    expect(SSCS_TERM_RANGES.strength[0]).toBe(0);
    expect(SSCS_TERM_RANGES.maxDist[1]).toBeGreaterThan(SSCS_DEFAULTS.maxDist);
    expect(SSCS_TERM_RANGES.bias[1]).toBeGreaterThan(SSCS_DEFAULTS.bias);
  });
});
