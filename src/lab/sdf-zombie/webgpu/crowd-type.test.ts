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
