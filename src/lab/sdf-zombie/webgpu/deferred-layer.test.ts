import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  createDeferredLayer, DEFERRED_LIGHT_WGSL, DEFERRED_PRESENT_WGSL,
  type DeferredLayer, type DeferredFlashlightShadowBinding,
} from './deferred-layer';
import { MAX_DEFERRED_LIGHTS, type DeferredLight } from './deferred-lighting';
import { SURFACE_ATTACHMENT_NAMES } from './deferred-surface';

/** Minimal renderer stand-in: the layer must only ever use this surface. */
function mockRenderer(limits?: Record<string, number>) {
  let current: THREE.RenderTarget | null = null;
  let mrt: unknown = null;
  let clearDepth = 1;
  const render = vi.fn();
  const renderer = {
    autoClear: true,
    autoClearDepth: true,
    // Mirrors the real WebGPURenderer's getter (Renderer.js:863). The
    // coordinator-fix-2 test relies on it; everything else may ignore it.
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getRenderTarget: () => current,
    setRenderTarget: (t: THREE.RenderTarget | null) => { current = t; },
    getMRT: () => mrt,
    setMRT: (m: unknown) => { mrt = m; },
    getClearDepth: () => clearDepth,
    setClearDepth: (d: number) => { clearDepth = d; },
    render,
    ...(limits
      ? { backend: { isWebGPUBackend: true, device: { limits } } }
      : {}),
  } as unknown as THREE.WebGPURenderer;
  return {
    renderer, render,
    getCurrent: () => current,
    getMrt: () => mrt,
    setMrt: (m: unknown) => { mrt = m; },
    getClearDepth: () => clearDepth,
  };
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

describe('coordinator review fixes (2026-09-06, task1 commit 7c9974e8)', () => {
  it('fix 1: the light pass reconstructs NDC without a second pixel-center offset', () => {
    // screenCoordinate reaches WGSL as @builtin(position).xy, which ALREADY
    // carries the +0.5 pixel center. The old shader added another .5.
    expect(DEFERRED_LIGHT_WGSL).toContain('px.x / dims.x * 2.0 - 1.0');
    expect(DEFERRED_LIGHT_WGSL).toContain('1.0 - px.y / dims.y * 2.0');
    expect(DEFERRED_LIGHT_WGSL).not.toContain('px.x + 0.5');
    expect(DEFERRED_LIGHT_WGSL).not.toContain('px.y + 0.5');
  });

  it('fix 2: a fresh camera is synced to the WebGPU projection BEFORE the first pass', () => {
    const { renderer, render } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100);
      expect(camera.coordinateSystem).toBe(THREE.WebGLCoordinateSystem);
      const webglM33 = camera.projectionMatrix.elements[10];
      const seen: Array<{ pass: number; cs: unknown; m33: number }> = [];
      render.mockImplementation(() => {
        seen.push({
          pass: seen.length,
          cs: camera.coordinateSystem,
          m33: camera.projectionMatrix.elements[10]!,
        });
      });
      layer.render(new THREE.Scene(), new THREE.Scene(), camera);
      // Every pass — including the FIRST — must already see the WebGPU
      // projection (the inverse VP for the light pass is cached before pass
      // 1, so syncing later would poison frame 1).
      expect(seen.length).toBe(7);
      for (const s of seen) {
        expect(s.cs).toBe(THREE.WebGPUCoordinateSystem);
        expect(s.m33).not.toBe(webglM33);
      }
      // And it must be the projection three itself would compute.
      const ref = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100);
      ref.coordinateSystem = THREE.WebGPUCoordinateSystem;
      ref.updateProjectionMatrix();
      expect(camera.projectionMatrix.elements).toEqual(ref.projectionMatrix.elements);
    } finally {
      layer.dispose();
    }
  });

  it('fix 3: scene backgrounds are suppressed during producer passes and restored', () => {
    const { renderer, render } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const meshScene = new THREE.Scene();
      const sdfScene = new THREE.Scene();
      meshScene.background = new THREE.Color(0x112233);
      (meshScene as unknown as { backgroundNode?: unknown }).backgroundNode = { isNode: true };
      sdfScene.background = new THREE.Color(0x445566);
      const seen: Array<{ scene: unknown; background: unknown; backgroundNode: unknown }> = [];
      render.mockImplementation((scene: THREE.Scene) => {
        seen.push({
          scene,
          background: scene.background,
          backgroundNode: (scene as unknown as { backgroundNode?: unknown }).backgroundNode,
        });
      });
      layer.render(meshScene, sdfScene, new THREE.PerspectiveCamera());
      // Passes 1 and 3 (0-based) are the producer renders.
      expect(seen[1]!.scene).toBe(meshScene);
      expect(seen[1]!.background).toBeNull();
      expect(seen[1]!.backgroundNode).toBeNull();
      expect(seen[3]!.scene).toBe(sdfScene);
      expect(seen[3]!.background).toBeNull();
      expect(seen[3]!.backgroundNode).toBeNull();
      // Restored afterwards.
      expect((meshScene.background as THREE.Color).getHex()).toBe(0x112233);
      expect((meshScene as unknown as { backgroundNode?: unknown }).backgroundNode).toEqual({ isNode: true });
      expect((sdfScene.background as THREE.Color).getHex()).toBe(0x445566);
    } finally {
      layer.dispose();
    }
  });

  it('fix 3 (exception): backgrounds are restored even when a pass throws', () => {
    const { renderer, render } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const meshScene = new THREE.Scene();
      meshScene.background = new THREE.Color(0x112233);
      render.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => layer.render(meshScene, new THREE.Scene(), new THREE.PerspectiveCamera())).toThrow('boom');
      expect((meshScene.background as THREE.Color).getHex()).toBe(0x112233);
    } finally {
      layer.dispose();
    }
  });

  it('fix 4: a caller-level renderer MRT is detached for the owned passes and restored', () => {
    const { renderer, render, setMrt, getMrt } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const callerMrt = { caller: true };
      setMrt(callerMrt);
      const seenMrt: unknown[] = [];
      render.mockImplementation(() => { seenMrt.push(getMrt()); });
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera());
      expect(seenMrt.length).toBe(7);
      for (const m of seenMrt) expect(m).toBeNull();
      expect(getMrt()).toBe(callerMrt);

      // Exception path: still restored.
      setMrt(callerMrt);
      render.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera())).toThrow('boom');
      expect(getMrt()).toBe(callerMrt);
    } finally {
      layer.dispose();
    }
  });

  it('fix 5: hardware depth clearing is forced to depth 1 for producer clears, then restored', () => {
    const { renderer, render, getClearDepth } = mockRenderer();
    const layer = createDeferredLayer(renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      // The hostile caller state: sdf-layer's shell-exit pass leaves exactly
      // this combination behind.
      renderer.autoClearDepth = false;
      renderer.setClearDepth(0);
      const seen: Array<{ autoClearDepth: boolean; clearDepth: number }> = [];
      render.mockImplementation(() => {
        seen.push({ autoClearDepth: renderer.autoClearDepth, clearDepth: getClearDepth() });
      });
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera());
      expect(seen.length).toBe(7);
      for (const s of seen) {
        expect(s.autoClearDepth).toBe(true);
        expect(s.clearDepth).toBe(1);
      }
      expect(renderer.autoClearDepth).toBe(false);
      expect(getClearDepth()).toBe(0);

      // Exception path: still restored.
      render.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('boom'); });
      expect(() => layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera())).toThrow('boom');
      expect(renderer.autoClearDepth).toBe(false);
      expect(getClearDepth()).toBe(0);
    } finally {
      layer.dispose();
    }
  });
});

