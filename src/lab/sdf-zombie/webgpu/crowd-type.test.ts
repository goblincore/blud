// src/lab/sdf-zombie/webgpu/crowd-type.test.ts
//
// Pure-CPU pins for the crowd type's slot allocator and instance-attribute
// packing. The material/atlas/record wiring is exercised by the game page
// (`?crowd=1`) and its march-hash parity gate — these are the parts that can
// be pinned without a GPU.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  allocateSlot, packInstanceAttrs, highWater, budgetFit, INST_FLOATS, createCrowdType,
} from './crowd-type';
import { defaultUniforms, blankFaceTexture, type ZombieGpuView } from './zombie-gpu';
import { TILE_SIZE_PX, type TileGroupInput } from './tile-cull';
import { MAX_TILE_GROUPS } from './tile-bin-compute';
import source from './crowd-type?raw';

describe('crowd type slots', () => {
  it('hands out the lowest free slot and recycles', () => {
    const free = new Set([0, 1, 2, 3]);
    expect(allocateSlot(free)).toBe(0);
    expect(allocateSlot(free)).toBe(1);
    free.add(0);
    expect(allocateSlot(free)).toBe(0);
    free.clear();
    expect(allocateSlot(free)).toBe(-1);
  });
  it('packs centre, half and slot per instance', () => {
    const out = new Float32Array(2 * INST_FLOATS);
    const n = packInstanceAttrs([
      { slot: 3, centre: [1, 2, 3], half: [0.5, 1, 0.5], visible: true },
      { slot: 5, centre: [0, 0, 0], half: [1, 1, 1], visible: false },
    ], out);
    expect(n).toBe(1);
    expect(Array.from(out.subarray(0, INST_FLOATS))).toEqual([1, 2, 3, 0.5, 1, 0.5, 3]);
  });
});

describe('crowd type loop bound (perf 7d)', () => {
  it('high-water marks the drawn slots, not the capacity', () => {
    expect(highWater([])).toBe(0);
    expect(highWater([0])).toBe(1);
    expect(highWater([0, 1, 2])).toBe(3);
    // A mid-range detach leaves a gap: the bound is still max + 1 (the free
    // slots below it carry alive = 0 and the per-step gate skips them).
    expect(highWater([0, 2])).toBe(3);
    expect(highWater([0, 1])).toBe(2);
  });

  it('caps the group list nearest-first, culling the far tail', () => {
    expect(budgetFit([], 10)).toEqual({ kept: 0, culled: 0 });
    expect(budgetFit([5, 5], 10)).toEqual({ kept: 2, culled: 0 });
    expect(budgetFit([10, 10, 10], 25)).toEqual({ kept: 2, culled: 1 });
    // A hard stop: the instance that would overflow ends the list, so the
    // smaller INSTANCE 2 is culled too rather than back-filled.
    expect(budgetFit([10, 20, 5], 25)).toEqual({ kept: 1, culled: 2 });
  });

  it('never zeroes the tile gate on overflow', () => {
    // The unbounded fallback (tileCfg.x = 0 + full cluster walk per slot) is
    // what hung the GPU on 2026-09-14; overflow now caps the group list or
    // zeroes instCfg.x for one frame (every pixel discards).
    expect(source).not.toContain('tileCfg.value.x = 0');
    expect(source).toContain('instCfg.value.set(0, 1, 0, 0)');
  });
});

// ---------------------------------------------------------------------------
// VISIBLE-ONLY PACKING (perf 7e). The game attaches EVERY actor to a crowd
// type at spawn and only culls visibility per frame (updateVisibleActors);
// sync() must pack and bin only the visible slots or the crowd path costs the
// whole level instead of the bodies on screen.
//
// These construct a REAL CrowdType over a stub renderer (compute is a no-op —
// the pack/budget selection is CPU and that is what is under test).
// ---------------------------------------------------------------------------

/** One group whose bodyIndex is the slot, so a group's origin is readable. */
function groupFor(slot: number): TileGroupInput {
  return {
    bodyIndex: slot, start: 0, count: 1,
    center: [slot, 0, -4], radius: 0.5, distort: 1, flags: 0,
  };
}

/** Minimal ZombieGpuView: attach() rebinds (no-op here) and sync() reads
 *  object.position, uniforms.bodyHalf and getTileGroups(). */
