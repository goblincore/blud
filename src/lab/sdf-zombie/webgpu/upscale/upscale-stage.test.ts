import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createUpscaleStage, upscaleInfoOf } from './upscale-stage';
import { createUpscaleModel } from './upscale-model';

function fakeRenderer() {
  const calls: { target: THREE.RenderTarget | null; autoClear: boolean }[] = [];
  let current: THREE.RenderTarget | null = null;
  const r = {
    autoClear: true,
    getRenderTarget: () => current,
    setRenderTarget: (t: THREE.RenderTarget | null) => { current = t; },
    render: () => { calls.push({ target: current, autoClear: r.autoClear }); },
  };
  return { renderer: r as unknown as THREE.WebGPURenderer, calls, raw: r };
}

describe('upscale stage wiring', () => {
  it('culls default-model tiles, resizes partial edge tiles, and can restore dense execution', async () => {
    const config = { model: 't16', layout: 'sp', inputs: 'rgb', seed: 1 } as const;
    const stage = createUpscaleStage(config, new THREE.Texture(), uniform(1));
    const dense = createUpscaleStage(config, new THREE.Texture(), uniform(1), undefined, undefined, undefined, undefined, { emptyTileCulling: false });
    stage.setSize(401, 301, 802, 602);
    expect(upscaleInfoOf(stage).emptyTileCulling).toBe(true);
    const masks = ['occupiedTiles', 'activeTiles'].map(name => stage.targetFor(name));
    expect(masks.map(t => [t.width, t.height])).toEqual([[51, 38], [51, 38]]);
    expect(masks.every(t => t.texture.type === THREE.UnsignedByteType)).toBe(true);
    expect(stage.targetFor('L4a').width).toBe(401);
    expect(stage.output.width).toBe(802);
    const { renderer, calls } = fakeRenderer();
    stage.render(renderer, new THREE.OrthographicCamera(), new THREE.PerspectiveCamera());
    expect(calls.slice(0, 2).map(c => c.target)).toEqual(masks);
    stage.setEmptyTileCulling(false);
    calls.length = 0;
    stage.render(renderer, new THREE.OrthographicCamera(), new THREE.PerspectiveCamera());
    expect(calls).toHaveLength(dense.passes.length);
    expect(calls.every(c => !masks.includes(c.target!))).toBe(true);
    stage.setEmptyTileCulling(true);
    expect(stage.emptyTileCulling).toBe(true);
    dense.setEmptyTileCulling(true);
    expect(dense.emptyTileCulling).toBe(false);
    const released = masks.map(t => vi.spyOn(t, 'dispose'));
    stage.dispose(); dense.dispose();
    expect(released.every(spy => spy.mock.calls.length === 1)).toBe(true);
  });

  it('allocates half-float MRT feature targets at low res and one RGBA32F output at full res', () => {
    const stage = createUpscaleStage({ model: 's32', layout: 'sp', inputs: 'rgb', seed: 1 }, new THREE.Texture(), uniform(1));
    stage.setSize(400, 300, 800, 600);
    expect(stage.passes.map((p) => p.name)).toEqual(['L1a', 'L1b', 'L2a', 'L2b', 'L3a', 'shuffle']);
    const l1 = stage.targetFor('L1a');
    expect(l1.textures.map((t) => t.name)).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(l1.textures.every((t) => t.type === THREE.HalfFloatType)).toBe(true);
    expect([l1.width, l1.height]).toEqual([400, 300]);
    expect(stage.targetFor('shuffle')).toBe(stage.output);
    expect(stage.output.texture.type).toBe(THREE.FloatType);
    expect([stage.output.width, stage.output.height]).toEqual([800, 600]);
    const s8 = createUpscaleStage({ model: 's8', layout: 'dc', inputs: 'rgbd', seed: 1 }, new THREE.Texture(), uniform(1));
    expect(s8.targetFor('L1a').textures).toHaveLength(2);
    expect(() => s8.targetFor('nope')).toThrow(/no pass/);
    stage.dispose();
    s8.dispose();
  });

  it('precompiles every pass in its own target, plus the sharpen pass even at sharpen 0', async () => {
    const stage = createUpscaleStage({ model: 's16', layout: 'dc', inputs: 'rgb', seed: 2 }, new THREE.Texture(), uniform(1));
    stage.setSize(400, 300, 800, 600);
    const { renderer, raw } = fakeRenderer();
    const seen: (THREE.RenderTarget | null)[] = [];
    (raw as unknown as Record<string, unknown>).compileAsync = async () => { seen.push(raw.getRenderTarget()); };
    const before = new THREE.RenderTarget(2, 2);
    raw.setRenderTarget(before);
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);

    const n = await stage.precompile(renderer, quadCam);

    // Every pass, and the sharpen pass on top — the pass count is the
    // network's passes + 1 even though sharpen is 0 and does not run.
    expect(n).toBe(stage.passes.length + 1);
    expect(seen).toHaveLength(stage.passes.length + 1);
    // Each compile happened in the target that pass really writes, not the
    // canvas: the pipeline cache key carries the attachment formats.
    stage.passes.forEach((spec, k) => { expect(seen[k]).toBe(stage.targetFor(spec.name)); });
    expect(seen[seen.length - 1]).toBe(stage.output);
    expect(raw.getRenderTarget()).toBe(before);
    stage.dispose();
    before.dispose();
  });

  it('renders every pass in order with autoClear off, then restores renderer state', () => {
    const stage = createUpscaleStage({ model: 's16', layout: 'dc', inputs: 'rgb', seed: 2 }, new THREE.Texture(), uniform(1));
    stage.setSize(400, 300, 800, 600);
    const { renderer, calls, raw } = fakeRenderer();
    const previous = new THREE.RenderTarget(2, 2);
    raw.setRenderTarget(previous);
    stage.render(renderer, new THREE.OrthographicCamera(), new THREE.PerspectiveCamera(75, 4 / 3, 0.05, 200));
    expect(calls.map((c) => c.target)).toEqual(stage.passes.map((p) => stage.targetFor(p.name)));
    expect(calls.every((c) => c.autoClear === false)).toBe(true);
    expect(raw.autoClear).toBe(true);
    expect(raw.getRenderTarget()).toBe(previous);
    stage.dispose();
  });

  it('reports info, and null when off', () => {
    const stage = createUpscaleStage({ model: 's8', layout: 'sp', inputs: 'rgb', seed: 5 }, new THREE.Texture(), uniform(1));
    stage.setSize(400, 300, 800, 600);
    const info = upscaleInfoOf(stage);
    expect(info).toMatchObject({ on: true, model: 's8', layout: 'sp', inputs: 'rgb', seed: 5, inSize: { width: 400, height: 300 }, outSize: { width: 800, height: 600 } });
    expect(info.weightHash).toMatch(/^[0-9a-f]{8}$/);
    expect(info.passes).toEqual(['L1a', 'L2a', 'L3a', 'shuffle']);
    expect(upscaleInfoOf(null)).toMatchObject({ on: false, model: null, passes: [] });
    stage.dispose();
  });

  it('dispose releases every target', () => {
    const stage = createUpscaleStage({ model: 's8', layout: 'sp', inputs: 'rgb', seed: 1 }, new THREE.Texture(), uniform(1));
    const spies = stage.passes.map((p) => vi.spyOn(stage.targetFor(p.name), 'dispose'));
    stage.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });

  it('uses trained weights when given, reports their provenance, and refuses a mismatched model', () => {
    const trained = { ...createUpscaleModel('s16', 'rgbd', 4), source: 'trained' as const, run: 's16-rgbd', step: 1200 };
    const stage = createUpscaleStage({ model: 's16', layout: 'sp', inputs: 'rgbd', seed: 1 }, new THREE.Texture(), uniform(1), trained);
    expect(stage.model).toBe(trained);
    expect(upscaleInfoOf(stage)).toMatchObject({ source: 'trained', run: 's16-rgbd', step: 1200, weightHash: trained.weightHash });
    stage.dispose();
    const random = createUpscaleStage({ model: 's8', layout: 'sp', inputs: 'rgb', seed: 1 }, new THREE.Texture(), uniform(1));
    expect(upscaleInfoOf(random)).toMatchObject({ source: 'random', run: null, step: null });
    random.dispose();
    expect(upscaleInfoOf(null)).toMatchObject({ source: null, run: null, step: null });
    expect(() => createUpscaleStage({ model: 's16', layout: 'sp', inputs: 'rgb', seed: 1 }, new THREE.Texture(), uniform(1), trained))
      .toThrow(/does not match/);
  });
});

