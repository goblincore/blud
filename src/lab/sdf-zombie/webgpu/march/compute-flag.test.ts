// src/lab/sdf-zombie/webgpu/march/compute-flag.test.ts
import { describe, expect, it } from 'vitest';
import { MARCH_BODY } from '../march.wgsl';
import { MARCH_COMPUTE, MARCH_COMPUTE_BLOCK, MARCH_DISCARD_READ, marchBodyForCompute } from './compute-flag';

const code = (s: string) => s.replace(/\/\/[^\n]*/g, '');

describe('the compute march flag', () => {
  it('is on unless the page says ?marchcompute=0', () => {
    expect(MARCH_COMPUTE).toBe(true);
  });

  it('is a block the measurement supports: a multiple of 8 invocations a side', () => {
    expect(MARCH_COMPUTE_BLOCK % 8).toBe(0);
  });

  it('turns every discard of the shipped march entry into the flag, and keeps its return', () => {
    const out = marchBodyForCompute(MARCH_BODY);
    expect(code(out)).not.toMatch(/\bdiscard\b/);
    const discards = code(MARCH_BODY).match(/\bdiscard\s*;/g)!.length;
    expect(discards).toBeGreaterThan(0);
    expect(code(out).match(/gCmpDiscard = 1\.0; return vec4<f32>\(0\.0, 0\.0, 0\.0, 0\.0\);/g)!.length).toBe(discards);
    // Nothing else moved: the two texts differ only where a discard stood.
    expect(out.split('gCmpDiscard = 1.0;').join('discard;')).toBe(MARCH_BODY);
  });

  it('refuses an entry whose discard does not return at once', () => {
    expect(() => marchBodyForCompute('fn f() -> vec4<f32> { discard; }')).toThrow(/no discard-and-return/);
    expect(() => marchBodyForCompute('fn f() -> vec4<f32> { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }\nfn g() { discard; }')).toThrow(/without its return/);
  });

  it('declares the flag it reads', () => {
    expect(MARCH_DISCARD_READ).toMatch(/var<private> gCmpDiscard: f32 = 0\.0;/);
    expect(MARCH_DISCARD_READ).toMatch(/fn readMarchDiscard\(dep: vec4<f32>\) -> f32/);
  });
});
