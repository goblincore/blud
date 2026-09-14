// src/lab/sdf-zombie/webgpu/crowd-type.ts
//
// Crowd stage a (Task 5): ONE draw per character TYPE. A CrowdType owns a
// shared prim atlas (MAX_CROWD_INSTANCES bands), a shared instance-record
// buffer, one lit material, one instanced proxy-box mesh, one depth-prepass
// twin and one GPU tile binding. A view attaches to a slot, packs its own
// pack into that band through a PrimSink, and syncs its per-instance uniforms
// into the record; the material's per-slot loop folds every instance's full
// field and takes the min (see MAP_BODY).
//
// Stage (a) still rasterises one proxy box PER INSTANCE and the fragment reads
// its own box face for startT, so a lone body is bit-identical to the per-body
// material. Overlapping boxes still trace a pixel more than once; the depth
// test keeps the nearest. Per-tile screen quads (true one-ray-per-pixel) are
// stage a-2.

import * as THREE from 'three/webgpu';
import { uniform, texture } from 'three/tsl';
import { createCrowdPrimAtlas, type CrowdPrimAtlas } from './crowd-atlas';
import {
  createCrowdRecords, allocateSlot, MAX_CROWD_INSTANCES, REC_VEC4S, REC_COUNTS, REC_WIND_ALIVE,
  type CrowdRecords,
} from './crowd-records';
import { createComputeTileBinding, MAX_TILE_GROUPS, type ComputeTileBinding } from './tile-bin-compute';
import { TileBinner, type TileGroupInput } from './tile-cull';
import {
  createCrowdMaterial, type CrowdMaterialSources, type MarchUniforms, type ZombieGpuView,
} from './zombie-gpu';

// Re-exported for the existing `./crowd-type` import sites; the function itself
// now lives beside the record buffer it allocates from (task 7c), so
// zombie-gpu.ts can reuse it without a circular import.
export { allocateSlot };

/** Floats per instance in the interleaved attribute buffer: iCentre.xyz,
 *  iHalf.xyz, iSlot. */
export const INST_FLOATS = 7;

/**
 * The high-water mark of a set of occupied slots: max(slot) + 1, or 0 when
 * empty. `instCfg.x` is stamped with this, not MAX_CROWD_INSTANCES: since
 * allocateSlot always hands out the lowest free slot, it equals the drawn
 * count except transiently after a mid-range detach, and free slots below it
 * carry alive = 0 and are skipped by the per-step gate (one record read, no
 * fold). This is the loop bound that made the 2-body crowd cost its capacity
 * rather than its population (perf 7d).
 */
export function highWater(slots: Iterable<number>): number {
  let hi = 0;
  for (const s of slots) if (s + 1 > hi) hi = s + 1;
  return hi;
}

/**
 * Nearest-first group budget (perf 7d). `groupCounts` is the per-instance
 * group count in distance order (nearest first); returns how many of the
 * leading instances fit inside `cap`, and how many trailing ones are culled.
 * A hard stop: once one instance does not fit, every farther instance is
 * culled too — the list is only useful contiguous from the near end, and the
 * old policy of accepting the overflow (and disabling the tile gate so every
 * pixel walks every slot's cluster list) is what hung the GPU on 2026-09-14.
 */
export function budgetFit(groupCounts: number[], cap: number): { kept: number; culled: number } {
  let used = 0;
  for (let i = 0; i < groupCounts.length; i++) {
    if (used + groupCounts[i]! > cap) return { kept: i, culled: groupCounts.length - i };
    used += groupCounts[i]!;
  }
  return { kept: groupCounts.length, culled: 0 };
}

export interface InstanceAttrSource {
  slot: number;
  centre: ArrayLike<number>;
  half: ArrayLike<number>;
  visible: boolean;
}

/**
 * Packs the live instances into the interleaved attribute array, densely from
 * index 0 (the draw's instanceCount is the returned n). Invisible sources are
 * skipped, not zeroed — a hidden instance simply is not drawn, and its stale
 * attribute row is never read because instanceCount excludes it.
 */
