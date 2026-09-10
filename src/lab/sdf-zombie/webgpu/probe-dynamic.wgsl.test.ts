// src/lab/sdf-zombie/webgpu/probe-dynamic.wgsl.test.ts
//
// Unit pins for the DYNAMIC probe WGSL. Nothing here compiles WGSL; the real
// gate is the in-browser gather against the CPU twin. These tests pin the
// load-bearing source shape: the ^fn parse contract, the count guard, the
// shared literals, and the no-field/no-texture constraint.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (same pattern as
// probe-grid.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { K_PROBE_GATHER, PROBE_DYNAMIC_WGSL } from './probe-dynamic.wgsl';
import { DYN_RAY_CAP, GOLDEN_ANGLE, TWO_PI } from '../probe-dynamic';
import { SH_A0, SH_A1, SH_Y00, SH_Y1 } from '../probe-grid';

describe('PROBE_DYNAMIC_WGSL — parse and shape contract', () => {
  it('starts with fn probeDynamic, per the wgslFn parse contract', () => {
    expect(PROBE_DYNAMIC_WGSL.startsWith('fn probeDynamic(')).toBe(true);
  });

  it('the real wgslFn parser sees exactly the six declared inputs, in order', () => {
    // WGSLNodeFunction sweeps the parameter list with /name\s*:\s*type/, so a
    // `word: word` inside a signature comment would become a PHANTOM input and
    // shift every real binding. Running the actual parser (not a grep) is the
    // only check that catches that.
    const parsed = new WGSLNodeFunction(PROBE_DYNAMIC_WGSL);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    expect(names).toEqual(['p', 'n', 'probeDyn', 'probeMin', 'probeInvExtent', 'probeDims']);
    expect(parsed.inputs.length).toBe(6);
  });

  it('declares the 4-vec4 loader and the two evaluators', () => {
    expect(PROBE_DYNAMIC_WGSL).toContain('fn probeDynLoad(');
    expect(PROBE_DYNAMIC_WGSL).toContain('fn probeDynIrradianceL1(');
    expect(PROBE_DYNAMIC_WGSL).toContain('fn probeDynVisibility(');
  });

  it('loads four storage vec4s per probe, x fastest at index*4 + c', () => {
    for (let c = 0; c < 4; c++) {
      expect(PROBE_DYNAMIC_WGSL).toContain(`(*probeDyn)[base + ${c}u]`);
    }
    expect(PROBE_DYNAMIC_WGSL).toContain('u32(index) * 4u');
  });

  it('manual-trilinears the 8 surrounding probes before evaluating', () => {
    const loads = PROBE_DYNAMIC_WGSL.match(/probeDynLoad\(probeDyn, idx/g) ?? [];
    expect(loads.length).toBe(8);
  });

  it('returns radiance and visibility in one vec4', () => {
    expect(PROBE_DYNAMIC_WGSL).toContain('return vec4<f32>(r, vis);');
  });

  it('clamps visibility to [0, 1] and radiance non-negative', () => {
    expect(PROBE_DYNAMIC_WGSL).toContain('clamp(max(e, 0.0)');
    expect(PROBE_DYNAMIC_WGSL).toContain('max(e, vec3<f32>(0.0, 0.0, 0.0))');
  });

  it('shares every SH constant literal with the CPU mirror', () => {
    expect(PROBE_DYNAMIC_WGSL).toContain(`${SH_Y00}`);
    expect(PROBE_DYNAMIC_WGSL).toContain(`${SH_Y1}`);
    expect(PROBE_DYNAMIC_WGSL).toContain(`${SH_A0}`);
    expect(PROBE_DYNAMIC_WGSL).toContain(`${SH_A1}`);
  });
});

describe('K_PROBE_GATHER — parse and shape contract', () => {
  it('starts with fn kProbeGather, per the wgslFn parse contract', () => {
    expect(K_PROBE_GATHER.startsWith('fn kProbeGather(')).toBe(true);
  });

  it('declares the exact nine-input signature Task 2 binds', () => {
    const compact = K_PROBE_GATHER.replace(/\s+/g, ' ');
    expect(compact).toContain(
      'fn kProbeGather( boxes: ptr<storage, array<vec4<f32>>, read>, '
      + 'capsules: ptr<storage, array<vec4<f32>>, read>, '
      + 'lights: ptr<storage, array<vec4<f32>>, read>, '
      + 'probeDyn: ptr<storage, array<vec4<f32>>, read_write>, '
      + 'cfg: vec4<f32>, gridMin: vec4<f32>, gridInvExtent: vec4<f32>, '
      + 'gridDims: vec4<f32>, gi: u32 ) -> void',
    );
    // The real parser is the authority: a stray `word: word` in a comment
    // would become a phantom input and shift every binding.
    const parsed = new WGSLNodeFunction(K_PROBE_GATHER);
    expect(parsed.inputs.map((i: { name: string }) => i.name)).toEqual([
      'boxes', 'capsules', 'lights', 'probeDyn',
      'cfg', 'gridMin', 'gridInvExtent', 'gridDims', 'gi',
    ]);
    expect(parsed.inputs.length).toBe(9);
  });

  it('the first statement is the probe-count guard', () => {
    const body = K_PROBE_GATHER.slice(K_PROBE_GATHER.indexOf(') -> void {') + ') -> void {'.length);
    expect(body.trimStart().startsWith('if (gi >= u32(cfg.x)) { return; }')).toBe(true);
  });

  it('caps rays per probe at 64', () => {
    expect(K_PROBE_GATHER).toContain(`min(u32(cfg.y), ${DYN_RAY_CAP}u)`);
  });

  it('reads the element counts from element 0 of every storage buffer', () => {
    expect(K_PROBE_GATHER).toContain('u32((*boxes)[0].x)');
    expect(K_PROBE_GATHER).toContain('u32((*capsules)[0].x)');
    expect(K_PROBE_GATHER).toContain('u32((*lights)[0].x)');
  });

  it('declares the four named helpers', () => {
    expect(K_PROBE_GATHER).toContain('fn kdFibonacci(');
    expect(K_PROBE_GATHER).toContain('fn kdHitBox(');
    expect(K_PROBE_GATHER).toContain('fn kdHitCapsule(');
    expect(K_PROBE_GATHER).toContain('fn kdShadowed(');
  });

  it('blends the new estimate with the previous frame by cfg.w', () => {
    expect(K_PROBE_GATHER).toContain('mix(');
    expect(K_PROBE_GATHER).toContain('cfg.w');
  });

  it('shares the Fibonacci literals with the CPU mirror', () => {
    expect(K_PROBE_GATHER).toContain(`${GOLDEN_ANGLE}`);
    expect(K_PROBE_GATHER).toContain(`${TWO_PI}`);
  });

  it('shares the projection SH constants with the CPU mirror', () => {
    // The kernel projects only (L00, L1-1, L10, L11); the cosine convolution's
    // A1 lives in the evaluator below.
    expect(K_PROBE_GATHER).toContain(`${SH_Y00}`);
    expect(K_PROBE_GATHER).toContain(`${SH_Y1}`);
    expect(K_PROBE_GATHER).toContain(`${SH_A0}`);
  });
});

describe('probe-dynamic WGSL — the hard perf constraint', () => {
  it('evaluates the SDF field ZERO times and never touches a texture', () => {
    for (const src of [K_PROBE_GATHER, PROBE_DYNAMIC_WGSL]) {
      expect(src).not.toContain('mapBody');
      expect(src).not.toContain('sdPrim');
      expect(src).not.toContain('textureLoad');
      expect(src).not.toContain('textureSample');
    }
  });
});

describe('K_PROBE_GATHER buffer indexing (vec4 units, count at element 0)', () => {
  // The buffers are arrays of vec4; the packers write the count at float 0
  // and the first record at float 4, i.e. vec4 index 1. Indexing the lights
  // at 4u + 2l read two slots past the only light and every flash produced
  // zero radiance on the GPU (owner-observed 2026-09-09) while the CPU twin,
  // which indexes floats, was correct.
  it('reads light l at vec4 index 1 + 3l, box b at 1 + 3b, capsule c at 1 + 2c', () => {
    expect(K_PROBE_GATHER).toContain('let lb = 1u + l * 3u;');
    expect(K_PROBE_GATHER).toContain('let cosOuter = (*lights)[lb + 1u].w;');
    expect(K_PROBE_GATHER).toContain('let bb = 1u + b * 3u;');
    expect(K_PROBE_GATHER).toContain('let cb = 1u + c * 2u;');
    expect(K_PROBE_GATHER).not.toMatch(/= 4u \+ [lbc] \* [23]u;/);
  });
});

describe('K_PROBE_GATHER afterglow', () => {
  it('radiance rises at cfg.w and falls at gridMin.w; visibility keeps cfg.w', () => {
    expect(K_PROBE_GATHER).toContain('let rate = select(gridMin.w, cfg.w, lumNew > lumPrev);');
    expect(K_PROBE_GATHER).toContain('(*probeDyn)[base + 3u] = mix((*probeDyn)[base + 3u], new3, cfg.w);');
  });
});
