import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  createDeferredFlashlightShadows,
  FLASHLIGHT_SHADOW_BIAS,
  FLASHLIGHT_SHADOW_KERNEL_RADIUS,
  type DeferredFlashlightShadowFactory,
  type DeferredFlashlightShadowDiagnostics,
} from './deferred-shadows';
import { OCCLUDER_LAYER, SHADOW_HULL_LAYER } from './sdf-layer';

/** The game's own caster sets (dungeon-lighting.ts): the legacy shadow camera
 *  sees layer 0 + both hull layers; the level-only twin sees layer 0 only. */
const UPDATE = {
  enabled: true,
  fullCasterLayers: [0, OCCLUDER_LAYER, SHADOW_HULL_LAYER],
  levelCasterLayers: [0],
};

/** Minimal renderer stand-in: the factory must only ever use this surface. */
function mockShadowRenderer() {
  let current: THREE.RenderTarget | null = null;
  let clearR = 0, clearG = 0, clearB = 0, clearA = 1;
  let depth = 1;
  let mrt: unknown = null;
  const render = vi.fn();
  const clear = vi.fn();
  const renderer = {
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getMRT: () => mrt,
    setMRT: (m: unknown) => { mrt = m; },
    getRenderTarget: () => current,
    setRenderTarget: (t: THREE.RenderTarget | null) => { current = t; },
    render,
    clear,
    setClearColor: (c: THREE.Color, a: number) => { clearR = c.r; clearG = c.g; clearB = c.b; clearA = a; },
    getClearColor: (out: THREE.Color) => { if (out) out.setRGB(clearR, clearG, clearB); return out ?? new THREE.Color(clearR, clearG, clearB); },
    getClearAlpha: () => clearA,
    getClearDepth: () => depth,
    setClearDepth: (d: number) => { depth = d; },
  } as unknown as THREE.WebGPURenderer;
  return {
    renderer, render, clear,
    /** Render target at each render invocation, in order. */
    targetsRendered: [] as (THREE.RenderTarget | null)[],
    /** Target colour attachment + clear colour at each clear invocation. */
    clearLog: [] as { targetTexture?: THREE.Texture; color: number[] }[],
    clearColor: () => [clearR, clearG, clearB, clearA] as const,
    getCurrent: () => current,
    getMRT: () => mrt,
  };
}

function recordTargets(mock: ReturnType<typeof mockShadowRenderer>): void {
  mock.render.mockImplementation(() => { mock.targetsRendered.push(mock.getCurrent()); });
  mock.clear.mockImplementation(() => {
    mock.clearLog.push({ targetTexture: mock.getCurrent()?.textures[0], color: [...mock.clearColor()] });
  });
}

interface Fixture {
  scene: THREE.Scene;
  spot: THREE.SpotLight;
  wall: THREE.Mesh;
  pillar: THREE.Mesh;
  hull: THREE.InstancedMesh;
  shrunk: THREE.InstancedMesh;
  cutout: THREE.Mesh;
}