export function packInstanceAttrs(list: InstanceAttrSource[], out: Float32Array): number {
  let n = 0;
  for (const s of list) {
    if (!s.visible) continue;
    const o = n * INST_FLOATS;
    out[o] = s.centre[0]!; out[o + 1] = s.centre[1]!; out[o + 2] = s.centre[2]!;
    out[o + 3] = s.half[0]!; out[o + 4] = s.half[1]!; out[o + 5] = s.half[2]!;
    out[o + 6] = s.slot;
    n++;
  }
  return n;
}

export interface CrowdType {
  readonly name: string;
  readonly atlas: CrowdPrimAtlas;
  readonly records: CrowdRecords;
  /** The per-TYPE uniform block the shared material binds. */
  readonly uniforms: MarchUniforms;
  /** Instanced proxy boxes on SDF_LAYER (layers are set by the game page). */
  readonly mesh: THREE.Mesh;
  /** The quarter-res depth-prepass twin on DEPTH_PREPASS_LAYER. */
  readonly depthPreMesh: THREE.Mesh;
  /** The level-shadow TextureNode the shared material binds, for the game's
   *  per-frame `value = map` rebind (same mechanism as the per-body view). */
  readonly levelShadowTex: ReturnType<typeof texture>;
  /** The type's own GPU tile binding — one dispatch set for every instance. */
  readonly tiles: ComputeTileBinding;
  /** x instance capacity, y 1 (crowd material flag). Written by sync(). */
  readonly instCfg: ReturnType<typeof uniform>;
  /** Attaches a view to the lowest free slot; returns the slot, -1 when full.
   *  The view rebinds to this type's atlas band and record buffer. */
  attach(view: ZombieGpuView): number;
  /** Frees a slot and marks its record dead. */
  detach(slot: number): void;
  /** Per frame: repack instance attrs, bin the type's tile lists, flush the
   *  atlas and the record buffer. */
  sync(
    camera: THREE.PerspectiveCamera,
    grid: { tilesX: number; tilesY: number; tilePx: number },
  ): void;
  /** Rebinds the type's shared sampled-skeleton atlas/meta pair. */
  setSkeletonVolume(atlas: THREE.Texture, meta: THREE.Texture): void;
  /** The exact groups (and maxBlendK) the LAST sync() binned. The room-2
   *  slot-mask diagnostic feeds these to the CPU TileBinner — the bit-identical
   *  reference for the GPU binding — to learn each tile's distinct-slot set. */
  binInputs(): { groups: TileGroupInput[]; maxBlendK: number };
  info(): {
    attached: number; visible: number; tileFallbacks: number;
    culledByBudget: number; clampedTiles: number;
  };
}