function stubView(slot: number, groups: TileGroupInput[]): ZombieGpuView {
  return {
    object: { position: new THREE.Vector3(slot, 0, -4) },
    uniforms: { bodyHalf: { value: new THREE.Vector3(0.5, 1, 0.5) } },
    getTileGroups: () => groups,
    rebind: () => { /* the stub binds nothing */ },
  } as unknown as ZombieGpuView;
}

describe('crowd type visible-only packing (perf 7e)', () => {
  it('packs and bins only visibleSlots; a hidden slot stays attached', () => {
    const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256);

    expect(t.attach(stubView(0, [groupFor(0)]))).toBe(0);
    expect(t.attach(stubView(1, [groupFor(1)]))).toBe(1);
    expect(t.attach(stubView(2, [groupFor(2)]))).toBe(2);

    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const grid = { tilesX: 16, tilesY: 16, tilePx: TILE_SIZE_PX };

    t.sync(camera, grid, new Set([0, 2]));

    const geo = t.mesh.geometry as THREE.InstancedBufferGeometry;
    expect(geo.instanceCount).toBe(2);
    // High-water of the DRAWN slots is still slot 2 + 1, not the capacity.
    expect((t.instCfg.value as THREE.Vector4).x).toBe(3);
    // Only slots 0 and 2 were binned; slot 1's group never entered the list.
    expect(t.binInputs().groups.length).toBeGreaterThan(0);
    expect(t.binInputs().groups.every(g => g.bodyIndex !== 1)).toBe(true);
    expect(t.info().attached).toBe(3);
    expect(t.info().visible).toBe(2);

    // Re-showing a hidden slot costs nothing but a re-pack: still attached.
    t.sync(camera, grid, new Set([1]));
    expect(geo.instanceCount).toBe(1);
    expect((t.instCfg.value as THREE.Vector4).x).toBe(2);
    expect(t.binInputs().groups.every(g => g.bodyIndex === 1)).toBe(true);
    expect(t.info().visible).toBe(1);
    expect(t.info().attached).toBe(3);
  });
});

describe('crowd type reserve/attach split (defer-compile fallback)', () => {
  it('reserves the lowest free slot and binds a later view to exactly that slot', () => {
    const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256);

    const reserved = t.reserveSlot();
    expect(reserved).toBe(0);
    // Reserved is not attached: the view has not been built yet.
    expect(t.info().attached).toBe(0);

    const rebinds: number[] = [];
    const view = stubView(0, []);
    (view as unknown as { rebind: (r: { slot: number }) => void }).rebind = (r) => { rebinds.push(r.slot); };
    t.attachAt(view, reserved);
    expect(rebinds).toEqual([0]);
    expect(t.info().attached).toBe(1);

    // Attaching a second view to the same slot is the misuse the split can
    // invite, so it throws instead of silently overwriting a live instance.
    expect(() => t.attachAt(stubView(0, []), reserved)).toThrow(/already occupied/);
  });

  it('detach recycles a reserved-but-unattached slot instead of leaking it', () => {
    const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256);

    expect(t.attach(stubView(0, []))).toBe(0);
    const reserved = t.reserveSlot();
    expect(reserved).toBe(1);
    t.detach(reserved);
    expect(t.reserveSlot()).toBe(1);
  });
});

describe('crowd type dispatch switch (stage a-2)', () => {
  it('swaps the screen quad in for the proxy boxes and stamps instCfg.y', () => {
    const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256);
    expect(t.dispatch).toBe('boxes');
    const boxGeo = t.mesh.geometry;
    expect(boxGeo).toBeInstanceOf(THREE.InstancedBufferGeometry);

    expect(t.attach(stubView(0, [groupFor(0)]))).toBe(0);
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const grid = { tilesX: 16, tilesY: 16, tilePx: TILE_SIZE_PX };

    t.sync(camera, grid, new Set([0]));
    expect((t.instCfg.value as THREE.Vector4).y).toBe(1);

    t.setDispatch('quad');
    expect(t.dispatch).toBe('quad');
    expect(t.mesh.geometry.type).toBe('PlaneGeometry');
    t.sync(camera, grid, new Set([0]));
    expect((t.instCfg.value as THREE.Vector4).y).toBe(2);
    // x still bounds the slot walk for the tiles-off debug path.
    expect((t.instCfg.value as THREE.Vector4).x).toBe(1);
    expect(t.info().dispatch).toBe('quad');
    expect(t.info().visible).toBe(1);

    t.setDispatch('boxes');
    t.sync(camera, grid, new Set([0]));
    expect((t.instCfg.value as THREE.Vector4).y).toBe(1);
    expect(t.mesh.geometry).toBe(boxGeo);
  });
});