function casterFixture(): Fixture {
  const scene = new THREE.Scene();
  const spot = new THREE.SpotLight(0xffffff, 90, 16, Math.PI * 0.12, 0.45, 1.6);
  spot.position.set(2, 1.6, 0.8);
  spot.target.position.set(0, 1, -3);
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 0.2;
  spot.shadow.camera.far = 18;
  scene.add(spot, spot.target);

  const mk = (geo: THREE.BufferGeometry, name: string) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    m.name = name;
    return m;
  };
  // Level geometry: casts into BOTH maps (layer 0).
  const wall = mk(new THREE.BoxGeometry(3, 3, 0.2), 'wall');
  wall.position.set(0, 1.5, -3.5);
  const pillar = mk(new THREE.BoxGeometry(0.3, 2, 1), 'pillar');
  pillar.position.set(1.2, 1, 0);
  for (const m of [wall, pillar]) { m.castShadow = true; m.layers.set(0); scene.add(m); }

  // The inflated shadow proxy (layer SHADOW_HULL_LAYER, castShadow true).
  const hull = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new MeshBasicNodeMaterial(), 4);
  hull.name = 'shadow-hull';
  hull.castShadow = true;
  hull.layers.set(SHADOW_HULL_LAYER);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < hull.count; i++) {
    m4.makeScale(0.1, 0.1, 0.1).setPosition(i * 0.2, 0.5, 0);
    hull.setMatrixAt(i, m4);
  }
  scene.add(hull);

  // The SHRUNKEN occlusion hull: same shape of thing, but castShadow false —
  // it must never be collected (inflated-vs-shrunken distinction).
  const shrunk = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new MeshBasicNodeMaterial(), 2);
  shrunk.name = 'occluder-hull';
  shrunk.castShadow = false;
  shrunk.layers.set(OCCLUDER_LAYER);
  scene.add(shrunk);

  // A mapped alpha-cutout caster (grate/plant stand-in).
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 8;
  const cutout = mk(new THREE.PlaneGeometry(1, 1), 'cutout');
  const cutoutMat = new THREE.MeshStandardMaterial({
    map: new THREE.CanvasTexture(canvas), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  cutout.material = cutoutMat;
  cutout.castShadow = true;
  cutout.layers.set(0);
  cutout.position.set(-1, 1, -2);
  scene.add(cutout);

  return { scene, spot, wall, pillar, hull, shrunk, cutout };
}

async function oneFrame(): Promise<void> { await Promise.resolve(); }

describe('createDeferredFlashlightShadows construction', () => {
  it('owns two square R32F depth targets: nearest, NoColorSpace, far-clearable', () => {
    const mock = mockShadowRenderer();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 512 });
    try {
      const d = factory.diagnostics();
      expect(d).toMatchObject({ renderedMaps: 0, fullCasters: 0, levelCasters: 0, size: 512, enabled: false });
      const b = factory.binding(0);
      for (const tex of [b.fullDepth, b.levelDepth]) {
        const image = tex.image as { width: number; height: number };
        expect(image.width).toBe(512);
        expect(image.height).toBe(512);
        expect(tex.format).toBe(THREE.RedFormat);
        expect(tex.type).toBe(THREE.FloatType);
        expect(tex.minFilter).toBe(THREE.NearestFilter);
        expect(tex.magFilter).toBe(THREE.NearestFilter);
        expect(tex.colorSpace).toBe(THREE.NoColorSpace);
      }
      expect(b.fullDepth).not.toBe(b.levelDepth);
      expect(b.mapSize.x).toBe(512);
      expect(b.mapSize.y).toBe(512);
      expect(b.lightIndex).toBe(0);
      expect(b.enabled).toBe(true);
    } finally {
      factory.dispose();
    }
  });

  it('rejects non-positive sizes and duplicate construction misuse', () => {
    const mock = mockShadowRenderer();
    expect(() => createDeferredFlashlightShadows(mock.renderer, { size: 0 })).toThrow(RangeError);
    expect(() => createDeferredFlashlightShadows(mock.renderer, { size: -4 })).toThrow(RangeError);
  });

  it('exposes the named bias and kernel constants with sane values', () => {
    expect(Number.isFinite(FLASHLIGHT_SHADOW_BIAS)).toBe(true);
    expect(FLASHLIGHT_SHADOW_BIAS).toBeGreaterThan(0);
    expect(FLASHLIGHT_SHADOW_BIAS).toBeLessThan(0.05);
    expect(FLASHLIGHT_SHADOW_KERNEL_RADIUS).toBe(1);
  });
});

