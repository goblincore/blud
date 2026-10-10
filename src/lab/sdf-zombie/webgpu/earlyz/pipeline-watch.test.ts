import { describe, it, expect } from 'vitest';
import { REVISION } from 'three/webgpu';
import { installPipelineWatch, currentPipelineWatch, PIPELINE_FAILED_REASON } from './pipeline-watch';
import pipelineUtilsSrc from '../../../../../node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js?raw';
import pipelinesSrc from '../../../../../node_modules/three/src/renderers/common/Pipelines.js?raw';
import webgpuBackendSrc from '../../../../../node_modules/three/src/renderers/webgpu/WebGPUBackend.js?raw';
import rendererSrc from '../../../../../node_modules/three/src/renderers/common/Renderer.js?raw';

interface FakeMaterial { conservativeDepth?: string }
interface FakeRO { material: FakeMaterial; pipeline: object | null }

/** The opt-in material the watch tracks (the own property the r186 builder patch keys on). */
const front = (): FakeMaterial => ({ conservativeDepth: 'greater' });

/**
 * A renderer with three's r186 shape: `_pipelines.getForRender(ro, promises)` always leaves
 * `ro.pipeline` set (a fresh pipeline per program key, or the cached one), and `backend.get(object)`
 * is the per-object data bag whose `.error` three sets on a failed pipeline.
 */
function fakeRenderer(onCreate?: (ro: FakeRO, pipeline: object, promises: Promise<void>[] | null) => void) {
  const data = new WeakMap<object, { error?: boolean }>();
  const cache = new Map<string, object>();
  const calls: { self: unknown; ro: FakeRO; promises: unknown }[] = [];
  const pipelines = {
    getForRender(this: unknown, ro: FakeRO, promises: Promise<void>[] | null = null) {
      calls.push({ self: this, ro, promises });
      const key = (ro as FakeRO & { key?: string }).key ?? `unique-${calls.length}`;
      let pipeline = cache.get(key);
      if (!pipeline) { cache.set(key, pipeline = { key }); onCreate?.(ro, pipeline, promises); }
      ro.pipeline = pipeline;
      return pipeline;
    },
  };
  const backend = {
    get(o: object) {
      let d = data.get(o);
      if (!d) data.set(o, d = {});
      return d;
    },
  };
  const renderer = { _pipelines: pipelines, backend };
  const ro = (material: FakeMaterial, key?: string): FakeRO => ({ material, pipeline: null, ...(key ? { key } : {}) } as FakeRO);
  return { renderer, pipelines, backend, calls, ro, fail: (pipeline: object) => { backend.get(pipeline).error = true; } };
}

describe('three r186 contract the watch relies on', () => {
  it('THREE.REVISION', () => {
    expect(REVISION, 'patch written for r186: re-verify the pipeline error contract before upgrading').toBe('186');
  });
  it('a failed pipeline sets backend.get(pipeline).error on both the sync and the async creation path', () => {
    const marks = pipelineUtilsSrc.split('pipelineData.error = true;').length - 1;
    expect(marks).toBe(2);
    expect(pipelineUtilsSrc).toContain('const pipelineData = backend.get( pipeline );');
  });
  it('compileAsync resolves on a failed pipeline: the async creation promise always resolves', () => {
    expect(pipelineUtilsSrc).toContain('Guarantee resolution so `compileAsync`');
  });
  it('the backend draw skips an errored pipeline', () => {
    expect(webgpuBackendSrc).toContain('if ( pipelineData.error === true ) return;');
  });
  it('getForRender leaves renderObject.pipeline set on a cache hit too (pipelines are shared by program text)', () => {
    const fn = pipelinesSrc.slice(pipelinesSrc.indexOf('getForRender( renderObject, promises = null ) {'));
    const end = fn.indexOf('return data.pipeline;');
    const body = fn.slice(0, end);
    expect(body).toContain('let pipeline = this.caches.get( cacheKey );');
    expect(body).toContain('} else {\n\n\t\t\t\trenderObject.pipeline = pipeline;');
    // ...and _getRenderPipeline sets it for a fresh one.
    expect(pipelinesSrc).toContain('renderObject.pipeline = pipeline;\n\n\t\t\t// The `promises` array');
  });
  it('the renderer owns `_pipelines` and calls getForRender for every draw and every compile', () => {
    expect(rendererSrc).toContain('this._pipelines = new Pipelines( backend, this._nodes, this.info );');
    expect(rendererSrc).toContain('this._pipelines.getForRender( renderObject, this._compilationPromises );');
    expect(rendererSrc).toContain('this._pipelines.getForRender( renderObject, pipelinePromises );');
  });
});