describe('crowd type quad rasterisation rect (stage a-2 (3))', () => {
  it('binds the visible-instance rect and reports rectFrac < 1', () => {
    const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { dispatch: 'quad' });
    expect(t.attach(stubView(0, [groupFor(0)]))).toBe(0);
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const grid = { tilesX: 16, tilesY: 16, tilePx: TILE_SIZE_PX };

    t.sync(camera, grid, new Set([0]));
    const rect = t.info().rect!;
    expect(rect).not.toBeNull();
    expect(t.info().rectFrac).toBeGreaterThan(0);
    expect(t.info().rectFrac).toBeLessThan(1);
    // The uniform the lit material and its depth-pre twin share is the rect.
    expect([t.quadRect.value.x, t.quadRect.value.y, t.quadRect.value.z, t.quadRect.value.w])
      .toEqual(rect);
    expect(rect).not.toEqual([-1, -1, 1, 1]);
    expect(t.mesh.visible).toBe(true);
    expect(t.depthPreMesh.visible).toBe(true);
  });

  it('hides both quad meshes when nothing is visible', () => {
    const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { dispatch: 'quad' });
    expect(t.attach(stubView(0, [groupFor(0)]))).toBe(0);
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const grid = { tilesX: 16, tilesY: 16, tilePx: TILE_SIZE_PX };

    t.sync(camera, grid, new Set());
    expect(t.info().visible).toBe(0);
    expect(t.info().rect).toBeNull();
    expect(t.info().rectFrac).toBe(0);
    expect(t.mesh.visible).toBe(false);
    expect(t.depthPreMesh.visible).toBe(false);
  });
});

