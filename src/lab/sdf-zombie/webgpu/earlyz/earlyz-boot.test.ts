import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import { applyEarlyzRenderOrder, bootEarlyz, degradeFailedEarlyzFronts } from './earlyz-boot';
import { BACK_BATCH_BASE, FRONT_BATCH_BASE } from './type-order';
import { installConservativeDepthPatch, detectConservativeDepth } from './conservative-depth-patch';
import { installPipelineWatch } from './pipeline-watch';
import type { GameContext } from '../game-context';

// The patch module touches three's builder prototype and the GPU; the boot glue only needs
// its two answers, so replace them.
vi.mock('./conservative-depth-patch', () => ({
  installConservativeDepthPatch: vi.fn(),
  detectConservativeDepth: vi.fn(),
}));

// Same for the pipeline watch: it wraps backend.createRenderPipeline (its own tests are in
// pipeline-watch.test.ts); here only whether the boot got a watch matters.
vi.mock('./pipeline-watch', () => ({
  installPipelineWatch: vi.fn(),
  currentPipelineWatch: vi.fn(() => null),
  PIPELINE_FAILED_REASON: 'pipeline errored',
}));

const fake = (nearestBack: number, nearestFront: number, front = true) => ({
  mesh: new THREE.Mesh(),
  frontMesh: front ? new THREE.Mesh() : null,
  earlyzBatches: () => ({ front: 1, back: 1, nearestBack, nearestFront }),
});

describe('applyEarlyzRenderOrder', () => {
  it('writes the ranks onto the back and front meshes', () => {
    const a = fake(Infinity, 5), b = fake(0.3, 2);
    applyEarlyzRenderOrder(new Map([['a', a], ['b', b]]) as never);
    expect(b.mesh.renderOrder).toBe(BACK_BATCH_BASE);
    expect(b.frontMesh!.renderOrder).toBe(FRONT_BATCH_BASE);
    expect(a.mesh.renderOrder).toBe(BACK_BATCH_BASE + 1);
    expect(a.frontMesh!.renderOrder).toBe(FRONT_BATCH_BASE + 1);
  });

  it('ranks a type with no front mesh (quad dispatch) on its back mesh and leaves the others alone', () => {
    const a = fake(Infinity, 5), b = fake(0.3, 2), c = fake(1, Infinity, false);
    applyEarlyzRenderOrder(new Map([['a', a], ['b', b], ['c', c]]) as never);
    expect(c.frontMesh).toBeNull();
    expect(b.mesh.renderOrder).toBe(BACK_BATCH_BASE);
    expect(c.mesh.renderOrder).toBe(BACK_BATCH_BASE + 1);
    expect(a.mesh.renderOrder).toBe(BACK_BATCH_BASE + 2);
    // The front ranks still count c (its nearestFront is Infinity), so it sorts last.
    expect(b.frontMesh!.renderOrder).toBe(FRONT_BATCH_BASE);
    expect(a.frontMesh!.renderOrder).toBe(FRONT_BATCH_BASE + 1);
  });
});