describe('caster selection (full vs level-only)', () => {
  it('collects level geometry into BOTH maps and the inflated hull into full only', async () => {
    const mock = mockShadowRenderer();
    recordTargets(mock);
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 256 });
    try {
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const d = factory.diagnostics();
      expect(d.enabled).toBe(true);
      expect(d.renderedMaps).toBe(2);
      // wall + pillar + cutout on layer 0; hull on SHADOW_HULL_LAYER.
      expect(d.fullCasters).toBe(4);
      expect(d.levelCasters).toBe(3);
      expect(mock.render).toHaveBeenCalledTimes(2);
      expect(mock.targetsRendered[0]).toBeDefined();
      expect(mock.targetsRendered[1]).toBeDefined();
      // First render fills the FULL map, second the LEVEL-ONLY map.
      const b = factory.binding(0);
      expect(mock.targetsRendered[0]).not.toBe(mock.targetsRendered[1]);
      const owned = [b.fullDepth, b.levelDepth];
      expect(owned).toContain(mock.targetsRendered[0]!.textures[0]);
      expect(owned).toContain(mock.targetsRendered[1]!.textures[0]);
    } finally {
      factory.dispose();
      f.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
  });

  it('never collects castShadow=false proxies (the shrunken hull stays out)', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      f.shrunk.castShadow = true;
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      // Now eligible through its OCCLUDER_LAYER membership: it casts into the
      // FULL map; the level-only set ([0]) is unaffected.
      expect(factory.diagnostics().fullCasters).toBe(5);
      expect(factory.diagnostics().levelCasters).toBe(3);
    } finally {
      factory.dispose();
    }
  });

  it('excludes objects whose layers do not intersect the caster sets (viewmodels)', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      const viewmodel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial());
      viewmodel.name = 'viewmodel';
      viewmodel.castShadow = true;
      viewmodel.layers.set(9);
      f.scene.add(viewmodel);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(factory.diagnostics().fullCasters).toBe(4);
      expect(factory.diagnostics().levelCasters).toBe(3);
      viewmodel.geometry.dispose();
    } finally {
      factory.dispose();
    }
  });

  it('skips an unsupported caster vertex path (SkinnedMesh) and NAMES it, never casts its box', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      skinned.name = 'skinned-kit-piece';
      skinned.castShadow = true;
      skinned.layers.set(0);
      f.scene.add(skinned);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const d: DeferredFlashlightShadowDiagnostics = factory.diagnostics();
      expect(d.unsupported.some((u) => u.includes('skinned-kit-piece'))).toBe(true);
      expect(d.fullCasters).toBe(4);
    } finally {
      factory.dispose();
    }
  });
});

describe('hidden and removed proxies', () => {
  it('drops a hidden proxy from both maps and restores it on visible', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      f.hull.visible = false;
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(factory.diagnostics().fullCasters).toBe(3);
      // Level set is unaffected by hull visibility.
      expect(factory.diagnostics().levelCasters).toBe(3);
      f.hull.visible = true;
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(factory.diagnostics().fullCasters).toBe(4);
    } finally {
      factory.dispose();
    }
  });

  it('drops a removed proxy and its clone (no stale silhouette object)', async () => {
    const mock = mockShadowRenderer();
    recordTargets(mock);
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(factory.diagnostics().fullCasters).toBe(4);
      f.scene.remove(f.hull);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(factory.diagnostics().fullCasters).toBe(3);
      // The clone for the removed source is gone from the rendered FULL scene
 // (render order per update: full, then level-only).
      const rendered = mock.render.mock.calls[2]![0] as THREE.Scene;
      const geos = rendered.children.filter((c) => (c as THREE.Mesh).isMesh)
        .map((c) => (c as THREE.Mesh).geometry);
      expect(geos).not.toContain(f.hull.geometry);
    } finally {
      factory.dispose();
    }
  });

  it('an invisible ANCESTOR hides its subtree of casters', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      const group = new THREE.Group();
      group.add(f.pillar);
      f.scene.add(group);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      // Reparenting does not change eligibility: still wall, pillar, cutout.
      expect(factory.diagnostics().levelCasters).toBe(3);
      group.visible = false;
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(factory.diagnostics().levelCasters).toBe(2);
    } finally {
      factory.dispose();
    }
  });
});