/** A per-pass recorder: captures renderer state at each render submission. */
function recordPasses(renderer: ReturnType<typeof mockRenderer>['renderer'], getCurrent: () => unknown) {
  const passes: Array<{ target: unknown; autoClear: boolean; autoClearDepth: boolean; clearDepth: number }> = [];
  (renderer.render as ReturnType<typeof vi.fn>).mockImplementation(() => {
    passes.push({
      target: getCurrent(),
      autoClear: renderer.autoClear,
      autoClearDepth: renderer.autoClearDepth,
      clearDepth: renderer.getClearDepth(),
    });
  });
  return passes;
}

describe('setOutputTarget (hybrid deferred M2 task 1)', () => {
  function makeLayer() {
    const m = mockRenderer();
    const layer = createDeferredLayer(m.renderer, { width: 64, height: 64, sdfScale: 1 });
    return { ...m, layer };
  }

  it('presents into the owned target, clearing it first, and restores caller state', () => {
    const { renderer, layer, getCurrent, getClearDepth } = makeLayer();
    try {
      const sceneTarget = new THREE.RenderTarget(64, 64);
      layer.setOutputTarget(sceneTarget);
      expect(layer.diagnostics().outputTargetActive).toBe(true);

      const passes = recordPasses(renderer, getCurrent);
      const callerTarget = new THREE.RenderTarget(2, 2);
      renderer.setRenderTarget(callerTarget);
      renderer.autoClear = false;
      renderer.autoClearDepth = false;
      renderer.setClearDepth(0);

      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera());

      // clear-mesh, mesh, clear-sdf, sdf, resolve, light, present — the LAST
      // submission must target the owned scene target WITH a clear enabled
      // (the destination depth reset the frame contract requires).
      expect(passes).toHaveLength(7);
      const present = passes[6]!;
      expect(present.target).toBe(sceneTarget);
      expect(present.autoClear).toBe(true);
      expect(present.autoClearDepth).toBe(true);
      expect(present.clearDepth).toBe(1);
      // And the caller's hostile state is fully restored afterwards.
      expect(getCurrent()).toBe(callerTarget);
      expect(renderer.autoClear).toBe(false);
      expect(renderer.autoClearDepth).toBe(false);
      expect(getClearDepth()).toBe(0);
      callerTarget.dispose();
    } finally {
      layer.dispose();
    }
  });

  it('setOutputTarget(null) restores the M1 canvas default', () => {
    const { renderer, layer, getCurrent } = makeLayer();
    try {
      const sceneTarget = new THREE.RenderTarget(64, 64);
      layer.setOutputTarget(sceneTarget);
      layer.setOutputTarget(null);
      expect(layer.diagnostics().outputTargetActive).toBe(false);
      const passes = recordPasses(renderer, getCurrent);
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera());
      expect(passes[6]!.target).toBeNull();
      sceneTarget.dispose();
    } finally {
      layer.dispose();
    }
  });

  it('rejects layer-owned targets and depth-less targets up front', () => {
    const { layer } = makeLayer();
    try {
      expect(() => layer.setOutputTarget(layer.targets.mesh)).toThrow(/own targets/);
      expect(() => layer.setOutputTarget(layer.targets.resolved)).toThrow(/own targets/);
      expect(() => layer.setOutputTarget(layer.targets.lit)).toThrow(/own targets/);
      expect(() => layer.setOutputTarget(layer.targets.sdf)).toThrow(/own targets/);
      const noDepth = new THREE.RenderTarget(8, 8, { depthBuffer: false });
      expect(() => layer.setOutputTarget(noDepth)).toThrow(/depth/);
      noDepth.dispose();
      expect(layer.diagnostics().outputTargetActive).toBe(false);
    } finally {
      layer.dispose();
    }
  });

  it('rejects a size-mismatched target at render time and recovers after the caller resizes', () => {
    const { renderer, layer, getCurrent } = makeLayer();
    try {
      const sceneTarget = new THREE.RenderTarget(32, 16);
      layer.setOutputTarget(sceneTarget);
      const passes = recordPasses(renderer, getCurrent);
      expect(() => layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera()))
        .toThrow(/size/);
      sceneTarget.setSize(64, 64);
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera());
      expect(passes.filter(Boolean).length).toBeGreaterThan(0);
      sceneTarget.dispose();
    } finally {
      layer.dispose();
    }
  });

  it('refuses setOutputTarget after dispose', () => {
    const { layer } = makeLayer();
    const sceneTarget = new THREE.RenderTarget(64, 64);
    layer.dispose();
    expect(() => layer.setOutputTarget(sceneTarget)).toThrow(/disposed/);
    sceneTarget.dispose();
  });
});

