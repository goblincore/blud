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