describe('source-referencing clones track current transforms', () => {
  it('clones share the source geometry and instance buffer, and copy matrixWorld/count', async () => {
    const mock = mockShadowRenderer();
    recordTargets(mock);
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      f.scene.updateMatrixWorld(true);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const fullScene = mock.render.mock.calls[0]![0] as THREE.Scene;
      const cloneOf = (src: THREE.Object3D) =>
        fullScene.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry === (src as THREE.Mesh).geometry) as THREE.Mesh | undefined;
      const wallClone = cloneOf(f.wall);
      expect(wallClone).toBeDefined();
      expect(wallClone!.matrix.equals(f.wall.matrixWorld)).toBe(true);
      const hullClone = fullScene.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh | undefined;
      expect(hullClone).toBeDefined();
      // Source-REFERENCING: same attribute object, current instance data.
      expect(hullClone!.instanceMatrix).toBe(f.hull.instanceMatrix);
      expect(hullClone!.count).toBe(f.hull.count);
    } finally {
      factory.dispose();
    }
  });

  it('matrix and instance changes propagate on the next update', async () => {
    const mock = mockShadowRenderer();
    recordTargets(mock);
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      f.wall.position.set(5, 0.5, 2);
      f.wall.updateMatrixWorld(true);
      f.hull.count = 2;
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      // Render order per update: full map first, level-only second.
      const fullScene = mock.render.mock.calls[2]![0] as THREE.Scene;
      const wallClone = fullScene.children.find(
        (c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry === f.wall.geometry,
      ) as THREE.Mesh;
      expect(wallClone.matrix.equals(f.wall.matrixWorld)).toBe(true);
      const hullClone = fullScene.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
      expect(hullClone.count).toBe(2);
    } finally {
      factory.dispose();
    }
  });

  it('a rebuilt source geometry produces a fresh clone (actor rebuild pattern)', async () => {
    const mock = mockShadowRenderer();
    recordTargets(mock);
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const oldGeo = f.wall.geometry;
      f.wall.geometry = new THREE.BoxGeometry(1, 2, 3);
      f.wall.updateMatrixWorld(true);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const fullScene = mock.render.mock.calls.at(-1)![0] as THREE.Scene;
      const geos = fullScene.children.filter((c) => (c as THREE.Mesh).isMesh).map((c) => (c as THREE.Mesh).geometry);
      expect(geos).toContain(f.wall.geometry);
      expect(geos).not.toContain(oldGeo);
      f.wall.geometry.dispose();
    } finally {
      factory.dispose();
    }
  });
});

describe('alpha-cutout casters', () => {
  it('gets a dedicated depth material reproducing the map+alphaTest, cached per source material', async () => {
    const mock = mockShadowRenderer();
    recordTargets(mock);
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      // Two casters sharing ONE source material must share one shadow material.
      const twin = new THREE.Mesh(f.cutout.geometry, f.cutout.material as THREE.Material);
      twin.castShadow = true;
      twin.layers.set(0);
      twin.position.set(-1.5, 1, -2.5);
      f.scene.add(twin);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const fullScene = mock.render.mock.calls[0]![0] as THREE.Scene;
      const meshes = fullScene.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
      const cutoutClones = meshes.filter((m) => m.geometry === f.cutout.geometry);
      expect(cutoutClones.length).toBe(2);
      expect(cutoutClones[0]!.material).toBe(cutoutClones[1]!.material);
      expect(cutoutClones[0]!.material).not.toBe(f.cutout.material);
      // Opaque casters share a DIFFERENT (plain) depth material.
      const wallClone = meshes.find((m) => m.geometry === f.wall.geometry)!;
      expect(wallClone.material).not.toBe(cutoutClones[0]!.material);
    } finally {
      factory.dispose();
    }
  });
});