describe('crowd type early-Z batches (earlyz stage 1)', () => {
  const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
  const grid = { tilesX: 16, tilesY: 16, tilePx: TILE_SIZE_PX };
  const cam = (z: number) => {
    const c = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    c.position.set(0, 0, z);
    c.updateMatrixWorld();
    c.matrixWorldInverse.copy(c.matrixWorld).invert();
    return c;
  };
  const slotOf = (m: THREE.Mesh, row: number) =>
    ((m.geometry as THREE.InstancedBufferGeometry).getAttribute('iSlot') as THREE.InterleavedBufferAttribute).getX(row);

  it('without the option: no front mesh, every instance in the shipped batch', () => {
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256);
    expect(t.frontMesh).toBeNull();
    t.attach(stubView(0, [groupFor(0)]));
    t.sync(cam(0), grid, new Set([0]));
    expect((t.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
  });

  it('camera-inside instances stay in the back (shipped) batch; the rest draw front faces', () => {
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { earlyz: true });
    t.attach(stubView(0, [groupFor(0)])); // centre (0,0,-4), half (0.5,1,0.5)
    t.attach(stubView(1, [groupFor(1)])); // centre (1,0,-4)
    t.sync(cam(-4.2), grid, new Set([0, 1])); // inside slot 0's box, outside slot 1's (x 0 < 1 - 0.5 - 0.25)
    expect((t.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
    expect((t.frontMesh!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
    expect(slotOf(t.mesh, 0)).toBe(0);
    expect(slotOf(t.frontMesh!, 0)).toBe(1);
    const b = t.earlyzBatches();
    expect(b.back).toBe(1);
    expect(b.front).toBe(1);
    expect(b.nearestBack).toBeCloseTo(0.2, 6);
    expect(b.nearestFront).toBeCloseTo(Math.hypot(1, 0.2), 6);
  });

  it('front material is FrontSide + greater; the back mesh keeps the shipped BackSide material', () => {
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { earlyz: true });
    expect((t.frontMesh!.material as THREE.Material).side).toBe(THREE.FrontSide);
    expect((t.frontMesh!.material as unknown as { conservativeDepth: string }).conservativeDepth).toBe('greater');
    expect((t.mesh.material as THREE.Material).side).toBe(THREE.BackSide);
  });

  it('the quad dispatch hides the front mesh and zeroes its batch', () => {
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { earlyz: true });
    t.attach(stubView(1, [groupFor(1)]));
    t.setDispatch('quad');
    t.sync(cam(0), grid, new Set([0]));
    expect(t.frontMesh!.visible).toBe(false);
    expect((t.frontMesh!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
  });

  it('a budget-culled instance is drawn in neither batch; the batch counts sum to the no-earlyz draw count', () => {
    /** A view at x with `n` tile groups; MAX_TILE_GROUPS groups overflow the shared budget. */
    const viewAt = (slot: number, x: number, n: number): ZombieGpuView => ({
      object: { position: new THREE.Vector3(x, 0, -4) },
      uniforms: { bodyHalf: { value: new THREE.Vector3(0.5, 1, 0.5) } },
      getTileGroups: () => Array.from({ length: n }, () => groupFor(slot)),
      rebind: () => { /* the stub binds nothing */ },
    } as unknown as ZombieGpuView);
    const drawn = (t: ReturnType<typeof createCrowdType>) =>
      (t.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
    // Camera (0,0,-4.2): inside a box centred x 0 / 0.1, outside one centred x 1 / 2.
    const scenes: { name: string; xs: number[]; groups: number[] }[] = [
      // Nearest-first: 0.2, 1.02, 2.01. Slot 2 overflows the cap, so it alone is culled (a FRONT item).
      { name: 'culled front item', xs: [0, 1, 2], groups: [1, 1, MAX_TILE_GROUPS] },
      // The culled FRONT item is its batch's only member: nearestFront must not see it.
      { name: 'culled item alone in the front batch', xs: [0, 1], groups: [1, MAX_TILE_GROUPS] },
      // Nearest-first: 0.2, 0.22. Slot 1 overflows; it is inside the guarded box, so a BACK item.
      { name: 'culled back item', xs: [0, 0.1], groups: [1, MAX_TILE_GROUPS] },
    ];
    for (const sc of scenes) {
      const build = (earlyz: boolean) => {
        const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256,
          undefined, earlyz ? { earlyz: true } : undefined);
        sc.xs.forEach((x, i) => t.attach(viewAt(i, x, sc.groups[i]!)));
        t.sync(cam(-4.2), grid, new Set(sc.xs.map((_, i) => i)));
        return t;
      };
      const plain = build(false);
      const t = build(true);
      const b = t.earlyzBatches();
      // The culled slot is packed in neither batch, so it never draws.
      expect(t.info().culledByBudget, sc.name).toBe(plain.info().culledByBudget);
      expect(t.info().culledByBudget, sc.name).toBeGreaterThan(0);
      expect(b.back + b.front, sc.name).toBe(drawn(plain));
      expect(drawn(t), sc.name).toBe(b.back);
      expect((t.frontMesh!.geometry as THREE.InstancedBufferGeometry).instanceCount, sc.name).toBe(b.front);
      const culledSlot = sc.xs.length - 1;
      for (let r = 0; r < b.back; r++) expect(slotOf(t.mesh, r), sc.name).not.toBe(culledSlot);
      for (let r = 0; r < b.front; r++) expect(slotOf(t.frontMesh!, r), sc.name).not.toBe(culledSlot);
      // Nearest distances come from drawn items only: an emptied batch reports Infinity.
      if (b.front === 0) expect(b.nearestFront, sc.name).toBe(Infinity);
      if (b.back === 0) expect(b.nearestBack, sc.name).toBe(Infinity);
    }
    // Pin the two infinities the loop above can only conditionally check.
    const only = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { earlyz: true });
    only.attach(viewAt(0, 0, 1));
    only.attach(viewAt(1, 1, MAX_TILE_GROUPS));
    only.sync(cam(-4.2), grid, new Set([0, 1]));
    expect(only.earlyzBatches()).toEqual({ back: 1, front: 0, nearestBack: expect.closeTo(0.2, 6), nearestFront: Infinity });
  });
});
