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
  createCrowdRecords, MAX_CROWD_INSTANCES, REC_VEC4S, REC_COUNTS, REC_WIND_ALIVE,
  type CrowdRecords,
} from './crowd-records';
import { createComputeTileBinding, type ComputeTileBinding } from './tile-bin-compute';
import { type TileGroupInput } from './tile-cull';
import {
  createCrowdMaterial, type CrowdMaterialSources, type MarchUniforms, type ZombieGpuView,
} from './zombie-gpu';

/** Floats per instance in the interleaved attribute buffer: iCentre.xyz,
 *  iHalf.xyz, iSlot. */
export const INST_FLOATS = 7;

/**
 * Lowest free slot, removed from `free`. -1 when the type is full. Linear in
 * the free-set size, and the set only ever holds free slots, so a full type
 * costs 64 checks — cheaper than a heap for this size and deterministic.
 */
export function allocateSlot(free: Set<number>): number {
  let best = -1;
  for (const s of free) if (best < 0 || s < best) best = s;
  if (best >= 0) free.delete(best);
  return best;
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
  info(): { attached: number; visible: number; tileFallbacks: number };
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

  const instOut = ib.array as Float32Array;
  // Reused per frame — the pack is CPU-side and the list is at most 64.
  const list: InstanceAttrSource[] = [];
  const groups: TileGroupInput[] = [];

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
        for (const g of v.getTileGroups()) groups.push(g);
        const bk = records.floats[s * REC_VEC4S * 4 + REC_COUNTS * 4 + 3]!;
        if (bk > maxBlendK) maxBlendK = bk;
        const p = v.object.position;
        const h = v.uniforms.bodyHalf.value;
        list.push({ slot: s, centre: [p.x, p.y, p.z], half: [h.x, h.y, h.z], visible: true });
      }

      // Bin ONCE for every instance of the type. Over the group budget the
      // binding returns false; disable the tile gate for this frame and the
      // per-slot loop in MAP_BODY walks every slot's cluster list instead —
      // correct, just slower. Counted for the bench.
      const ok = tiles.bin(groups, camera, maxBlendK, {
        widthPx: grid.tilesX * grid.tilePx,
        heightPx: grid.tilesY * grid.tilePx,
      });
      if (!ok) {
        tileFallbacks++;
        uniforms.tileCfg.value.x = 0;
      } else {
        // Stamp the ACTIVE grid for the shader, exactly as wireViewTiles does.
        uniforms.tileCfg.value.set(
          uniforms.tileCfg.value.x, grid.tilesX, grid.tilePx, grid.tilesY,
        );
      }

      const n = packInstanceAttrs(list, instOut);
      geo.instanceCount = n;
      ib.needsUpdate = true;
      // x is the loop upper bound (the capacity; the alive flag skips free
      // slots), y = 1 marks the crowd material for the box-entry select.
      instCfg.value.set(MAX_CROWD_INSTANCES, 1, 0, 0);

      atlas.flush();
      records.flush();
    },

    setSkeletonVolume(atlasTex, meta) { handles.setSkeletonVolume(atlasTex, meta); },

    info() {
      let attached = 0;
      let visible = 0;
      for (let s = 0; s < MAX_CROWD_INSTANCES; s++) {
        if (!slots[s]) continue;
        attached++;
        if (records.floats[s * REC_VEC4S * 4 + REC_WIND_ALIVE * 4 + 3]! > 0.5) visible++;
      }
      return { attached, visible, tileFallbacks };
    },
  };
}
