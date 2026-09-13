import { describe, expect, it } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser (same as sdf-layer.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { createUpscaleModel, type ConvLayer } from './upscale-model';
import { lit, matLiteral, planUpscalePasses, UPSCALE_RECONSTRUCT_WGSL, UPSCALE_SHARPEN_WGSL } from './upscale-wgsl';

const declared = (src: string) => {
  const params = src.slice(src.indexOf('(') + 1, src.indexOf(') ->')).replace(/\/\/[^\n]*/g, '');
  return [...params.matchAll(/([A-Za-z_0-9]+)\s*:/g)].map((m) => m[1]);
};
const expectParses = (src: string) => {
  const parsed = new WGSLNodeFunction(src);
  expect(parsed.inputs.map((i: { name: string }) => i.name)).toEqual(declared(src));
  expect(parsed.inputs.every((i: { type?: string }) => i.type !== undefined)).toBe(true);
};

describe('upscale pass plan', () => {
  it('a dilated hidden layer offsets its taps by the dilation', () => {
    const passes = planUpscalePasses(createUpscaleModel('t16', 'rgb', 1), 'sp');
    expect(passes[1]!.run).toContain('vec2<i32>(-2, -2)');
    expect(passes[1]!.run).toContain('vec2<i32>(2, 0)');
    expect(passes[0]!.run).not.toContain('vec2<i32>(-2, -2)');
    expect(passes[2]!.run).not.toContain('vec2<i32>(-2, -2)');
  });

  it('normal input sets bind a second texture on the first pass only, depth-first when both', () => {
    for (const inputs of ['rgbn', 'rgbdn'] as const) {
      const passes = planUpscalePasses(createUpscaleModel('s8', inputs, 1), 'sp');
      expect(passes[0]!.params).toEqual(['march', 'normal']);
      expect(passes[0]!.inputs).toEqual(['march', 'normal']);
      expect(passes[0]!.usesNearFar).toBe(inputs === 'rgbdn');
      expect(passes[0]!.run).toContain('textureLoad(normal, q4, 0).xyz * h4');
      expect(passes[1]!.params).not.toContain('normal');
      expect(passes[1]!.run).not.toContain('normal');
    }
    // rgbdn: depth is the first channel of the second vec4, then the normal
    const dn = planUpscalePasses(createUpscaleModel('s8', 'rgbdn', 1), 'sp')[0]!.run;
    expect(dn).toMatch(/let a1_0 = vec4<f32>\(h0 \* \(nearFar\.x[^;]*n0\.x[^;]*n0\.y[^;]*n0\.z[^;]*\);/);
    expect(planUpscalePasses(createUpscaleModel('s8', 'rgb', 1), 'sp')[0]!.params).toEqual(['march']);
  });

  it('s8 sub-pixel: two hidden convs, the 16-channel last conv, then the shuffle', () => {
    const passes = planUpscalePasses(createUpscaleModel('s8', 'rgb', 1), 'sp');
    expect(passes.map((p) => p.name)).toEqual(['L1a', 'L2a', 'L3a', 'shuffle']);
    expect(passes.map((p) => p.targets)).toEqual([2, 2, 4, 1]);
    expect(passes[0]!.inputs).toEqual(['march']);
    expect(passes[0]!.params).toEqual(['march']);
    expect(passes[1]!.inputs).toEqual(['L1a:0', 'L1a:1']);
    expect(passes[3]!.inputs).toEqual(['march', 'L3a:0', 'L3a:1', 'L3a:2', 'L3a:3']);
    expect(passes[3]!.params).toEqual(['march', 'in0', 'in1', 'in2', 'in3']);
    expect(passes.map((p) => p.outputRes)).toEqual(['low', 'low', 'low', 'full']);
  });

  it('s8 deconvolution: the last layer runs per output pixel', () => {
    const passes = planUpscalePasses(createUpscaleModel('s8', 'rgb', 1), 'dc');
    expect(passes.map((p) => p.name)).toEqual(['L1a', 'L2a', 'deconv']);
    expect(passes[2]!.inputs).toEqual(['march', 'L2a:0', 'L2a:1']);
    expect(passes[2]!.outputRes).toBe('full');
  });

  it('s32 splits every 32-channel layer into two 16-channel passes', () => {
    const sp = planUpscalePasses(createUpscaleModel('s32', 'rgb', 1), 'sp');
    expect(sp.map((p) => p.name)).toEqual(['L1a', 'L1b', 'L2a', 'L2b', 'L3a', 'shuffle']);
    expect(sp[2]!.inputs).toEqual(['L1a:0', 'L1a:1', 'L1a:2', 'L1a:3', 'L1b:0', 'L1b:1', 'L1b:2', 'L1b:3']);
    const dc = planUpscalePasses(createUpscaleModel('s32', 'rgb', 1), 'dc');
    expect(dc.map((p) => p.name)).toEqual(['L1a', 'L1b', 'L2a', 'L2b', 'deconv']);
    expect(dc[4]!.inputs).toHaveLength(9);
  });

  it('only the first layer of an rgbd model takes nearFar', () => {
    const passes = planUpscalePasses(createUpscaleModel('s16', 'rgbd', 1), 'sp');
    expect(passes.map((p) => p.usesNearFar)).toEqual([true, false, false, false]);
    expect(passes[0]!.run).toContain('nearFar: vec2<f32>');
    expect(planUpscalePasses(createUpscaleModel('s16', 'rgb', 1), 'sp')[0]!.usesNearFar).toBe(false);
  });
});

describe('upscale WGSL sources', () => {
  const all = (['s8', 's16', 's32', 's64d', 't16', 'zero'] as const).flatMap((id) =>
    (['rgb', 'rgbd', 'rgbn', 'rgbdn'] as const).flatMap((inputs) =>
      (['sp', 'dc'] as const).filter((layout) => !(layout === 'dc' && id === 's64d'))
        .map((layout) => ({ id, inputs, layout, passes: planUpscalePasses(createUpscaleModel(id, inputs, 1), layout) }))));

  it('refuses the deconv layout when it would bind more than 16 textures (s64 last hidden layer)', () => {
    expect(() => planUpscalePasses(createUpscaleModel('s64', 'rgb', 1), 'dc')).toThrow(/limit 16.*use layout sp/);
    expect(() => planUpscalePasses(createUpscaleModel('s64', 'rgb', 1), 'sp')).not.toThrow();
    expect(() => planUpscalePasses(createUpscaleModel('s32', 'rgb', 1), 'dc')).not.toThrow();
  });

  it('every generated function parses to its real parameter list (no phantom inputs)', () => {
    expectParses(UPSCALE_RECONSTRUCT_WGSL);
    expectParses(UPSCALE_SHARPEN_WGSL);
    for (const { passes } of all) {
      for (const p of passes) {
        expectParses(p.run);
        for (const r of p.reads) expectParses(r);
        if (p.state) expectParses(p.state);
      }
    }
  });

  it('every pass takes the shared flipY convention and never blends', () => {
    for (const { passes } of all) {
      for (const p of passes) {
        expect(p.run).toContain('if (flipY > 0.5) { st.y = 1.0 - st.y; }');
        expect(p.run).not.toContain('mix(');
      }
    }
    expect(UPSCALE_RECONSTRUCT_WGSL).not.toContain('mix(');
  });

  it('depth comes from one source texel and the sentinel is the far plane', () => {
    expect(UPSCALE_RECONSTRUCT_WGSL).toContain('return vec4<f32>(max(src.xyz + res.xyz, vec3<f32>(0.0)), src.w);');
    expect(UPSCALE_RECONSTRUCT_WGSL).toContain('return vec4<f32>(0.0, 0.0, 0.0, 1.0);');
  });

  it('the shuffle reads sub-pixel s of targets r, g, b, coverage (PyTorch order)', () => {
    const shuffle = planUpscalePasses(createUpscaleModel('s8', 'rgb', 1), 'sp')[3]!;
    expect(shuffle.run).toContain('let s = i * 2 + j;');
    expect(shuffle.run).toContain('vec4<f32>(rr[s], gg[s], bb[s], cc[s])');
  });

  it('the zero model bakes no matrices', () => {
    for (const { id, passes } of all) {
      if (id !== 'zero') continue;
      for (const p of passes) expect(p.run).not.toContain('mat4x4');
    }
  });

  it('conv passes write one private global per target and read it back', () => {
    const l1 = planUpscalePasses(createUpscaleModel('s16', 'rgb', 1), 'sp')[0]!;
    expect(l1.reads).toHaveLength(4);
    expect(l1.state).toContain('var<private> gUpL1a_3: vec4<f32>;');
    expect(l1.reads[2]).toContain('return gUpL1a_2;');
    expect(l1.run).toContain('gUpL1a_0 = max(acc0, vec4<f32>(0.0));');
    const last = planUpscalePasses(createUpscaleModel('s16', 'rgb', 1), 'sp')[2]!;
    expect(last.run).toContain('gUpL3a_0 = acc0;');
  });
});

describe('upscale literals', () => {
  it('lit() always emits a float literal that round-trips float32', () => {
    for (const v of [0, 1, -3, 0.1, -3e-9, 123456789, 1e21, Math.fround(0.3)]) {
      const s = lit(v);
      expect(s).toMatch(/^-?\d+(\.\d+)?(e[+-]?\d+)?$/);
      expect(/[.e]/.test(s)).toBe(true);
      expect(Math.fround(Number(s))).toBe(Math.fround(v));
    }
  });

  it('matLiteral is column-major: entry (col,row) = W[outChannels[row], 4v+col, ky, kx]', () => {
    const layer: ConvLayer = { inC: 5, outC: 16, dilation: 1, weights: new Float32Array(16 * 5 * 9), bias: new Float32Array(16), relu: false };
    layer.weights.forEach((_, k) => { layer.weights[k] = k + 1; });
    const out = [4, 5, 6, 7];
    const m = matLiteral(layer, out, 1, 2, 0)!;
    const nums = m.slice('mat4x4<f32>('.length, -1).split(',').map((s) => Number(s.trim()));
    expect(nums).toHaveLength(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        const inCh = 4 + col;
        const want = inCh < 5 ? layer.weights[((out[row]! * 5 + inCh) * 3 + 2) * 3 + 0]! : 0;
        expect(nums[col * 4 + row]).toBe(want);
      }
    }
    const zero: ConvLayer = { ...layer, weights: new Float32Array(layer.weights.length) };
    expect(matLiteral(zero, out, 0, 0, 0)).toBeNull();
  });
});
