// src/lab/sdf-zombie/webgpu/wgslfn-binding.test.ts
//
// GPU-free proof of how the installed three (0.186) binds wgslFn call arguments: an OBJECT argument binds by parameter NAME, an ARRAY argument binds by POSITION.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { wgslFn } from 'three/tsl';
import NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
// @ts-expect-error — deep three source import for the WGSL parser; no
// public type declarations exist for three/src/renderers/* (same pattern as
// deferred-sdf.test.ts).
import WGSLNodeParser from 'three/src/renderers/webgpu/nodes/WGSLNodeParser.js';

// Two same-typed parameters, so a by-name and a by-position binding of the
// same call emit DIFFERENT calls: { second: 2, first: 1 } is
// `probe( 1.0, 2.0 )` by name but `probe( 2.0, 1.0 )` by insertion order.
const PROBE = `fn probe( first: f32, second: f32, ) -> f32 {
	return first + second;
}`;

type Callable = { build(builder: unknown): string };

/** A real NodeBuilder at the 'generate' stage — only the renderer is a stub,
 *  and nothing in FunctionCallNode.generate's path consults it. */
const generateCall = (callNode: Callable): string => {
  const ctor = NodeBuilder as unknown as new (o: unknown, r: unknown, p: unknown) => {
    buildStage: string;
    shaderStage: string;
  };
  // registerDeclaration reads renderer.debug.diagnostics.keywords — the one
  // renderer touch on this path; keywords: false skips reserved renaming.
  const renderer = { debug: { diagnostics: { keywords: false } } };
  const builder = new ctor({}, renderer, new WGSLNodeParser());
  builder.buildStage = 'generate';
  builder.shaderStage = 'fragment';
  return callNode.build(builder);
};

describe('wgslFn argument binding (installed three 0.186)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('an OBJECT argument binds by NAME: keys in reverse order still land on their own parameter', () => {
    const fn = wgslFn(PROBE);
    // Keys deliberately REVERSED against the WGSL signature order — the
    // 'bound POSITIONALLY' claim in zombie-gpu.ts would make this misbind.
    const call = fn({ second: 2, first: 1 }) as unknown as Callable;
    expect(generateCall(call)).toBe('probe( 1.0, 2.0 )');
  });

  it('an ARRAY argument (two call arguments) binds by POSITION: this is the one form where order matters', () => {
    const fn = wgslFn(PROBE);
    const call = fn(9, 5) as unknown as Callable;
    expect(generateCall(call)).toBe('probe( 9.0, 5.0 )');
  });

  it('a MISSING object key only logs a console error and binds float(0) — the real key hazard', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = wgslFn(PROBE);
    const call = fn({ first: 1 }) as unknown as Callable;
    expect(generateCall(call)).toBe('probe( 1.0, 0.0 )');
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0]?.[0])).toContain("Input 'second' not found");
  });

  it('an object key with no matching parameter is ignored — it cannot shift another key onto a slot', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = wgslFn(PROBE);
    const call = fn({ stray: 7, first: 1, second: 2 }) as unknown as Callable;
    expect(generateCall(call)).toBe('probe( 1.0, 2.0 )');
    expect(errSpy).not.toHaveBeenCalled();
  });
});