describe('upscale post-sharpen', () => {
  it('off: no extra pass and the network writes output; on: network writes netOut, sharpen writes output', () => {
    const stage = createUpscaleStage({ model: 's8', layout: 'sp', inputs: 'rgb', seed: 2 }, new THREE.Texture(), uniform(1));
    stage.setSize(400, 300, 800, 600);
    expect(stage.sharpen).toBe(0);
    expect(stage.targetFor('shuffle')).toBe(stage.output);
    let { renderer, calls } = fakeRenderer();
    stage.render(renderer, new THREE.OrthographicCamera(), new THREE.PerspectiveCamera());
    expect(calls).toHaveLength(stage.passes.length);
    expect(calls[calls.length - 1]!.target).toBe(stage.output);

    stage.setSharpen(0.5);
    expect(stage.sharpen).toBe(0.5);
    expect(stage.targetFor('shuffle')).not.toBe(stage.output);
    expect([stage.targetFor('shuffle').width, stage.targetFor('shuffle').height]).toEqual([800, 600]);
    ({ renderer, calls } = fakeRenderer());
    stage.render(renderer, new THREE.OrthographicCamera(), new THREE.PerspectiveCamera());
    expect(calls).toHaveLength(stage.passes.length + 1);
    expect(calls[calls.length - 2]!.target).toBe(stage.targetFor('shuffle'));
    expect(calls[calls.length - 1]!.target).toBe(stage.output);
    expect(upscaleInfoOf(stage).sharpen).toBe(0.5);
    stage.setSharpen(7); expect(stage.sharpen).toBe(4);
    expect(stage.sharpenMode).toBe('cas'); stage.setSharpenMode('unsharp'); expect(stage.sharpenMode).toBe('unsharp');
    expect(upscaleInfoOf(stage).sharpenMode).toBe('unsharp');
    stage.setSharpen(NaN); expect(stage.sharpen).toBe(0);
    stage.dispose();
  });
});