describe('target-present material depth config (task1 continuation regression)', () => {
  function makeLayer() {
    const m = mockRenderer();
    const layer = createDeferredLayer(m.renderer, { width: 64, height: 64, sdfScale: 1 });
    return { ...m, layer };
  }

  /** The material of the quad in the scene submitted to the renderer at
   *  `callIndex` — the ACTUAL object a real renderer would compile, not an
   *  internal reference. */
  function submittedMaterial(render: ReturnType<typeof vi.fn>, callIndex: number) {
    const scene = render.mock.calls[callIndex]![0] as THREE.Scene;
    const mats: Array<THREE.MeshBasicNodeMaterial> = [];
    for (const child of scene.children) {
      if ((child as THREE.Mesh).isMesh) mats.push((child as THREE.Mesh).material as THREE.MeshBasicNodeMaterial);
    }
    expect(mats).toHaveLength(1);
    return mats[0]!;
  }

  it('the owned-target presentation material reaches the renderer with depthWrite=true, fixed at construction', () => {
    // Regression (base 93904144): quadPass reset depthWrite=false AFTER the
    // material had been given depthWrite=true, so the only compile produced a
    // depth-less fragment shader and a forward quad behind the body painted
    // over it (task1-composition.json: behind afterLum 0.387 -> 4). A
    // NodeMaterial's fragment-depth output is selected at graph compile time
    // from depthWrite/depthNode — the flag must survive construction and hold
    // at the first render.
    const { render, layer } = makeLayer();
    try {
      const sceneTarget = new THREE.RenderTarget(64, 64);
      layer.setOutputTarget(sceneTarget);
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera());
      // 7 submissions: clear-mesh, mesh, clear-sdf, sdf, resolve, light, present.
      const mat = submittedMaterial(render, 6);
      expect(mat.depthWrite).toBe(true);
      expect(mat.depthTest).toBe(false);
      // The fragment-depth graph is actually wired, not just the flag.
      expect(mat.depthNode).not.toBeNull();
      expect(mat.depthNode).toBeDefined();
      sceneTarget.dispose();
    } finally {
      layer.dispose();
    }
  });

  it('the canvas presentation material stays depthless — the M1 default is untouched', () => {
    const { render, layer } = makeLayer();
    try {
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera());
      const mat = submittedMaterial(render, 6);
      expect(mat.depthWrite).toBe(false);
      expect(mat.depthNode).toBeNull();
    } finally {
      layer.dispose();
    }
  });

  it('depthWrite stays true across repeated renders and after setOutputTarget(null -> target)', () => {
    const { render, layer } = makeLayer();
    try {
      const sceneTarget = new THREE.RenderTarget(64, 64);
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera()); // canvas
      layer.setOutputTarget(sceneTarget);
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera()); // target
      layer.setOutputTarget(null);
      layer.render(new THREE.Scene(), new THREE.Scene(), new THREE.PerspectiveCamera()); // canvas again
      // Calls 1 and 3 are target-present (7 passes each), call 4 canvas.
      expect(submittedMaterial(render, 13).depthWrite).toBe(true);
      expect(submittedMaterial(render, 13).depthNode).not.toBeNull();
      expect(submittedMaterial(render, 20).depthWrite).toBe(false);
      expect(submittedMaterial(render, 20).depthNode).toBeNull();
      sceneTarget.dispose();
    } finally {
      layer.dispose();
    }
  });
});