describe('disabled state, clears, and zero render calls', () => {
  it('renders ZERO maps when disabled and clears both to far on the enable->disable transition', async () => {
    const mock = mockShadowRenderer();
    recordTargets(mock);
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(mock.render).toHaveBeenCalledTimes(2);
      const rendersAfterOn = mock.render.mock.calls.length;
      const clearsAfterOn = mock.clear.mock.calls.length;
      factory.update(f.scene, f.spot, { ...UPDATE, enabled: false });
      await oneFrame();
      const d = factory.diagnostics();
      expect(d.enabled).toBe(false);
      expect(d.renderedMaps).toBe(0);
      expect(mock.render.mock.calls.length).toBe(rendersAfterOn);
      // Both maps cleared exactly once each, with a FAR (r=1) clear colour —
      // captured AT the clear (the previous colour is restored afterwards).
      expect(mock.clear.mock.calls.length).toBe(clearsAfterOn + 2);
      const b = factory.binding(0);
      const owned = [b.fullDepth, b.levelDepth];
      for (const call of mock.clearLog.slice(clearsAfterOn)) {
        expect(call.targetTexture).toBeDefined();
        expect(owned).toContain(call.targetTexture);
        expect(call.color[0]).toBe(1);
      }
    } finally {
      factory.dispose();
    }
  });

  it('re-enabling renders both maps again (no stale-disable lockout)', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, { ...UPDATE, enabled: false });
      await oneFrame();
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const d = factory.diagnostics();
      expect(d.renderedMaps).toBe(2);
      expect(d.enabled).toBe(true);
    } finally {
      factory.dispose();
    }
  });

  it('stays disabled while disabled across repeated updates (no hidden work)', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, { ...UPDATE, enabled: false });
      await oneFrame();
      const clearsAfterFirst = mock.clear.mock.calls.length;
      for (let i = 0; i < 3; i++) {
        factory.update(f.scene, f.spot, { ...UPDATE, enabled: false });
        await oneFrame();
      }
      expect(mock.render).toHaveBeenCalledTimes(0);
      expect(mock.clear.mock.calls.length).toBe(clearsAfterFirst);
    } finally {
      factory.dispose();
    }
  });

  it('after an enabled period, repeated disabled updates clear exactly once (transition-only, no per-frame work)', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(mock.render).toHaveBeenCalledTimes(2);
      factory.update(f.scene, f.spot, { ...UPDATE, enabled: false });
      await oneFrame();
      const clearsAfterTransition = mock.clear.mock.calls.length;
      expect(clearsAfterTransition).toBeGreaterThanOrEqual(2); // transition cleared both maps
      for (let i = 0; i < 3; i++) {
        factory.update(f.scene, f.spot, { ...UPDATE, enabled: false });
        await oneFrame();
      }
      // Zero further clears AND zero further renders while disabled.
      expect(mock.render).toHaveBeenCalledTimes(2);
      expect(mock.clear.mock.calls.length).toBe(clearsAfterTransition);
      const d = factory.diagnostics();
      expect(d.renderedMaps).toBe(0);
      expect(d.enabled).toBe(false);
    } finally {
      factory.dispose();
    }
  });
});

