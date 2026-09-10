import { describe, it, expect } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser; no
// public type declarations exist for three/src/* (same pattern as
// probe-grid.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { FLASHLIGHT_BOUNCE_WGSL } from './flashlight-bounce.wgsl';
import { BOUNCE_PI_LITERAL } from '../flashlight-bounce';

describe('FLASHLIGHT_BOUNCE_WGSL \u2014 the hard perf constraint', () => {
  it('evaluates the SDF field ZERO times', () => {
    expect(FLASHLIGHT_BOUNCE_WGSL).not.toContain('mapBody');
    expect(FLASHLIGHT_BOUNCE_WGSL).not.toContain('sdPrim');
    expect(FLASHLIGHT_BOUNCE_WGSL).not.toContain('applyWounds');
  });

  it('never reads or samples a texture', () => {
    expect(FLASHLIGHT_BOUNCE_WGSL).not.toContain('textureLoad');
    expect(FLASHLIGHT_BOUNCE_WGSL).not.toContain('textureSample');
  });
});

describe('FLASHLIGHT_BOUNCE_WGSL \u2014 shape contract', () => {
  it('starts with fn bounceSpotIrradiance, per the wgslFn parse contract', () => {
    expect(FLASHLIGHT_BOUNCE_WGSL.startsWith('fn bounceSpotIrradiance(')).toBe(true);
  });

  it('gates on spotCfg.x and returns vec3(0) immediately', () => {
    expect(FLASHLIGHT_BOUNCE_WGSL).toContain('if (spotCfg.x <= 0.0)');
    expect(FLASHLIGHT_BOUNCE_WGSL).toContain('return vec3<f32>(0.0, 0.0, 0.0);');
  });

  it('takes the radius from spotCfg.y and multiplies by the spotCfg.x gain', () => {
    expect(FLASHLIGHT_BOUNCE_WGSL).toContain('spotCfg.y');
    expect(FLASHLIGHT_BOUNCE_WGSL).toContain('* spotCfg.x');
  });

  it('shares the pi literal with the CPU mirror', () => {
    expect(FLASHLIGHT_BOUNCE_WGSL).toContain(`${BOUNCE_PI_LITERAL}`);
  });
});

describe('FLASHLIGHT_BOUNCE_WGSL \u2014 parse contract', () => {
  it('the real wgslFn parser sees exactly the six declared inputs, in order', () => {
    // WGSLNodeFunction sweeps the parameter list with /name\s*:\s*type/, so a
    // `word: word` inside a signature comment would become a PHANTOM input and
    // shift every real binding. Running the actual parser (not a grep) is the
    // only check that catches that.
    const parsed = new WGSLNodeFunction(FLASHLIGHT_BOUNCE_WGSL);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    expect(names).toEqual(['p', 'n', 'spotPosW', 'spotNormalW', 'spotRadiance', 'spotCfg']);
    expect(parsed.inputs.length).toBe(6);
  });
});