describe('render draw hooks (hybrid deferred M2 task 1)', () => {
  function makeLayer() {
    const m = mockRenderer();
    const layer = createDeferredLayer(m.renderer, { width: 64, height: 64, sdfScale: 1 });
    return { ...m, layer };
  }

  it('hooks replace the scene renders, run once at their producer target with autoClear off', () => {
    const { renderer, layer, getCurrent, render } = makeLayer();
    try {
      // Recorded INSIDE each hook: the state the hook itself observes.
      const hookSeen: Array<{ target: unknown; autoClear: boolean }> = [];
      const drawMesh = vi.fn(() => { hookSeen.push({ target: getCurrent(), autoClear: renderer.autoClear }); });
      const drawSdf = vi.fn(() => { hookSeen.push({ target: getCurrent(), autoClear: renderer.autoClear }); });
      const meshScene = new THREE.Scene();
      const sdfScene = new THREE.Scene();
      layer.render(meshScene, sdfScene, new THREE.PerspectiveCamera(), { drawMesh, drawSdf });

      expect(drawMesh).toHaveBeenCalledTimes(1);
      expect(drawSdf).toHaveBeenCalledTimes(1);
      // Each hook ran at its OWN producer target, with the sentinel clear
      // already submitted and autoClear off — exactly the state the M1 scene
      // renders see.
      expect(hookSeen).toHaveLength(2);
      expect(hookSeen[0]!.target).toBe(layer.targets.mesh);
      expect(hookSeen[0]!.autoClear).toBe(false);
      expect(hookSeen[1]!.target).toBe(layer.targets.sdf);
      expect(hookSeen[1]!.autoClear).toBe(false);

      // 5 renderer passes: clear-mesh, clear-sdf, resolve, light, present.
      expect(render).toHaveBeenCalledTimes(5);
      for (const call of render.mock.calls) {
        expect(call[0]).not.toBe(meshScene);
        expect(call[0]).not.toBe(sdfScene);
      }
    } finally {
      layer.dispose();
    }
  });

  it('a hook on one producer leaves the other on the M1 scene render', () => {
    const { renderer, layer, render } = makeLayer();
    try {
      const drawSdf = vi.fn();
      const meshScene = new THREE.Scene();
      const sdfScene = new THREE.Scene();
      layer.render(meshScene, sdfScene, new THREE.PerspectiveCamera(), { drawSdf });
      expect(drawSdf).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledTimes(6); // clear-mesh, MESH, clear-sdf, resolve, light, present
      expect(render.mock.calls[1]![0]).toBe(meshScene);
    } finally {
      layer.dispose();
    }
  });

  it('a thrown draw hook propagates and restores every piece of renderer state', () => {
    const { renderer, layer, render, getCurrent, getMrt, getClearDepth, setMrt } = makeLayer();
    try {
      const meshScene = new THREE.Scene();
      meshScene.background = new THREE.Color(0x112233);
      const callerMrt = { caller: true };
      setMrt(callerMrt);
      renderer.autoClearDepth = false;
      renderer.setClearDepth(0);
      let calls = 0;
      const drawMesh = vi.fn(() => {
        calls++;
        throw new Error('hook boom');
      });
      expect(() => layer.render(meshScene, new THREE.Scene(), new THREE.PerspectiveCamera(), { drawMesh }))
        .toThrow('hook boom');
      expect(calls).toBe(1);
      // The state the layer mutated for its owned passes is back.
      expect(getCurrent()).toBeNull();
      expect(renderer.autoClear).toBe(true);
      expect(renderer.autoClearDepth).toBe(false);
      expect(getClearDepth()).toBe(0);
      expect(getMrt()).toBe(callerMrt);
      expect((meshScene.background as THREE.Color).getHex()).toBe(0x112233);
      // And the passes after the hook never ran.
      expect(render.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      layer.dispose();
    }
  });
});

describe('game environment (hybrid deferred M2 task 1)', () => {
  function makeLayer() {
    const m = mockRenderer();
    const layer = createDeferredLayer(m.renderer, { width: 64, height: 64, sdfScale: 1 });
    return { ...m, layer };
  }

  it('defaults to the M1 ambient with fog disabled, reported in diagnostics', () => {
    const { layer } = makeLayer();
    try {
      const env = layer.diagnostics().environment!;
      expect(env.ambient).toEqual([0.05, 0.05, 0.055]);
      expect(env.fogEnabled).toBe(false);
      expect(Number.isFinite(env.fogNear) && Number.isFinite(env.fogFar)).toBe(true);
      expect(env.fogFar).toBeGreaterThan(env.fogNear);
    } finally {
      layer.dispose();
    }
  });

  it('copies the caller environment (no aliasing) and reports it back', () => {
    const { layer } = makeLayer();
    try {
      const ambient = new THREE.Color(0.2, 0.1, 0.05);
      const fogColor = new THREE.Color(0.01, 0.02, 0.03);
      layer.setEnvironment({ ambient, fogColor, fogNear: 2, fogFar: 30, fogEnabled: true });
      ambient.setRGB(9, 9, 9);
      fogColor.setRGB(9, 9, 9);
      const env = layer.diagnostics().environment!;
      expect(env.ambient).toEqual([0.2, 0.1, 0.05]);
      expect(env.fogColor).toEqual([0.01, 0.02, 0.03]);
      expect(env.fogNear).toBe(2);
      expect(env.fogFar).toBe(30);
      expect(env.fogEnabled).toBe(true);
    } finally {
      layer.dispose();
    }
  });

  it('rejects invalid environments and keeps the previous one', () => {
    const { layer } = makeLayer();
    try {
      layer.setEnvironment({ ambient: new THREE.Color(0.1, 0.1, 0.1), fogColor: new THREE.Color(), fogNear: 2, fogFar: 30, fogEnabled: true });
      expect(() => layer.setEnvironment({ ambient: new THREE.Color(Number.NaN, 0, 0), fogColor: new THREE.Color(), fogNear: 1, fogFar: 10, fogEnabled: false })).toThrow();
      expect(() => layer.setEnvironment({ ambient: new THREE.Color(), fogColor: new THREE.Color(), fogNear: 10, fogFar: 10, fogEnabled: true })).toThrow(/fogFar/);
      expect(() => layer.setEnvironment({ ambient: new THREE.Color(), fogColor: new THREE.Color(), fogNear: 5, fogFar: Number.POSITIVE_INFINITY, fogEnabled: true })).toThrow();
      const env = layer.diagnostics().environment!;
      expect(env.fogNear).toBe(2);
      expect(env.fogFar).toBe(30);
    } finally {
      layer.dispose();
    }
  });

  it('fog and ambient exist ONLY in the lit stage — the surface/debug outputs never read them', () => {
    // Structural pin: the lit WGSL evaluates fog behind an explicit enable
    // gate; the present WGSL (albedo/normal/depth/material debug views) reads
    // neither ambient nor fog, so raw surface outputs stay unaffected.
    expect(DEFERRED_LIGHT_WGSL).toContain('fogEnabled');
    expect(DEFERRED_LIGHT_WGSL).toContain('fogNear');
    expect(DEFERRED_LIGHT_WGSL).toContain('distance(camPos, world)');
    expect(DEFERRED_PRESENT_WGSL).not.toContain('fog');
    expect(DEFERRED_PRESENT_WGSL).not.toContain('ambient');
  });

  it('the lit stage branches on the DECODED base class while the attachment keeps the raw encoding', () => {
    // emissionClass.a may carry the packed receiver bit (bit 4). Lighting and
    // the material debug view must decode it; nothing may rewrite the
    // attachment (the raw value selects the shadow map per receiver in task 4).
    expect(DEFERRED_LIGHT_WGSL).toContain('floor(cls / 16.0) * 16.0');
    expect(DEFERRED_PRESENT_WGSL).toContain('floor(cls / 16.0) * 16.0');
  });
});

describe('flashlight shadow sampling in the light stage (hybrid deferred M2 task 4)', () => {
  it('selects the shadow map by the RAW packed receiver bit, not the decoded class', () => {
    // Bit 4 set (>= 15.5) = level-only receiver -> the map WITHOUT the
    // inflated flesh proxies. The selection must use the raw packed value
    // (cls), never baseCls — a decoded class 2 would pick the wrong map.
    // (WGSL select() rejects texture handles, so both texels load and the
    // stored SCALAR is selected — pinned here so a rewrite to handle-select
    // fails in unit tests before it fails on device.)
    expect(DEFERRED_LIGHT_WGSL).toContain('let levelOnly = cls >= 15.5;');
    expect(DEFERRED_LIGHT_WGSL).toContain('select(storedFull, storedLevel, levelOnly)');
  });

  it('applies visibility ONLY to the designated flashlight contribution inside the loop', () => {
    // The multiplication is gated on BOTH the master enable and the light
    // index — a practical light must never be darkened by the flashlight's
    // map, and the whole block must be skippable when unshadowed.
    expect(DEFERRED_LIGHT_WGSL).toContain('shadowEnabled > 0.5 && f32(i) == shadowLightIndex');
    const loopStart = DEFERRED_LIGHT_WGSL.indexOf('for (var i = 0;');
    const gate = DEFERRED_LIGHT_WGSL.indexOf('shadowEnabled > 0.5 && f32(i) == shadowLightIndex');
    const ambient = DEFERRED_LIGHT_WGSL.indexOf('ambient * baseDiff');
    const emptyReturn = DEFERRED_LIGHT_WGSL.indexOf("return vec4<f32>(emission, 1.0)");
    // Ambient (added before the loop) and the empty-pixel emission return
    // both sit OUTSIDE the shadow multiplication (spec frame contract step 5).
    expect(ambient).toBeGreaterThan(-1);
    expect(ambient).toBeLessThan(loopStart);
    expect(emptyReturn).toBeGreaterThan(-1);
    expect(emptyReturn).toBeLessThan(loopStart);
    expect(gate).toBeGreaterThan(loopStart);
  });

  it('treats positions outside the valid shadow frustum as unoccluded', () => {
    expect(DEFERRED_LIGHT_WGSL).toContain('cp.w > 0.0');
    // The full [−1,1]x[−1,1] xy window and the open (0,1) depth range must
    // all be part of ONE unoccluded path returning to `contribution`
    // untouched — i.e. the frustum test guards the PCF, it never darkens.
    expect(DEFERRED_LIGHT_WGSL).toMatch(/sNdc\.x >= -1\.0 && sNdc\.x <= 1\.0 && sNdc\.y >= -1\.0 && sNdc\.y <= 1\.0 && sNdc\.z > 0\.0 && sNdc\.z < 1\.0/);
  });

  it('uses a bounded PCF of the named kernel size with the bias in the comparison', () => {
    expect(DEFERRED_LIGHT_WGSL).toContain('textureLoad(fullDepth, t, 0).x');
    expect(DEFERRED_LIGHT_WGSL).toContain('textureLoad(levelDepth, t, 0).x');
    expect(DEFERRED_LIGHT_WGSL).toContain('stored + shadowBias');
    // 3x3 manual comparisons (kernel radius 1), averaged over 9 samples.
    expect(DEFERRED_LIGHT_WGSL).toContain('for (var dy = -1; dy <= 1; dy = dy + 1)');
    expect(DEFERRED_LIGHT_WGSL).toContain('for (var dx = -1; dx <= 1; dx = dx + 1)');
    expect(DEFERRED_LIGHT_WGSL).toContain('lit / 9.0');
  });

  it('the shadow maps arrive as WGSL texture params alongside the M1 ones', () => {
    expect(DEFERRED_LIGHT_WGSL).toContain('fullDepth: texture_2d<f32>');
    expect(DEFERRED_LIGHT_WGSL).toContain('levelDepth: texture_2d<f32>');
    expect(DEFERRED_LIGHT_WGSL).toContain('shadowViewProj: mat4x4<f32>');
    expect(DEFERRED_LIGHT_WGSL).toContain('shadowMapSize: vec2<f32>');
  });

  it('a stored binding adds NO render submissions (sampling lives in the existing light pass)', () => {
    const m = mockRenderer();
    const layer = createDeferredLayer(m.renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const camera = new THREE.PerspectiveCamera();
      camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
      layer.render(new THREE.Scene(), new THREE.Scene(), camera);
      const unshadowed = m.render.mock.calls.length;
      const binding = {
        fullDepth: new THREE.Texture(),
        levelDepth: new THREE.Texture(),
        viewProjection: new THREE.Matrix4(),
        lightIndex: 0,
        bias: 0.0025,
        mapSize: new THREE.Vector2(1024, 1024),
        enabled: true,
      } satisfies DeferredFlashlightShadowBinding;
      layer.setFlashlightShadow(binding);
      layer.render(new THREE.Scene(), new THREE.Scene(), camera);
      expect(m.render.mock.calls.length).toBe(unshadowed * 2);
      expect(layer.diagnostics().flashlightShadowBound).toBe(true);
      expect(layer.diagnostics().flashlightShadowEnabled).toBe(true);
    } finally {
      layer.dispose();
    }
  });

  it('diagnostics distinguish bound-but-sampling-disabled (the diagnostic toggle)', () => {
    const m = mockRenderer();
    const layer = createDeferredLayer(m.renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const binding = {
        fullDepth: new THREE.Texture(),
        levelDepth: new THREE.Texture(),
        viewProjection: new THREE.Matrix4(),
        lightIndex: 0,
        bias: 0.0025,
        mapSize: new THREE.Vector2(1024, 1024),
        enabled: false,
      } satisfies DeferredFlashlightShadowBinding;
      layer.setFlashlightShadow(binding);
      const d = layer.diagnostics();
      expect(d.flashlightShadowBound).toBe(true);
      expect(d.flashlightShadowEnabled).toBe(false);
      layer.setFlashlightShadow(null);
      expect(layer.diagnostics().flashlightShadowEnabled).toBe(false);
    } finally {
      layer.dispose();
    }
  });
});

describe('setFlashlightShadow reservation (hybrid deferred M2 task 1)', () => {
  it('stores the binding, reports it, and resets on null', () => {
    const m = mockRenderer();
    const layer = createDeferredLayer(m.renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      expect(layer.diagnostics().flashlightShadowBound).toBe(false);
      const binding = {
        fullDepth: new THREE.Texture(),
        levelDepth: new THREE.Texture(),
        viewProjection: new THREE.Matrix4(),
        lightIndex: 0,
        bias: 0.002,
        mapSize: new THREE.Vector2(1024, 1024),
        enabled: true,
      } satisfies DeferredFlashlightShadowBinding;
      layer.setFlashlightShadow(binding);
      expect(layer.diagnostics().flashlightShadowBound).toBe(true);
      layer.setFlashlightShadow(null);
      expect(layer.diagnostics().flashlightShadowBound).toBe(false);
    } finally {
      layer.dispose();
    }
  });

  it('rejects malformed bindings rather than storing them', () => {
    const m = mockRenderer();
    const layer = createDeferredLayer(m.renderer, { width: 64, height: 64, sdfScale: 1 });
    try {
      const base = {
        fullDepth: new THREE.Texture(),
        levelDepth: new THREE.Texture(),
        viewProjection: new THREE.Matrix4(),
        lightIndex: 0,
        bias: 0.002,
        mapSize: new THREE.Vector2(1024, 1024),
        enabled: true,
      };
      expect(() => layer.setFlashlightShadow({ ...base, bias: Number.NaN } as never)).toThrow();
      expect(() => layer.setFlashlightShadow({ ...base, mapSize: new THREE.Vector2(0, 1024) } as never)).toThrow();
      expect(() => layer.setFlashlightShadow({ ...base, viewProjection: 'nope' } as never)).toThrow();
      expect(layer.diagnostics().flashlightShadowBound).toBe(false);
    } finally {
      layer.dispose();
    }
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