export function createCrowdType(
  renderer: THREE.WebGPURenderer,
  name: string,
  uniforms: MarchUniforms,
  maxW: number,
  maxH: number,
  sources?: CrowdMaterialSources,
): CrowdType {
  // ONE shared prim atlas, ONE record buffer, ONE material pair, ONE tile
  // binding — the whole point of the type. The atlas is allocated at the
  // instance capacity up front: a DataTexture cannot resize in place.
  const atlas = createCrowdPrimAtlas(MAX_CROWD_INSTANCES);
  const records = createCrowdRecords();
  // y = 1 marks a crowd material (MARCH_TRACE_SETUP selects instCentre/
  // instHalf for the proxy box); x is the loop's instance-count upper bound.
  const instCfg = uniform(new THREE.Vector4(0, 1, 0, 0));
  const tiles = createComputeTileBinding(renderer, maxW, maxH);

  // Box in [-1, 1]^3, placed per instance by the material's positionNode.
  // NOT [-0.5, 0.5]: iHalf is a HALF extents, so positionGeometry * iHalf must
  // span ±half (the same box the fragment's bLo/bHi entry maths uses). A unit
  // [-0.5, 0.5] box would rasterise a half-size proxy and clip every silhouette.
  const geo = new THREE.InstancedBufferGeometry().copy(
    new THREE.BoxGeometry(2, 2, 2) as unknown as THREE.InstancedBufferGeometry,
  );
  const ib = new THREE.InstancedInterleavedBuffer(
    new Float32Array(MAX_CROWD_INSTANCES * INST_FLOATS), INST_FLOATS,
  );
  ib.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iCentre', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  geo.setAttribute('iHalf', new THREE.InterleavedBufferAttribute(ib, 3, 3));
  geo.setAttribute('iSlot', new THREE.InterleavedBufferAttribute(ib, 1, 6));
  geo.instanceCount = 0;

  const handles = createCrowdMaterial(atlas.texture, uniforms, { inst: records.node, instCfg }, tiles, sources);
  const mesh = new THREE.Mesh(geo, handles.material);
  mesh.frustumCulled = false; // the box attributes ARE the bounds; no double cull
  const depthPreMesh = new THREE.Mesh(geo, handles.depthPreMaterial);
  depthPreMesh.frustumCulled = false;

  const free = new Set<number>();
  for (let i = 0; i < MAX_CROWD_INSTANCES; i++) free.add(i);
  const slots: (ZombieGpuView | undefined)[] = new Array(MAX_CROWD_INSTANCES);
  let tileFallbacks = 0;
  let culledByBudget = 0;

  const instOut = ib.array as Float32Array;
  // Reused per frame — the pack is CPU-side and the list is at most 64.
  const list: InstanceAttrSource[] = [];
  // Live instances, snapshotted then sorted nearest-first before the group
  // budget is applied. Reused; only its length changes.
  const live: {
    slot: number; centre: [number, number, number]; half: [number, number, number];
    groups: TileGroupInput[]; blendK: number;
  }[] = [];
  const drawnSlots: number[] = [];
  const groups: TileGroupInput[] = [];
  // Snapshot of the last binned inputs for the room-2 slot-mask diagnostic
  // and the on-demand clampedTiles count. Copied (not aliased) because
  // `groups` is reused next frame.
  const lastBinGroups: TileGroupInput[] = [];
  let lastBinMaxBlendK = 0;
  let lastCamera: THREE.PerspectiveCamera | null = null;
  let lastGrid: { tilesX: number; tilesY: number; tilePx: number } | null = null;
  // Diagnostic only: a CPU TileBinner over the last binned groups, built
  // lazily the first time info() is asked for clampedTiles and reused. Never
  // run per frame — the whole point of the compute binder is to keep the
  // per-frame bin on the GPU.
  let diagBinner: TileBinner | null = null;

  const levelShadowTex = (handles.material as unknown as {
    levelShadowTex: ReturnType<typeof texture>;
  }).levelShadowTex;

  return {
    name, atlas, records, uniforms, mesh, depthPreMesh, levelShadowTex, tiles, instCfg,

    attach(view) {
      const slot = allocateSlot(free);
      if (slot < 0) return -1;
      // Re-point the view's pack at this type's band + record before writing
      // anything, then mark it alive (syncRecord writes the whole record with
      // alive 1, so this is the belt to that braces).
      view.rebind({ sink: atlas.sink(slot), records, slot });
      records.alive(slot, true);
      slots[slot] = view;
      return slot;
    },

    detach(slot) {
      if (!slots[slot]) return;
      records.alive(slot, false);
      slots[slot] = undefined;
      free.add(slot);
    },

    sync(camera, grid) {
      groups.length = 0;
      list.length = 0;
      live.length = 0;
      drawnSlots.length = 0;
      let maxBlendK = 0;
      for (let s = 0; s < MAX_CROWD_INSTANCES; s++) {
        const v = slots[s];
        if (!v) continue;
        // Dead slots (detached, or a record the view has not synced) never
        // enter the pack. attached-but-hidden is NOT a state here: the game
        // hides the PER-BODY proxy when it attaches (the crowd box is what
        // draws the instance), so attach/detach is the visibility gate and
        // the packed instance is always visible.
        if (records.floats[s * REC_VEC4S * 4 + REC_WIND_ALIVE * 4 + 3]! < 0.5) continue;
        const p = v.object.position;
        const h = v.uniforms.bodyHalf.value;
        live.push({
          slot: s,
          centre: [p.x, p.y, p.z],
          half: [h.x, h.y, h.z],
          groups: v.getTileGroups(),
          blendK: records.floats[s * REC_VEC4S * 4 + REC_COUNTS * 4 + 3]!,
        });
      }

      // NEAREST-FIRST BUDGET (perf 7d). Sort by distance from the camera,
      // then cap the shared group list at MAX_TILE_GROUPS by dropping the
      // FARTHEST instances — never by disabling the tile gate and walking
      // every slot's full cluster list per step (the unbounded fallback that
      // hung the GPU for 330 s on 2026-09-14). A dropped instance is not
      // drawn this frame (visible: false) and its record's alive flag is left
      // untouched.
      const cam = camera.position;
      live.sort((a, b) => {
        const da = (a.centre[0] - cam.x) ** 2 + (a.centre[1] - cam.y) ** 2 + (a.centre[2] - cam.z) ** 2;
        const db = (b.centre[0] - cam.x) ** 2 + (b.centre[1] - cam.y) ** 2 + (b.centre[2] - cam.z) ** 2;
        return da - db;
      });
      const fit = budgetFit(live.map((i) => i.groups.length), MAX_TILE_GROUPS);
      culledByBudget = fit.culled;
      for (let i = 0; i < live.length; i++) {
        const inst = live[i]!;
        const visible = i < fit.kept;
        if (visible) {
          for (const g of inst.groups) groups.push(g);
          if (inst.blendK > maxBlendK) maxBlendK = inst.blendK;
          drawnSlots.push(inst.slot);
        }
        list.push({ slot: inst.slot, centre: inst.centre, half: inst.half, visible });
      }

      // Bin ONCE for every drawn instance of the type.
      lastBinGroups.length = 0;
      for (const g of groups) lastBinGroups.push(g);
      lastBinMaxBlendK = maxBlendK;
      lastCamera = camera;
      lastGrid = grid;
      const ok = tiles.bin(groups, camera, maxBlendK, {
        widthPx: grid.tilesX * grid.tilePx,
        heightPx: grid.tilesY * grid.tilePx,
      });

      const n = packInstanceAttrs(list, instOut);
      geo.instanceCount = n;
      ib.needsUpdate = true;

      if (!ok) {
        // The binder refused for a reason other than the group budget (which
        // is capped above). ZERO the slot count for this frame: every pixel
        // draws nothing rather than walking every slot's full cluster list
        // per step. tileCfg.x is NOT touched — it follows the game's tile
        // switch, not this frame's bin result.
        tileFallbacks++;
        instCfg.value.set(0, 1, 0, 0);
      } else {
        // Stamp the ACTIVE grid for the shader, exactly as wireViewTiles does.
        uniforms.tileCfg.value.set(
          uniforms.tileCfg.value.x, grid.tilesX, grid.tilePx, grid.tilesY,
        );
        // x is the loop upper bound — the attached high-water mark of the
        // DRAWN instances, not the capacity (free slots below it carry
        // alive = 0 and are skipped); y = 1 marks the crowd material.
        instCfg.value.set(highWater(drawnSlots), 1, 0, 0);
      }

      atlas.flush();
      records.flush();
    },

    setSkeletonVolume(atlasTex, meta) { handles.setSkeletonVolume(atlasTex, meta); },

    binInputs() { return { groups: lastBinGroups, maxBlendK: lastBinMaxBlendK }; },

    info() {
      let attached = 0;
      let visible = 0;
      for (let s = 0; s < MAX_CROWD_INSTANCES; s++) {
        if (!slots[s]) continue;
        attached++;
        if (records.floats[s * REC_VEC4S * 4 + REC_WIND_ALIVE * 4 + 3]! > 0.5) visible++;
      }
      // clampedTiles is diagnostic-only and computed ON DEMAND: a CPU
      // TileBinner over the last binned groups/camera (the same reference the
      // GPU binding is pinned bit-identical to) reports how many entries the
      // per-tile cap dropped. Doing it per frame would re-add the CPU binning
      // cost the compute port exists to remove; info() is called by the bench
      // after a run, not per frame.
      let clampedTiles = 0;
      if (lastCamera && lastGrid && lastBinGroups.length) {
        const wPx = lastGrid.tilesX * lastGrid.tilePx;
        const hPx = lastGrid.tilesY * lastGrid.tilePx;
        if (!diagBinner || diagBinner.widthPx !== wPx || diagBinner.heightPx !== hPx) {
          diagBinner = new TileBinner(wPx, hPx);
        }
        clampedTiles = diagBinner.bin(lastBinGroups, lastCamera, lastBinMaxBlendK).clampedTiles;
      }
      return { attached, visible, tileFallbacks, culledByBudget, clampedTiles };
    },
  };
}