describe('bootEarlyz', () => {
  type Listener = (e: { error: { message: string } }) => void;
  const install = vi.mocked(installConservativeDepthPatch);
  const detect = vi.mocked(detectConservativeDepth);
  const watchInstall = vi.mocked(installPipelineWatch);
  let warn: ReturnType<typeof vi.spyOn>;
  let info: ReturnType<typeof vi.spyOn>;

  function makeCtx(backend: unknown) {
    const earlyz = { flag: false, on: false, reason: null as string | null, gpuErrors: [] as string[] };
    const ctx = { crowd: { earlyz }, boot: { handle: { renderer: { backend } } } } as unknown as GameContext;
    return { ctx, earlyz };
  }
  function makeDevice() {
    const listeners: Listener[] = [];
    const device = {
      addEventListener: vi.fn((type: string, f: Listener) => { if (type === 'uncapturederror') listeners.push(f); }),
    };
    return { device, fire: (m: string) => listeners.forEach((f) => f({ error: { message: m } })) };
  }

  beforeEach(() => {
    install.mockReset();
    detect.mockReset();
    watchInstall.mockReset();
    watchInstall.mockReturnValue({ failure: () => null });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('stays off when the patch is refused, without touching the device', async () => {
    install.mockReturnValue({ installed: false, reason: 'three r999; the patch is written for r186' });
    const { device } = makeDevice();
    const { ctx, earlyz } = makeCtx({ device });
    await bootEarlyz(ctx);
    expect(earlyz).toMatchObject({ flag: true, on: false, reason: 'three r999; the patch is written for r186' });
    expect(device.addEventListener).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays off when the backend has no device (or no backend)', async () => {
    install.mockReturnValue({ installed: true, reason: null });
    for (const backend of [{}, { device: null }, undefined]) {
      warn.mockClear();
      const { ctx, earlyz } = makeCtx(backend);
      await bootEarlyz(ctx);
      expect(earlyz).toMatchObject({ flag: true, on: false, reason: 'no GPUDevice on the renderer backend' });
      expect(warn).toHaveBeenCalledTimes(1);
    }
    expect(detect).not.toHaveBeenCalled();
  });

  it('stays off with the detector reason when the browser rejects the probe', async () => {
    install.mockReturnValue({ installed: true, reason: null });
    detect.mockResolvedValue({ ok: false, reason: 'compile: unknown builtin' });
    const { device } = makeDevice();
    const { ctx, earlyz } = makeCtx({ device });
    await bootEarlyz(ctx);
    expect(earlyz).toMatchObject({ flag: true, on: false, reason: 'compile: unknown builtin' });
    expect(detect).toHaveBeenCalledWith(device);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
  });

  it('stays off when the backend cannot be observed for failed pipelines (never run early-Z blind)', async () => {
    install.mockReturnValue({ installed: true, reason: null });
    detect.mockResolvedValue({ ok: true, reason: null });
    watchInstall.mockReturnValue(null);
    const { device } = makeDevice();
    const backend = { device };
    const { ctx, earlyz } = makeCtx(backend);
    await bootEarlyz(ctx);
    expect(watchInstall).toHaveBeenCalledWith(ctx.boot.handle.renderer);
    expect(earlyz).toMatchObject({ flag: true, on: false, reason: 'cannot observe pipeline creation on this backend' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
  });

  it('turns on with a null reason when detection succeeds', async () => {
    install.mockReturnValue({ installed: true, reason: null });
    detect.mockResolvedValue({ ok: true, reason: null });
    const { device } = makeDevice();
    const { ctx, earlyz } = makeCtx({ device });
    await bootEarlyz(ctx);
    expect(earlyz).toMatchObject({ flag: true, on: true, reason: null });
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never blocks the boot: a throw from the patch, the detector or the device leaves it off with one warn', async () => {
    install.mockImplementationOnce(() => { throw new Error('patch boom'); });
    const first = makeCtx({ device: makeDevice().device });
    await expect(bootEarlyz(first.ctx)).resolves.toBeUndefined();
    expect(first.earlyz).toMatchObject({ flag: true, on: false, reason: 'threw: Error: patch boom' });
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockClear();
    install.mockReturnValue({ installed: true, reason: null });
    detect.mockRejectedValue(new Error('detect boom'));
    const second = makeCtx({ device: makeDevice().device });
    await expect(bootEarlyz(second.ctx)).resolves.toBeUndefined();
    expect(second.earlyz).toMatchObject({ on: false, reason: 'threw: Error: detect boom' });
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockClear();
    const badDevice = { addEventListener: () => { throw new Error('listener boom'); } };
    const third = makeCtx({ device: badDevice });
    await expect(bootEarlyz(third.ctx)).resolves.toBeUndefined();
    expect(third.earlyz).toMatchObject({ on: false, reason: 'threw: Error: listener boom' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('records uncaptured GPU errors and caps them at 20', async () => {
    install.mockReturnValue({ installed: true, reason: null });
    detect.mockResolvedValue({ ok: true, reason: null });
    const { device, fire } = makeDevice();
    const { ctx, earlyz } = makeCtx({ device });
    await bootEarlyz(ctx);
    expect(device.addEventListener).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 25; i++) fire(`err ${i}`);
    expect(earlyz.gpuErrors).toHaveLength(20);
    expect(earlyz.gpuErrors[0]).toBe('err 0');
    expect(earlyz.gpuErrors[19]).toBe('err 19');
  });
});

describe('degradeFailedEarlyzFronts (front pipeline failure -> back batch)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  /** A type double with the three CrowdType members the glue touches. */
  function fakeType(name: string, front = true) {
    const frontMesh = front ? new THREE.Mesh() : null;
    let disabled: string | null = null;
    return {
      name, frontMesh,
      earlyzFrontDisabled: () => disabled,
      disableEarlyzFront: vi.fn((r: string) => { if (disabled === null) disabled = r; }),
    };
  }
  const failing = (...meshes: (THREE.Mesh | null)[]) => ({
    failure: vi.fn((m: object) => (meshes.some((x) => x && x.material === m) ? 'pipeline errored' : null)),
  });

  it('disables only the type whose front pipeline failed, records the reason and warns once', () => {
    const a = fakeType('zombie'), b = fakeType('imp');
    const state = { reason: null as string | null };
    const out = degradeFailedEarlyzFronts(new Map([['z@1', a], ['i@1', b]]) as never, state, failing(a.frontMesh));
    expect(out).toEqual(['zombie']);
    expect(a.disableEarlyzFront).toHaveBeenCalledWith('front pipeline failed for zombie: pipeline errored');
    expect(b.disableEarlyzFront).not.toHaveBeenCalled();
    expect(state.reason).toBe('front pipeline failed for zombie: pipeline errored');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^\[earlyz\] front pipeline failed for zombie/);
  });

  it('is quiet on later calls: an already-disabled type is not re-reported', () => {
    const a = fakeType('zombie');
    const state = { reason: null as string | null };
    const types = new Map([['z@1', a]]) as never;
    const watch = failing(a.frontMesh);
    degradeFailedEarlyzFronts(types, state, watch);
    warn.mockClear();
    expect(degradeFailedEarlyzFronts(types, state, watch)).toEqual([]);
    expect(a.disableEarlyzFront).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves healthy types, types without a front mesh and a missing watch alone', () => {
    const healthy = fakeType('zombie'), quad = fakeType('imp', false);
    const state = { reason: null as string | null };
    const types = new Map([['z@1', healthy], ['i@1', quad]]) as never;
    expect(degradeFailedEarlyzFronts(types, state, failing())).toEqual([]);
    expect(degradeFailedEarlyzFronts(types, state, null)).toEqual([]);
    expect(healthy.disableEarlyzFront).not.toHaveBeenCalled();
    expect(quad.disableEarlyzFront).not.toHaveBeenCalled();
    expect(state.reason).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks the watch about the FRONT material of each type', () => {
    const a = fakeType('zombie');
    const watch = failing();
    degradeFailedEarlyzFronts(new Map([['z@1', a]]) as never, { reason: null }, watch);
    expect(watch.failure).toHaveBeenCalledWith(a.frontMesh!.material);
  });
});
