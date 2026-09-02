import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { wrapHullRefine, type HullRefineDeps, type HullInnerView } from './hull-refine-view';

function fakeInner() {
  const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  object.position.set(1, 2, 3);
  return {
    object,
    uniforms: {
      bodyHalf: { value: new THREE.Vector3(0.4, 0.9, 0.3) },
      counts: { value: new THREE.Vector4(0, 0, 0, 0.02) },
      // Plan deviation: the fake must carry marchCfg — the wrapper seeds the
      // hull steps uniform from its y/z channels (x is replaced by knobs.steps).
      marchCfg: { value: new THREE.Vector3(96, 0.002, 0.06) },
    },
    dataTexture: new THREE.Texture(),
    volumeTexture: new THREE.Texture(),
    update: vi.fn(),
    setWounds: vi.fn(),
    dispose: vi.fn(),
  };
}

function fakeDeps(): HullRefineDeps & { extract: ReturnType<typeof vi.fn> } {
  const extract = vi.fn(() => ({ cellVerts: 0, soupVerts: 0, overflow: false, dropped: 0, blockCount: 1, cellCount: 64, grid: { min: [0, 0, 0] as [number, number, number], cell: 0.02, dims: [4, 4, 4] as [number, number, number], clamped: false } }));
  return {
    extract,
    makeCompute: () => ({
      soupAttribute: new THREE.StorageBufferAttribute(6, 3),
      // Typed array, not a count: the 0.185 .d.ts only declares the
      // TypedArray constructor form (same note as surface-nets-compute.ts).
      indirect: new THREE.IndirectStorageBufferAttribute(new Uint32Array(4), 1),
      extract,
      readback: async () => ({ meta: new Uint32Array(4), cellPos: new Float32Array(0), soup: new Float32Array(0) }),
      dispose: vi.fn(),
    }),
    makeMaterial: () => new THREE.MeshBasicNodeMaterial(),
    renderer: {} as THREE.WebGPURenderer,
  };
}

describe('wrapHullRefine', () => {
  it('starts on the march: inner visible, hull hidden', () => {
    const v = wrapHullRefine(fakeInner() as unknown as HullInnerView, fakeDeps());
    expect(v.inner.object.visible).toBe(true);
    expect(v.hullObject.visible).toBe(false);
    expect(v.renderer).toBe('march');
  });
  it('setRenderer flips visibility both ways', () => {
    const v = wrapHullRefine(fakeInner() as unknown as HullInnerView, fakeDeps());
    v.setRenderer('hull');
    expect(v.inner.object.visible).toBe(false);
    expect(v.hullObject.visible).toBe(true);
    v.setRenderer('march');
    expect(v.inner.object.visible).toBe(true);
    expect(v.hullObject.visible).toBe(false);
  });
  it('update delegates, then extracts ONLY when the hull is on, with the inner bounds', () => {
    const inner = fakeInner();
    const deps = fakeDeps();
    const v = wrapHullRefine(inner as unknown as HullInnerView, deps);
    v.update({} as never);
    expect(inner.update).toHaveBeenCalledTimes(1);
    expect(deps.extract).not.toHaveBeenCalled();
    v.setRenderer('hull');
    v.update({} as never);
    expect(deps.extract).toHaveBeenCalledTimes(1);
    const [, centre, half, origin, cell, band] = deps.extract.mock.calls[0]!;
    expect((centre as THREE.Vector3).toArray()).toEqual([1, 2, 3]);
    expect((half as THREE.Vector3).toArray()).toEqual([0.4, 0.9, 0.3]);
    expect((origin as THREE.Vector3).toArray()).toEqual([1, 2, 3]);
    expect(cell).toBe(0.02); expect(band).toBe(0.02);
    expect(v.hullObject.position.toArray()).toEqual([1, 2, 3]);
  });
  it('setWounds passes straight through and knobs update the steps uniform', () => {
    const inner = fakeInner();
    const v = wrapHullRefine(inner as unknown as HullInnerView, fakeDeps());
    v.setWounds([] as never, [] as never, [] as never, [] as never);
    expect(inner.setWounds).toHaveBeenCalledTimes(1);
    v.setKnobs({ steps: 8, band: 0.03, cell: 0.015 });
    expect(v.knobs()).toEqual({ steps: 8, band: 0.03, cell: 0.015 });
    expect(v.hullMarchCfg.value.x).toBe(8);
    // plain sphere tracing, never the inner view's relaxed 0.6 (see the wrapper)
    expect(v.hullMarchCfg.value.y).toBe(1);
  });
});
