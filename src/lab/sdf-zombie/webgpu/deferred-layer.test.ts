import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createDeferredLayer, type DeferredLayer } from './deferred-layer';
import { MAX_DEFERRED_LIGHTS, type DeferredLight } from './deferred-lighting';
import { SURFACE_ATTACHMENT_NAMES } from './deferred-surface';

/** Minimal renderer stand-in: the layer must only ever use this surface. */
function mockRenderer(limits?: Record<string, number>) {
  let current: THREE.RenderTarget | null = null;
  const render = vi.fn();
  const renderer = {
    autoClear: true,
    getRenderTarget: () => current,
    setRenderTarget: (t: THREE.RenderTarget | null) => { current = t; },
    render,
    ...(limits
      ? { backend: { isWebGPUBackend: true, device: { limits } } }
      : {}),
  } as unknown as THREE.WebGPURenderer;
  return { renderer, render, getCurrent: () => current };
}

const light: DeferredLight = {
  kind: 'point',
  position: [0, 2, 0] as const,
  direction: [0, -1, 0] as const,
  color: [1, 1, 1] as const,
  intensity: 1,
  range: 10,
  cosInner: 1,
  cosOuter: 0,
};

describe('createDeferredLayer targets', () => {
  it('allocates mesh/resolved/lit at full size and sdf at the scaled size', () => {
    const { renderer } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 960, height: 540, sdfScale: 0.5 });
    try {
      expect(layer.targets.mesh.width).toBe(960);
      expect(layer.targets.mesh.height).toBe(540);
      expect(layer.targets.sdf.width).toBe(480);
      expect(layer.targets.sdf.height).toBe(270);
      expect(layer.targets.resolved.width).toBe(960);
      expect(layer.targets.lit.width).toBe(960);
      for (const name of SURFACE_ATTACHMENT_NAMES) {
        expect(layer.targets.mesh.textures.map((t) => t.name)).toContain(name);
        expect(layer.targets.sdf.textures.map((t) => t.name)).toContain(name);
        expect(layer.targets.resolved.textures.map((t) => t.name)).toContain(name);
      }
    } finally {
      layer.dispose();
    }
  });

  it('rejects invalid construction sizes and scales', () => {
    const { renderer } = mockRenderer();
    expect(() => createDeferredLayer(renderer, { width: 0, height: 540, sdfScale: 1 })).toThrow();
    expect(() => createDeferredLayer(renderer, { width: 960, height: 540, sdfScale: 0 })).toThrow();
    expect(() => createDeferredLayer(renderer, { width: 960, height: Number.NaN, sdfScale: 1 })).toThrow();
  });

  it('resize reallocates every target and tracks the new scale', () => {
    const { renderer } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 960, height: 540, sdfScale: 1 });
    try {
      layer.resize(640, 360, 0.5);
      expect(layer.targets.mesh.width).toBe(640);
      expect(layer.targets.sdf.width).toBe(320);
      expect(layer.targets.sdf.height).toBe(180);
      expect(layer.targets.resolved.height).toBe(360);
      expect(layer.diagnostics().sdfScale).toBe(0.5);
      expect(layer.diagnostics().sdfTargetSize).toEqual({ width: 320, height: 180 });
      expect(() => layer.resize(0, 10, 1)).toThrow();
      expect(() => layer.resize(10, 10, Number.NaN)).toThrow();
    } finally {
      layer.dispose();
    }
  });
});

