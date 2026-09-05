import { describe, expect, it } from 'vitest';
// @ts-expect-error — deep three source import for the real parser used by wgslFn
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import {
  NORMAL_GRADIENT_HELPERS,
  NORMAL_GRADIENT_PROBE,
  buildNormalGradientFn,
} from './normal-gradient.wgsl';

function declaredName(src: string): string | null {
  return /^fn\s+([a-z_0-9]+)\s*\(/i.exec(src)?.[1] ?? null;
}

describe('normal-gradient WGSL registration', () => {
  it('parses every helper with the real wgslFn parser and exports the required signatures', () => {
    const parsed = NORMAL_GRADIENT_HELPERS.map(src => new WGSLNodeFunction(src));
    expect(parsed.map(x => x.name)).toEqual([
      'ngReset', 'ngQRot', 'ngCapsule', 'ngCapsuleOriented', 'ngSmin', 'ngSmax',
    ]);
    expect(parsed.find(x => x.name === 'ngCapsule')?.inputs.map((x: { name: string }) => x.name))
      .toEqual(['p', 'a', 'b', 'r', 'scale']);
    expect(parsed.find(x => x.name === 'ngSmin')?.inputs.map((x: { name: string }) => x.name))
      .toEqual(['a', 'b', 'kIn']);
    expect(parsed.find(x => x.name === 'ngSmax')?.inputs.map((x: { name: string }) => x.name))
      .toEqual(['a', 'b', 'kIn']);
  });

  it('keeps helpers unique and ordered so each source calls only earlier helpers', () => {
    const names = NORMAL_GRADIENT_HELPERS.map(declaredName);
    expect(new Set(names).size).toBe(names.length);
    const seen = new Set<string>();
    NORMAL_GRADIENT_HELPERS.forEach((src, i) => {
      const self = names[i]!;
      const body = src.slice(src.indexOf('{'));
      for (const other of names) {
        if (other === null || other === self || seen.has(other)) continue;
        expect(new RegExp(`\\b${other}\\s*\\(`).test(body), `${self} calls later ${other}`).toBe(false);
      }
      seen.add(self);
    });
  });

  it('registers a top-level probe that resets validity and exposes a separate reason pass', () => {
    const parsed = new WGSLNodeFunction(NORMAL_GRADIENT_PROBE);
    expect(parsed.name).toBe('ngProbe');
    expect(parsed.inputs.map((x: { name: string }) => x.name)).toEqual([
      'p', 'a', 'b', 'r', 'scale', 'quat', 'dgA', 'dgB', 'kIn', 'kind',
      'reasonPass', 'negateX',
    ]);
    expect(buildNormalGradientFn(NORMAL_GRADIENT_PROBE).isNode).toBe(true);
  });

  it.each([
    ['sphere', 'ngCapsule(vec3<f32>(2.0, 0.0, 0.0), vec3<f32>(0.0), vec3<f32>(0.0), 1.0, vec3<f32>(1.0))'],
    ['capsule', 'ngCapsule(vec3<f32>(0.3, 0.4, 0.2), vec3<f32>(0.0), vec3<f32>(0.0, 1.0, 0.0), 0.2, vec3<f32>(1.0))'],
    ['nonuniform scale', 'ngCapsule(vec3<f32>(0.41, 0.32, 0.37), vec3<f32>(-0.3, -0.1, 0.2), vec3<f32>(0.5, 0.8, -0.1), 0.18, vec3<f32>(1.8, 0.65, 1.25))'],
    ['rotated capsule', 'ngCapsuleOriented(vec3<f32>(0.52, 0.43, 0.31), vec3<f32>(-0.15, 0.2, 0.1), vec3<f32>(0.45, 0.7, -0.05), 0.16, vec3<f32>(1.65, 0.7, 1.2), vec4<f32>(0.0, 0.0, 0.0, 1.0))'],
    ['smooth min', 'ngSmin(vec4<f32>(-0.04, 0.35, -0.8, 0.1), vec4<f32>(0.02, -0.25, 0.2, 0.6), 0.03)'],
    ['smooth max', 'ngSmax(vec4<f32>(-0.04, 0.35, -0.8, 0.1), vec4<f32>(0.02, -0.25, 0.2, 0.6), 0.03)'],
  ])('registers a real %s fixture through the previous-helper-only chain', (_name, expression) => {
    const entry = `fn ngFixture() -> vec4<f32> {\n  let resetMarker = ngReset();\n  return ${expression} + vec4<f32>(resetMarker);\n}`;
    const call = buildNormalGradientFn(entry)();
    expect(call.isNode).toBe(true);
    const fn = call.functionNode as unknown as { includes: unknown[] };
    expect(fn.includes).toHaveLength(1);
  });
});
