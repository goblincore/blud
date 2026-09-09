import { describe, it, expect } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (same pattern as
// march.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { PROBE_GRID_WGSL } from './probe-grid.wgsl';
import { SH_A0, SH_A1, SH_Y00, SH_Y1 } from '../probe-grid';

describe('PROBE_GRID_WGSL \u2014 the hard perf constraint', () => {
  it('evaluates the SDF field ZERO times', () => {
    // The whole point of the CPU bake: the march pays one texture read, never a
    // field sample. If this ever fails, the probe path has started charging the
    // raymarcher and collides with the perf plan.
    expect(PROBE_GRID_WGSL).not.toContain('mapBody');
    expect(PROBE_GRID_WGSL).not.toContain('sdPrim');
    expect(PROBE_GRID_WGSL).not.toContain('applyWounds');
  });

  it('only ever reads the probe texture, never samples it', () => {
    // textureLoad is the point (exact texel, no filtering/sampler). A
    // textureSample would need a sampler binding the probe pass does not own.
    expect(PROBE_GRID_WGSL).toContain('textureLoad(');
    expect(PROBE_GRID_WGSL).not.toContain('textureSample');
  });
});

describe('PROBE_GRID_WGSL \u2014 shape contract', () => {
  it('starts with fn probeIrradiance, per the wgslFn parse contract', () => {
    expect(PROBE_GRID_WGSL.startsWith('fn probeIrradiance(')).toBe(true);
  });

  it('declares the load helper and the L1 evaluator', () => {
    expect(PROBE_GRID_WGSL).toContain('fn probeLoadSh(probeTex: texture_2d<f32>, index: i32) -> array<vec4<f32>, 3>');
    expect(PROBE_GRID_WGSL).toContain('fn probeIrradianceL1(');
  });

  it('loads three RGBA texels per probe, x fastest at index*3 + c', () => {
    expect(PROBE_GRID_WGSL).toContain('textureLoad(probeTex, vec2<i32>(index * 3 + 0, 0), 0)');
    expect(PROBE_GRID_WGSL).toContain('textureLoad(probeTex, vec2<i32>(index * 3 + 1, 0), 0)');
    expect(PROBE_GRID_WGSL).toContain('textureLoad(probeTex, vec2<i32>(index * 3 + 2, 0), 0)');
  });

  it('manual-trilinears the 8 surrounding probes before evaluating', () => {
    // Blend coefficients, then evaluate — never blend results. Eight corner
    // loads is the pin that this is the manual trilinear, not a hardware tap.
    const loads = PROBE_GRID_WGSL.match(/probeLoadSh\(probeTex, idx/g) ?? [];
    expect(loads.length).toBe(8);
    expect(PROBE_GRID_WGSL).toContain('probeIrradianceL1(array<vec4<f32>, 3>(c0, c1, c2), n)');
  });

  it('clamps the query into the inset box and the result to non-negative', () => {
    expect(PROBE_GRID_WGSL).toContain('clamp(p, probeMin, probeMin + extent)');
    expect(PROBE_GRID_WGSL).toContain('max(e, vec3<f32>(0.0, 0.0, 0.0))');
  });

  it('shares every SH constant literal with the CPU mirror', () => {
    // The ambient.wgsl.test.ts pattern: the two copies of the maths cannot
    // drift silently because the literals are pinned by source text.
    expect(PROBE_GRID_WGSL).toContain(`${SH_Y00}`);
    expect(PROBE_GRID_WGSL).toContain(`${SH_Y1}`);
    expect(PROBE_GRID_WGSL).toContain(`${SH_A0}`);
    expect(PROBE_GRID_WGSL).toContain(`${SH_A1}`);
  });
});

describe('PROBE_GRID_WGSL \u2014 parse contract', () => {
  it('the real wgslFn parser sees exactly the six declared inputs, in order', () => {
    // WGSLNodeFunction sweeps the parameter list with /name\s*:\s*type/, so a
    // `word: word` inside a signature comment would become a PHANTOM input and
    // shift every real binding. Running the actual parser (not a grep) is the
    // only check that catches that.
    const parsed = new WGSLNodeFunction(PROBE_GRID_WGSL);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    expect(names).toEqual(['p', 'n', 'probeTex', 'probeMin', 'probeInvExtent', 'probeDims']);
    expect(parsed.inputs.length).toBe(6);
  });
});
