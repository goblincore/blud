// src/lab/sdf-zombie/webgpu/post-vhs.wgsl.test.ts
//
// The wgslFn parse contract for POST_VHS_WGSL. Nothing in this repo compiles a
// shader, so the only automatic guard against a signature slip is three's own
// parser: `WGSLNodeFunction` is what turns the source into inputs, and a
// reordered or renamed parameter silently hands the shader the wrong uniform
// at the call site (the positional-binding trap march.wgsl.test.ts documents).
//
// The CPU-side preset/helper tests live in post-vhs.test.ts; this file exists
// only so the parse itself fails loudly.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (see march.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { POST_VHS_WGSL } from './post-vhs';

describe('postVhs WGSL parse contract', () => {
  it('parses with three\'s WGSLNodeFunction', () => {
    expect(() => new WGSLNodeFunction(POST_VHS_WGSL)).not.toThrow();
  });

  it('declares the ordered parameter list the chain binds positionally', () => {
    const parsed = new WGSLNodeFunction(POST_VHS_WGSL);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    // 2 textures + sampler + uv + time + hasPrev + isDisplay + 13 terms = 20.
    expect(names.length).toBe(20);
    expect(names).toEqual([
      'tex', 'samp', 'prevTex', 'uv', 'time', 'hasPrev', 'isDisplay',
      'intensity', 'blurAmount', 'noiseAmount', 'gradeAmount',
      'warpAmount', 'warpFrequency', 'warpSpeed',
      'chromaAmount', 'chromaJitter', 'motionThreshold',
      'chromaBurstChance', 'chromaBurstStrength', 'chromaBurstRate',
    ]);
  });
});