describe('run-4 head in the stage', () => {
  it('needs a detail texture, sizes H1 at output res, and writes output from H2', () => {
    const cfg = { model: 's8', layout: 'sp', inputs: 'rgbn', seed: 1, head: true } as const;
    expect(() => createUpscaleStage(cfg, new THREE.Texture(), uniform(1), undefined, new THREE.Texture())).toThrow(/needs the detail field/);
    const stage = createUpscaleStage(cfg, new THREE.Texture(), uniform(1), undefined, new THREE.Texture(), new THREE.Texture());
    stage.setSize(400, 300, 800, 600);
    expect(stage.passes.map((p) => p.name)).toEqual(['L1a', 'L2a', 'L3a', 'shuffle', 'H1', 'H2']);
    expect([stage.targetFor('H1').width, stage.targetFor('H1').height]).toEqual([800, 600]);
    expect(stage.targetFor('H1').textures).toHaveLength(2);
    expect([stage.targetFor('shuffle').width, stage.targetFor('shuffle').height]).toEqual([800, 600]);
    expect(stage.targetFor('shuffle')).not.toBe(stage.output);
    expect(stage.targetFor('H2')).toBe(stage.output);
    expect(upscaleInfoOf(stage).head).toBe(true);
    stage.dispose();
  });

  it('a detail+refine model needs the refine textures and reports headInputs', () => {
    const cfg = { model: 's8', layout: 'sp', inputs: 'rgbn', seed: 1, head: true, headInputs: 'detail+refine' } as const;
    expect(() => createUpscaleStage(cfg, new THREE.Texture(), uniform(1), undefined, new THREE.Texture(), new THREE.Texture())).toThrow(/needs the refine textures/);
    const stage = createUpscaleStage(cfg, new THREE.Texture(), uniform(1), undefined, new THREE.Texture(), new THREE.Texture(), { n: new THREE.Texture(), c: new THREE.Texture() });
    expect(upscaleInfoOf(stage).headInputs).toBe('detail+refine');
    expect(upscaleInfoOf(null).headInputs).toBeNull();
  });
});