describe('installPipelineWatch', () => {
  it('refuses a renderer without the r186 shape', () => {
    expect(installPipelineWatch(null)).toBeNull();
    expect(installPipelineWatch(undefined)).toBeNull();
    expect(installPipelineWatch({})).toBeNull();
    expect(installPipelineWatch({ _pipelines: {}, backend: { get: () => ({}) } })).toBeNull();
    expect(installPipelineWatch({ _pipelines: { getForRender() { /* no backend */ } } })).toBeNull();
    expect(installPipelineWatch({ _pipelines: { getForRender() { /* no get */ } }, backend: {} })).toBeNull();
  });

  it('passes the call through untouched (this, arguments, return value)', () => {
    const f = fakeRenderer();
    installPipelineWatch(f.renderer as never);
    const ro = f.ro(front());
    const promises: Promise<void>[] = [];
    const out = f.pipelines.getForRender(ro, promises);
    expect(out).toBe(ro.pipeline);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.self).toBe(f.pipelines);
    expect(f.calls[0]!.ro).toBe(ro);
    expect(f.calls[0]!.promises).toBe(promises);
  });

  it('reports nothing before a pipeline is seen, and nothing for a healthy one', () => {
    const f = fakeRenderer();
    const watch = installPipelineWatch(f.renderer as never)!;
    const material = front();
    expect(watch.failure(material)).toBeNull();
    f.pipelines.getForRender(f.ro(material));
    expect(watch.failure(material)).toBeNull();
  });

  it('reports a failed pipeline for ITS material only', () => {
    const f = fakeRenderer();
    const watch = installPipelineWatch(f.renderer as never)!;
    const a = front(), b = front();
    const roA = f.ro(a), roB = f.ro(b);
    f.pipelines.getForRender(roA);
    f.pipelines.getForRender(roB);
    f.fail(roA.pipeline!);
    expect(watch.failure(a)).toBe(PIPELINE_FAILED_REASON);
    expect(watch.failure(b)).toBeNull();
    expect(watch.failure(front())).toBeNull();
  });

  it('a material that did not opt in is not tracked (the hot path stays one property read)', () => {
    const f = fakeRenderer();
    const watch = installPipelineWatch(f.renderer as never)!;
    const plain: FakeMaterial = {};
    const ro = f.ro(plain);
    f.pipelines.getForRender(ro);
    f.fail(ro.pipeline!);
    expect(watch.failure(plain)).toBeNull();
    const other = f.ro({ conservativeDepth: 'less' });
    f.pipelines.getForRender(other);
    f.fail(other.pipeline!);
    expect(watch.failure(other.material)).toBeNull();
  });

  it('sees a failed pipeline that a SECOND material only reused from the cache (identical program text)', () => {
    // three shares a pipeline by program text + render state: the second material's draw never
    // creates one, so a hook on pipeline creation would never learn it is broken.
    const f = fakeRenderer();
    const watch = installPipelineWatch(f.renderer as never)!;
    const first = front(), second = front();
    const roFirst = f.ro(first, 'same-program');
    f.pipelines.getForRender(roFirst);
    f.fail(roFirst.pipeline!);
    f.pipelines.getForRender(f.ro(second, 'same-program'));
    expect(watch.failure(first)).toBe(PIPELINE_FAILED_REASON);
    expect(watch.failure(second)).toBe(PIPELINE_FAILED_REASON);
  });

  it('any failing pipeline of a material counts (one material, several render contexts)', () => {
    const f = fakeRenderer();
    const watch = installPipelineWatch(f.renderer as never)!;
    const material = front();
    const r1 = f.ro(material, 'ctx-1'), r2 = f.ro(material, 'ctx-2');
    f.pipelines.getForRender(r1);
    f.pipelines.getForRender(r2);
    expect(watch.failure(material)).toBeNull();
    f.fail(r2.pipeline!);
    expect(watch.failure(material)).toBe(PIPELINE_FAILED_REASON);
  });

  it('sees the async (compileAsync) failure once the compile promises have settled', async () => {
    // three's async path: the creation promise is pushed into `promises`, sets error, then RESOLVES.
    const f = fakeRenderer((_ro, pipeline, promises) => {
      promises!.push(new Promise<void>((resolve) => setTimeout(() => { f.fail(pipeline); resolve(); }, 0)));
    });
    const watch = installPipelineWatch(f.renderer as never)!;
    const material = front(), promises: Promise<void>[] = [];
    f.pipelines.getForRender(f.ro(material), promises);
    expect(watch.failure(material)).toBeNull(); // not settled yet
    await Promise.all(promises); // what compileAsync awaits: it resolves, it does not reject
    expect(watch.failure(material)).toBe(PIPELINE_FAILED_REASON);
  });

  it('is idempotent per renderer: one wrap, the same watch, current() follows', () => {
    const f = fakeRenderer();
    const first = installPipelineWatch(f.renderer as never)!;
    const wrapped = f.pipelines.getForRender;
    const second = installPipelineWatch(f.renderer as never)!;
    expect(second).toBe(first);
    expect(f.pipelines.getForRender).toBe(wrapped);
    f.pipelines.getForRender(f.ro(front()));
    expect(f.calls).toHaveLength(1);
    expect(currentPipelineWatch()).toBe(first);
  });

  it('does not throw on a render object without a material or a pipeline', () => {
    const f = fakeRenderer();
    installPipelineWatch(f.renderer as never);
    expect(() => f.pipelines.getForRender({ material: undefined as never, pipeline: null })).not.toThrow();
    const noPipeline = f.ro(front());
    const original = f.pipelines.getForRender;
    expect(() => original.call(f.pipelines, noPipeline)).not.toThrow();
  });
});
