// R1 GATHER DISPATCH — can a workgroup-shared array be passed into a wgslFn?
// Ran 2026-09-10; the answer decides the R1 design (see
// docs/dev-notes/2026-09-10-r1-gather-dispatch-design.md).
//
// This is the one unknown the R1 design hinges on. Option A (one dispatch, one
// thread per (probe, ray), workgroup-shared tree reduction) needs `workgroupArray`
// to survive into a generated WGSL function signature AND be writable/readable
// across threads inside it. Option B (workgroup per probe, subgroupAdd) is the
// fallback if it does not.
//
// Answered at the PARSE/EMIT level, which is cheap and deterministic, BEFORE any
// GPU work — because landing WGSL on an unverified binding mechanism is exactly
// what cost this project an afternoon (a comment became a phantom input, the
// composite never compiled, the flesh vanished at every setting).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { wgslFn, workgroupArray, instanceIndex } from 'three/tsl';
// @ts-expect-error — deep three source import for the real wgslFn parser; no public
// type declarations exist for three/src/* (same as sdf-layer.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';

describe('R1 probe — workgroup-shared array through a wgslFn', () => {
  it('workgroupArray exports and constructs', () => {
    // NOTE: `workgroupBarrier` is NOT a function export in this three build, so
    // the barrier has to come from the WGSL side (a module-scope declaration or
    // the kernel text) rather than a TSL call. That is a real finding for the
    // implementation, not a probe bug.
    expect(typeof workgroupArray).toBe('function');
    expect(workgroupArray('float', 4)).toBeTruthy();
  });

  it('a workgroup array can be PASSED INTO a wgslFn and appears in the signature', () => {
    const K = /* wgsl */ `fn kProbeScratch(
      scratch: ptr<workgroup, array<f32>>,
      gi: u32
    ) -> void {
      scratch[gi] = f32(gi);
      workgroupBarrier();
    }`;
    const fn = wgslFn(K);
    // The parser must accept the function at all.
    expect(fn).toBeTruthy();

    // And the node must be usable as a call argument. This is the real question:
    // if TSL cannot bind a WorkgroupNode to a function parameter, this either
    // throws here or emits a call the compiler will reject.
    let built: unknown = null;
    let err: unknown = null;
    try {
      built = fn({ scratch: workgroupArray('float', 64), gi: instanceIndex });
    } catch (e) { err = e; }
    expect(err).toBeNull();
    expect(built).toBeTruthy();
  });

  it('parses the workgroup pointer as a DECLARED input, not a phantom', () => {
    // Constructed directly, the way sdf-layer.test.ts already does it — going
    // through getNodeFunction() needs a builder and was my probe's own error.
    const src = `fn kProbeScratch(
      scratch: ptr<workgroup, array<f32>>,
      gi: u32
    ) -> void {
      scratch[gi] = f32(gi);
    }`;
    const parsed = new WGSLNodeFunction(src);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    expect(names).toEqual(['scratch', 'gi']);
    // The phantom-input lesson from 43779459: EVERY parsed input must carry a
    // type, because a `word: word` inside a comment parses as an input with no
    // type and silently breaks the pipeline.
    expect(parsed.inputs.every((i: { type?: string }) => i.type !== undefined)).toBe(true);
  });

  it('subgroupAdd exists as the Option B fallback', async () => {
    const tsl = await import('three/tsl');
    expect(typeof (tsl as unknown as Record<string, unknown>).subgroupAdd).toBe('function');
  });
});
