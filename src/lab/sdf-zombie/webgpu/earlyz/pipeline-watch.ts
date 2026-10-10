// src/lab/sdf-zombie/webgpu/earlyz/pipeline-watch.ts
//
// FRONT-PIPELINE FAILURE SIGNAL (final review, Important 2; three r186).
//
// `renderer.compileAsync` RESOLVES when a pipeline fails to build: WebGPUPipelineUtils catches the
// creation error (or reads the validation scope), logs it, sets `backend.get(pipeline).error = true`
// and still resolves the compile promise; WebGPUBackend.draw then silently skips an errored pipeline.
// So a front-face crowd material whose WGSL the browser rejects (a bad `frag_depth, greater` use the
// boot probe did not catch, a driver limit) passes `precompileInBackground` as "ok" and every body in
// the front batch silently vanishes. This module is the signal that closes that hole (measured on
// Chrome 154: compileAsync resolved, three logged "Async render pipeline creation failed", and the
// flag was set; see the pipeline-watch tests for the three source contract).
//
// HOW: wrap `renderer._pipelines.getForRender(renderObject, promises)`. three calls it for every draw
// (Renderer._renderObjectDirect) and every compileAsync, and on EVERY path (a fresh pipeline or a
// cache hit) it leaves `renderObject.pipeline` set. Pipelines are shared by program text + render
// state, so a second material with identical generated code reuses the first one's (possibly errored)
// pipeline WITHOUT any creation call: hooking creation (`backend.createRenderPipeline`) would miss it.
// For each render object whose material opted into conservative depth (the OWN property the r186
// builder patch keys on) we remember the pipeline per material, and read the same `error` flag three's
// draw path reads. The async path sets the flag before its promise resolves, so after `await compile`
// the answer is final; the synchronous path (a first draw with no precompile, ?warm=0) sets it a
// microtask round-trip later, so callers also ask every frame.
//
// COST: one property read per render object per frame, only under ?earlyz=1 (the wrap is installed
// only after a successful detection; the flag-off boot wraps nothing). Structural types only: no three
// import, no GPU, fakeable in unit tests.

interface RenderObjectLike {
  material?: (object & { conservativeDepth?: unknown }) | null;
  pipeline?: object | null;
}

interface PipelinesLike {
  getForRender?: (renderObject: RenderObjectLike, promises?: unknown) => unknown;
  __earlyzPipelineWatch?: PipelineWatch;
}

/** The slice of a three WebGPURenderer the watch needs (both are private/internal in r186). */
export interface WatchableRenderer {
  _pipelines?: PipelinesLike | null;
  /** three's Backend.get: the per-object data bag (`.error` is set on a failed pipeline). */
  backend?: { get?: (object: object) => { error?: boolean } | undefined } | null;
}

export interface PipelineWatch {
  /** A reason when a pipeline built for `material` was marked errored by three; null otherwise
   *  (including "not seen yet" and "seen, no error yet"). */
  failure(material: object): string | null;
}

export const PIPELINE_FAILED_REASON = 'three marked the pipeline errored (see the "Render pipeline creation failed" console error)';

let current: PipelineWatch | null = null;

/** The installed watch, or null when early-Z is off or the renderer could not be observed. */
export function currentPipelineWatch(): PipelineWatch | null {
  return current;
}

/**
 * Wraps `renderer._pipelines.getForRender`. Returns null when the renderer does not have the r186
 * shape (so the caller must not run early-Z blind). Idempotent per Pipelines object.
 */
export function installPipelineWatch(renderer: WatchableRenderer | null | undefined): PipelineWatch | null {
  const pipelines = renderer?._pipelines;
  const backend = renderer?.backend;
  if (!pipelines || typeof pipelines.getForRender !== 'function' || !backend || typeof backend.get !== 'function') return null;
  if (pipelines.__earlyzPipelineWatch) return (current = pipelines.__earlyzPipelineWatch);

  const original = pipelines.getForRender;
  const seen = new WeakMap<object, object[]>();
  pipelines.getForRender = function watchedGetForRender(this: unknown, renderObject: RenderObjectLike, promises?: unknown) {
    const result = original.call(this, renderObject, promises);
    const material = renderObject?.material;
    // Only the early-Z front materials (the opt-in own property): every other draw pays one read.
    if (material && material.conservativeDepth === 'greater') {
      const pipeline = renderObject.pipeline;
      if (pipeline) {
        const list = seen.get(material);
        if (!list) seen.set(material, [pipeline]);
        else if (!list.includes(pipeline)) list.push(pipeline);
      }
    }
    return result;
  };

  const get = backend.get.bind(backend);
  const watch: PipelineWatch = {
    failure(material) {
      const list = seen.get(material);
      if (!list) return null;
      for (const pipeline of list) if (get(pipeline)?.error === true) return PIPELINE_FAILED_REASON;
      return null;
    },
  };
  pipelines.__earlyzPipelineWatch = watch;
  current = watch;
  return watch;
}