describe('binding() and the light view-projection', () => {
  it('projects the light target to NDC centre and updates in the same frame the light moves', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 256 });
    try {
      f.scene.updateMatrixWorld(true);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const b = factory.binding(0);
      expect(b.bias).toBe(FLASHLIGHT_SHADOW_BIAS);
      const project = (p: THREE.Vector3) => {
        const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(b.viewProjection);
        return { x: v.x / v.w, y: v.y / v.w, z: v.z / v.w };
      };
      const centre = project(f.spot.target.getWorldPosition(new THREE.Vector3()));
      expect(Math.abs(centre.x)).toBeLessThan(1e-4);
      expect(Math.abs(centre.y)).toBeLessThan(1e-4);
      expect(centre.z).toBeGreaterThan(0);
      expect(centre.z).toBeLessThan(1);
      // The BINDING object is live: moving the light and updating must move
      // the SAME binding's matrix (the layer re-reads it every render).
      const before = b.viewProjection.elements.slice();
      f.spot.position.set(-2, 2.2, 1.5);
      f.spot.updateMatrixWorld(true);
      f.spot.target.updateMatrixWorld(true);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(b.viewProjection.elements).not.toEqual(before);
      const moved = project(f.spot.target.getWorldPosition(new THREE.Vector3()));
      expect(Math.abs(moved.x)).toBeLessThan(1e-4);
    } finally {
      factory.dispose();
    }
  });

  it('binding(lightIndex, samplingEnabled) carries the index and the sampling flag', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const b = factory.binding(5);
      expect(b.lightIndex).toBe(5);
      expect(b.enabled).toBe(true);
      const diag = factory.binding(5, false);
      expect(diag.enabled).toBe(false);
      // Same live matrices/textures; only the sampling flag differs.
      expect(diag.viewProjection).toBe(b.viewProjection);
      expect(diag.fullDepth).toBe(b.fullDepth);
    } finally {
      factory.dispose();
    }
  });

  it('throws when binding is requested with an out-of-range lightIndex', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      expect(() => factory.binding(-1)).toThrow(RangeError);
      expect(() => factory.binding(16)).toThrow(RangeError);
    } finally {
      factory.dispose();
    }
  });
});