describe('adapter limit validation', () => {
  it('passes (and reports) when the mocked device meets the attachment budget', () => {
    const { renderer } = mockRenderer({ maxColorAttachments: 8, maxColorAttachmentBytesPerSample: 32 });
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const d = layer.diagnostics();
      expect(d.limits.supported).toBe(true);
      expect(d.limits.ok).toBe(true);
      expect(d.limits.checks).toEqual([
        { name: 'maxColorAttachments', required: 4, actual: 8 },
        { name: 'maxColorAttachmentBytesPerSample', required: 28, actual: 32 },
      ]);
    } finally {
      layer.dispose();
    }
  });

  it('rejects explicitly when the device cannot fit the G-buffer', () => {
    const { renderer } = mockRenderer({ maxColorAttachments: 2, maxColorAttachmentBytesPerSample: 32 });
    expect(() => createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 })).toThrow(/maxColorAttachments/);
    const { renderer: r2 } = mockRenderer({ maxColorAttachments: 8, maxColorAttachmentBytesPerSample: 16 });
    expect(() => createDeferredLayer(r2, { width: 64, height: 64, sdfScale: 1 })).toThrow(/maxColorAttachmentBytesPerSample/);
  });

  it('reports limits as unchecked (not failed) without a device', () => {
    const { renderer } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const d = layer.diagnostics();
      expect(d.limits.supported).toBe(false);
      expect(d.limits.ok).toBe(true);
      expect(d.limits.checks).toEqual([]);
    } finally {
      layer.dispose();
    }
  });
});

describe('render pass sequencing and state restore', () => {
  it('renders producers, resolve, light and present passes, restoring renderer state', () => {
    const { renderer, render } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const meshScene = new THREE.Scene();
      const sdfScene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      camera.layers.set(3);
      const mask = camera.layers.mask;

      layer.render(meshScene, sdfScene, camera);

      // clear-mesh, mesh, clear-sdf, sdf, resolve, light, present.
      expect(render).toHaveBeenCalledTimes(7);
      expect(render.mock.calls[1]![0]).toBe(meshScene);
      expect(render.mock.calls[3]![0]).toBe(sdfScene);
      // The final present pass targets the canvas.
      expect(renderer.getRenderTarget()).toBeNull();
      expect(renderer.autoClear).toBe(true);
      expect(camera.layers.mask).toBe(mask);
    } finally {
      layer.dispose();
    }
  });

  it('restores render target and autoClear even when a pass throws', () => {
    const { renderer, render, getCurrent } = mockRenderer();
    const previousTarget = new THREE.RenderTarget(2, 2);
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = false;
    render.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('boom'); });

    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      expect(() => layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera())).toThrow('boom');
      expect(getCurrent()).toBe(previousTarget);
      expect(renderer.autoClear).toBe(false);
    } finally {
      layer.dispose();
      previousTarget.dispose();
    }
  });
});

describe('lights and debug view controls', () => {
  function withLayer(fn: (layer: DeferredLayer) => void) {
    const { renderer } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      fn(layer);
    } finally {
      layer.dispose();
    }
  }

  it('setLights updates diagnostics and rejects overflow', () => {
    withLayer((layer) => {
      expect(layer.diagnostics().lightCount).toBe(0);
      layer.setLights([light, { ...light, kind: 'spot' }]);
      expect(layer.diagnostics().lightCount).toBe(2);
      expect(() => layer.setLights(Array(MAX_DEFERRED_LIGHTS + 1).fill(light))).toThrow();
      // A failed set must not corrupt the previous state.
      expect(layer.diagnostics().lightCount).toBe(2);
      layer.setLights([]);
      expect(layer.diagnostics().lightCount).toBe(0);
    });
  });

  it('setDebugView accepts the five named views and rejects anything else', () => {
    withLayer((layer) => {
      for (const view of ['lit', 'albedo', 'normal', 'depth', 'material'] as const) {
        layer.setDebugView(view);
        expect(layer.diagnostics().debugView).toBe(view);
      }
      expect(() => layer.setDebugView('wireframe' as never)).toThrow();
      expect(layer.diagnostics().debugView).toBe('material');
    });
  });
});

describe('dispose', () => {
  it('disposes every owned target and refuses to render afterwards', () => {
    const { renderer } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    const spies: ReturnType<typeof vi.fn>[] = [];
    for (const t of [layer.targets.mesh, layer.targets.sdf, layer.targets.resolved, layer.targets.lit]) {
      const spy = vi.fn();
      t.addEventListener('dispose', spy);
      spies.push(spy);
    }
    layer.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(() => layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera())).toThrow(/disposed/);
    expect(() => layer.resize(32, 32, 1)).toThrow(/disposed/);
  });
});
