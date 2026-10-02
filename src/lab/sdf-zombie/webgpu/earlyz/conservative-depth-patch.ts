// src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.ts
//
// CONSERVATIVE DEPTH FOR THREE r186 (spec 2026-10-01 §4 A, D8). three emits every
// depthNode as plain `@builtin(frag_depth)`, which disables hardware early-Z. This
// wraps WGSLNodeBuilder.getFragDepth so a material that opts in with the OWN property
// `conservativeDepth = 'greater'` (own properties enter three's render-object cache key;
// userData does not) registers the builtin as 'frag_depth, greater'. getBuiltins prints
// the name verbatim. No `requires fragment_depth;`: three's fragment template has no
// directive slot and Chrome 154 accepts the qualifier without it (probe 2026-10-01).
// Installed only under ?earlyz=1, and only on the revision it was written against.
//
// Caveats:
// - The opt-in is an own property, so `material.clone()` (which copies only known
//   material fields) drops it; a clone degrades safely to plain `frag_depth`.
// - detectConservativeDepth holds its device-wide validation error scope for ONE synchronous
//   stretch only: push, createShaderModule, pop (the pop PROMISE is awaited later). A scope
//   held across awaits absorbs any unrelated validation error issued meanwhile (measured on
//   Chrome 154: an invalid createBuffer between the awaits landed in the scope and never
//   reached uncapturederror). The compile verdict does not need the long scope: a bad
//   qualifier shows in getCompilationInfo and in the module's own scope, and a rejected
//   createRenderPipelineAsync reports through its rejection, not through a scope.
import { WGSLNodeBuilder, REVISION } from 'three/webgpu';

export const CONSERVATIVE_DEPTH_BUILTIN = 'frag_depth, greater';
export const PATCHED_THREE_REVISION = '186';

interface BuilderLike {
  material?: { conservativeDepth?: unknown } | null;
  getBuiltin(name: string, property: string, type: string, stage?: string): string;
  getFragDepth(): string;
  __earlyzPatched?: boolean;
}

let hits = 0;

export function installConservativeDepthPatch(
  proto: BuilderLike = WGSLNodeBuilder.prototype as unknown as BuilderLike,
  revision: string = REVISION,
): { installed: boolean; reason: string | null } {
  if (revision !== PATCHED_THREE_REVISION) {
    return { installed: false, reason: `three r${revision}; the patch is written for r${PATCHED_THREE_REVISION}` };
  }
  if (proto.__earlyzPatched) return { installed: true, reason: null };
  const original = proto.getFragDepth;
  proto.getFragDepth = function patchedGetFragDepth(this: BuilderLike): string {
    if (this.material?.conservativeDepth === 'greater') {
      hits++;
      return 'output.' + this.getBuiltin(CONSERVATIVE_DEPTH_BUILTIN, 'depth', 'f32', 'output');
    }
    return original.call(this);
  };
  proto.__earlyzPatched = true;
  return { installed: true, reason: null };
}

/** How many times the patch has answered a getFragDepth call with `frag_depth, greater`.
 *  This counts calls, not shaders: one build can call getFragDepth more than once. */
export function conservativeDepthPatchHits(): number {
  return hits;
}

/** The exact syntax the patch emits, as a one-pipeline probe. */
export const EARLYZ_DETECT_WGSL = /* wgsl */ `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.5, 1.0);
}
struct EarlyzProbeOut { @location(0) c: vec4<f32>, @builtin(${CONSERVATIVE_DEPTH_BUILTIN}) d: f32 }
@fragment fn fs() -> EarlyzProbeOut {
  var o: EarlyzProbeOut;
  o.c = vec4<f32>(1.0);
  o.d = 0.75;
  return o;
}`;

interface DeviceLike {
  pushErrorScope(filter: 'validation'): void;
  popErrorScope(): Promise<{ message: string } | null>;
  createShaderModule(d: { code: string; label?: string }): {
    getCompilationInfo(): Promise<{ messages: readonly { type: string; message: string }[] }>;
  };
  createRenderPipelineAsync(d: unknown): Promise<unknown>;
}

/** D8: feature detection by COMPILING, not by wgslLanguageFeatures (Chrome 154 does
 *  not list `fragment_depth` but accepts the syntax). Reason precedence when several
 *  signals fire: compile > pipeline > validation > threw. */
export async function detectConservativeDepth(device: DeviceLike): Promise<{ ok: boolean; reason: string | null }> {
  // The scope's verdict, settled so it can neither reject unobserved nor throw past a
  // compile or pipeline reason that outranks it.
  type Scoped = { error: { message: string } | null } | { thrown: unknown };
  try {
    let scoped: Promise<Scoped>;
    let module: ReturnType<DeviceLike['createShaderModule']>;
    device.pushErrorScope('validation');
    try {
      module = device.createShaderModule({ code: EARLYZ_DETECT_WGSL, label: 'earlyz-detect' });
    } finally {
      // Popped in the same synchronous stretch as the push: nothing else can issue GPU work
      // inside the scope. Only the pop's result is awaited, below, outside any scope.
      scoped = device.popErrorScope().then((error): Scoped => ({ error }), (thrown): Scoped => ({ thrown }));
    }
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    let pipelineError: string | null = null;
    if (errors.length === 0) {
      try {
        await device.createRenderPipelineAsync({
          label: 'earlyz-detect', layout: 'auto',
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        });
      } catch (e) {
        pipelineError = String((e as Error)?.message ?? e);
      }
    }
    const verdict = await scoped;
    if (errors.length > 0) return { ok: false, reason: `compile: ${errors[0]!.message}` };
    if (pipelineError !== null) return { ok: false, reason: `pipeline: ${pipelineError}` };
    if ('thrown' in verdict) return { ok: false, reason: `threw: ${String(verdict.thrown)}` };
    if (verdict.error) return { ok: false, reason: `validation: ${verdict.error.message}` };
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: `threw: ${String(e)}` };
  }
}