describe('shadow-pass renderer state ownership (continuation review)', () => {
  /** Caller state that must survive an update untouched. */
  function setNonDefaultCallerState(renderer: THREE.WebGPURenderer): void {
    renderer.autoClear = false;
    renderer.autoClearColor = false;
    renderer.autoClearDepth = false;
    renderer.setClearDepth(0.5);
    renderer.setClearColor(new THREE.Color(0.2, 0.3, 0.4), 0.5);
    renderer.setMRT({ fake: 'caller-mrt' } as never);
  }

  interface DuringState {
    autoClear: boolean; autoClearColor: boolean; autoClearDepth: boolean;
    clearDepth: number; color: readonly [number, number, number, number]; mrt: unknown;
  }

  function captureDuringRender(mock: ReturnType<typeof mockShadowRenderer>): DuringState[] {
    const during: DuringState[] = [];
    const r = mock.renderer;
    mock.render.mockImplementation(() => {
      during.push({
        autoClear: r.autoClear,
        autoClearColor: r.autoClearColor,
        autoClearDepth: r.autoClearDepth,
        clearDepth: r.getClearDepth(),
        color: mock.clearColor(),
        mrt: r.getMRT(),
      });
    });
    return during;
  }

  it('forces autoClearColor/autoClearDepth/MRT/clear state during the map renders and restores the caller afterwards', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      setNonDefaultCallerState(mock.renderer);
      const during = captureDuringRender(mock);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      expect(during.length).toBe(2);
      for (const s of during) {
        expect(s.autoClear).toBe(true);
        expect(s.autoClearColor).toBe(true);
        expect(s.autoClearDepth).toBe(true);
        expect(s.clearDepth).toBe(1);
        expect(s.color[0]).toBe(1);       // FAR_CLEAR r=1
        expect(s.mrt).toBeNull();          // single-attachment targets
      }
      // Caller state fully restored.
      const r = mock.renderer;
      expect(r.autoClear).toBe(false);
      expect(r.autoClearColor).toBe(false);
      expect(r.autoClearDepth).toBe(false);
      expect(r.getClearDepth()).toBe(0.5);
      expect(mock.clearColor()).toEqual([0.2, 0.3, 0.4, 0.5]);
      expect(mock.getMRT()).toEqual({ fake: 'caller-mrt' });
      expect(mock.getCurrent()).toBeNull();
    } finally {
      factory.dispose();
    }
  });

  it('restores caller state even when a map render throws', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      setNonDefaultCallerState(mock.renderer);
      mock.render.mockImplementation(() => { throw new Error('boom'); });
      expect(() => factory.update(f.scene, f.spot, UPDATE)).toThrow('boom');
      const r = mock.renderer;
      expect(r.autoClear).toBe(false);
      expect(r.autoClearColor).toBe(false);
      expect(r.autoClearDepth).toBe(false);
      expect(r.getClearDepth()).toBe(0.5);
      expect(mock.clearColor()).toEqual([0.2, 0.3, 0.4, 0.5]);
      expect(mock.getMRT()).toEqual({ fake: 'caller-mrt' });
      expect(mock.getCurrent()).toBeNull();
    } finally {
      factory.dispose();
    }
  });

  it('the disable-path far clear also runs with owned state and preserves the caller', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    try {
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      setNonDefaultCallerState(mock.renderer);
      const clearStates: Array<{ mrt: unknown; clearDepth: number; color: readonly [number, number, number, number] }> = [];
      const r = mock.renderer;
      mock.clear.mockImplementation(() => {
        clearStates.push({ mrt: r.getMRT(), clearDepth: r.getClearDepth(), color: mock.clearColor() });
      });
      factory.update(f.scene, f.spot, { ...UPDATE, enabled: false });
      await oneFrame();
      expect(factory.diagnostics().renderedMaps).toBe(0);
      expect(clearStates.length).toBe(2); // both maps invalidated to far
      for (const s of clearStates) {
        expect(s.mrt).toBeNull();
        expect(s.clearDepth).toBe(1);
        expect(s.color[0]).toBe(1);
      }
      expect(r.autoClear).toBe(false);
      expect(r.autoClearColor).toBe(false);
      expect(r.autoClearDepth).toBe(false);
      expect(r.getClearDepth()).toBe(0.5);
      expect(mock.clearColor()).toEqual([0.2, 0.3, 0.4, 0.5]);
      expect(mock.getMRT()).toEqual({ fake: 'caller-mrt' });
    } finally {
      factory.dispose();
    }
  });

  it('clone depth materials carry the SOURCE side (front walls stay visible to the light; back/doublesided casters keep theirs)', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ side: THREE.BackSide }));
    try {
      // A BackSide source must keep BackSide (three's shadowSide convention
      // would FLIP it — under the eye-side convention it must not).
      back.castShadow = true;
      back.layers.set(0);
      back.position.set(0, 0.5, 0.5);
      f.scene.add(back);
      factory.update(f.scene, f.spot, UPDATE);
      await oneFrame();
      const fullScene = mock.render.mock.calls[0]![0] as THREE.Scene;
      const meshes = fullScene.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
      const srcByGeometry = new Map<THREE.BufferGeometry, THREE.Mesh>([
        [f.wall.geometry, f.wall],
        [f.pillar.geometry, f.pillar],
        [f.cutout.geometry, f.cutout],
        [f.hull.geometry, f.hull],
        [back.geometry, back],
      ]);
      expect(meshes.length).toBe(srcByGeometry.size);
      const materialsBySide = new Map<number, THREE.Material>();
      for (const m of meshes) {
        const src = srcByGeometry.get(m.geometry)!;
        const mat = m.material as THREE.Material;
        expect(mat.side).toBe((src.material as THREE.Material).side);
        if (src !== f.cutout) materialsBySide.set(mat.side, mat);
      }
      // Front-side opaque casters SHARE one depth material; the BackSide one
      // gets its own; the cutout's is per-source (alpha discard).
      expect(materialsBySide.size).toBe(2);
    } finally {
      factory.dispose();
      back.geometry.dispose();
    }
  });
});

describe('dispose', () => {
  it('releases the maps and refuses further updates', async () => {
    const mock = mockShadowRenderer();
    const f = casterFixture();
    const factory: DeferredFlashlightShadowFactory = createDeferredFlashlightShadows(mock.renderer, { size: 128 });
    factory.update(f.scene, f.spot, UPDATE);
    await oneFrame();
    factory.dispose();
    expect(() => factory.update(f.scene, f.spot, UPDATE)).toThrow(/disposed/);
    expect(() => factory.binding(0)).toThrow(/disposed/);
    factory.dispose(); // idempotent
  });
});
