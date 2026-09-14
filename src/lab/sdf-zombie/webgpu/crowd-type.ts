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
import { TileBinner, TILE_SIZE_PX, type TileGroupInput } from './tile-cull';
import { crowdScreenRect } from './crowd-rect';
import { RAY_CULL_SLACK, QUAD_ENTRY_SLACK } from './march.wgsl';
import { MAX_PRIMS } from '../validate';
import {
  createCrowdMaterial, type CrowdMaterialSources, type MarchUniforms, type ZombieGpuView,
} from './zombie-gpu';
import type { GameTelemetry } from './game-telemetry';

// Re-exported for the existing `./crowd-type` import sites; the function itself
// now lives beside the record buffer it allocates from (task 7c), so
// zombie-gpu.ts can reuse it without a circular import.
export { allocateSlot };

/** Floats per instance in the interleaved attribute buffer: iCentre.xyz,
 *  iHalf.xyz, iSlot. */
export const INST_FLOATS = 7;

/** Crowd dispatch (stage a-2): one instanced proxy box per body, or one
 *  screen-covering quad per type whose fragment is the union field. */
export type CrowdDispatch = 'boxes' | 'quad';

/** The full-screen quad a quad-dispatch crowd type draws. PlaneGeometry(2, 2)
 *  spans clip xy in [-1, 1]; the material's vertexNode keeps it on the far
 *  plane and reconstructs the pixel ray from screenUV (see crowdRayNodes). */
export function createCrowdQuadGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(2, 2);
}

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
  /** Active dispatch, stamped into instCfg.y on the next sync() (1 boxes,
   *  2 quad). Swap it with setDispatch(). */
  readonly dispatch: CrowdDispatch;
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
  /** The quad dispatch's NDC rasterisation rect, shared by the lit material
   *  and its depth-pre twin. Set by sync() in quad mode. */
  readonly quadRect: { value: THREE.Vector4 };
  /** Attaches a view to the lowest free slot; returns the slot, -1 when full.
   *  The view rebinds to this type's atlas band and record buffer. */
  attach(view: ZombieGpuView): number;
  /** Frees a slot and marks its record dead. */
  detach(slot: number): void;
  /** Per frame: repack instance attrs, bin the type's tile lists, flush the
   *  atlas and the record buffer. `visibleSlots` is the game's visible set for
   *  THIS type (frustum + clear-sight cull); a slot not in it stays attached
   *  and alive but is neither packed nor binned this frame. */
  sync(
    camera: THREE.PerspectiveCamera,
    grid: { tilesX: number; tilesY: number; tilePx: number },
    visibleSlots: ReadonlySet<number>,
  ): void;
  /** Rebinds the type's shared sampled-skeleton atlas/meta pair. */
  setSkeletonVolume(atlas: THREE.Texture, meta: THREE.Texture): void;
  /** Swaps between the instanced proxy boxes and the one-screen-quad dispatch.
   *  The instCfg.y stamp and the tile rebin land on the next sync(). */
  setDispatch(mode: CrowdDispatch): void;
  /** The exact groups (and maxBlendK) the LAST sync() binned. The room-2
   *  slot-mask diagnostic feeds these to the CPU TileBinner — the bit-identical
   *  reference for the GPU binding — to learn each tile's distinct-slot set. */
  binInputs(): { groups: TileGroupInput[]; maxBlendK: number };
  info(): {
    attached: number; visible: number; tileFallbacks: number; tilesOn: boolean;
    culledByBudget: number; clampedTiles: number; dispatch: CrowdDispatch;
    /** Last quad NDC rect (null in boxes mode or when nothing is visible). */
    rect: [number, number, number, number] | null;
    /** Fraction of the screen the quad rasterised last frame (rect area / 4). */
    rectFrac: number;
    /** Mean camera-to-body-centre distance in metres over the DRAWN instances
     *  of the last sync() (0 with no drawn instance or no camera yet). The
     *  distance-crowd bench's scene descriptor: at the level's 11 m diagonal
     *  this is what says whether the row measured a distant crowd or a
     *  close-up stack. */
    meanDistance: number;
    /** Fire/gib profiling (2026-09-14): partial atlas uploads performed by
     *  sync() (one queue write per drawn type with dirty bands), the rows those
     *  uploads covered, and whole-record-buffer flushes. */
    atlasFlushes: number;
    atlasRows: number;
    recordsFlushes: number;
    /** setSkeletonVolume() calls that actually rebound the material pair. */
    volumeRebinds: number;
    /** Frames where the type had NO drawn instances and sync() therefore
     *  skipped the tile-bin compute entirely (startup-hitch work, 2026-09-14:
     *  an idle type paid four compute dispatches per frame for nothing). */
    idleSkips: number;
  };
}

export function createCrowdType(
  renderer: THREE.WebGPURenderer,
  name: string,
  uniforms: MarchUniforms,
  maxW: number,
  maxH: number,
  sources?: CrowdMaterialSources,
  opts?: { dispatch?: CrowdDispatch; telemetry?: Pick<GameTelemetry, 'begin' | 'end'> },
): CrowdType {
  // ONE shared prim atlas, ONE record buffer, ONE material pair, ONE tile
  // binding — the whole point of the type. The atlas is allocated at the
  // instance capacity up front: a DataTexture cannot resize in place.
  const atlas = createCrowdPrimAtlas(MAX_CROWD_INSTANCES, (rows, data) => {
    // Fire/gib fix (2026-09-14): ONE partial upload of the dirty prefix into
    // the atlas's EXISTING GPU texture. `backend.updateTexture` accepts an
    // image override and issues a single `queue.writeTexture` of `rows` rows
    // (three's DataTexture path reads options.image, see WebGPUTextureUtils).
    // The atlas texture itself is created full-size by the first render; from
    // then on three's whole-atlas `needsUpdate` path is never used for it.
    // Before the atlas exists (first frame) this is a no-op and the render
    // uploads it once in full.
    (renderer.backend as unknown as {
      updateTexture(t: THREE.Texture, o: { image: { data: Float32Array; width: number; height: number } }): void;
    }).updateTexture(atlas.texture, { image: { data, width: MAX_PRIMS, height: rows } });
  });
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

  // QUAD DISPATCH (stage a-2): the second geometry/material pair. One screen
  // quad per type draws a single fragment per pixel and reconstructs the pixel
  // ray from screenUV; MARCH_TRACE_SETUP takes its entry from the tile spheres.
  const quadGeo = createCrowdQuadGeometry();

  const handles = createCrowdMaterial(
    atlas.texture, uniforms, { inst: records.node, instCfg }, tiles, sources, 'boxes',
  );
  // The quad material shares the boxes material's level-shadow node so the
  // game's single per-frame rebind (`t.levelShadowTex.value = map`) reaches
  // whichever dispatch is active; both otherwise start on the 1x1 fallback.
  const quadHandles = createCrowdMaterial(
    atlas.texture, uniforms, { inst: records.node, instCfg }, tiles, sources, 'quad',
    (handles.material as unknown as { levelShadowTex: ReturnType<typeof texture> }).levelShadowTex,
  );
  // Quad dispatch's rasterisation rect; the lit and depth-pre materials share
  // this one uniform (see crowdRayNodes).
  const quadRect = quadHandles.quadRect as { value: THREE.Vector4 };
  let dispatch: CrowdDispatch = opts?.dispatch ?? 'boxes';
  const activeHandles = () => (dispatch === 'quad' ? quadHandles : handles);
  const activeGeometry = () => (dispatch === 'quad' ? quadGeo : geo);
  const mesh = new THREE.Mesh(activeGeometry(), activeHandles().material);
  mesh.frustumCulled = false; // the box attributes ARE the bounds; no double cull
  const depthPreMesh = new THREE.Mesh(activeGeometry(), activeHandles().depthPreMaterial);
  depthPreMesh.frustumCulled = false;

  const free = new Set<number>();
  for (let i = 0; i < MAX_CROWD_INSTANCES; i++) free.add(i);
  const slots: (ZombieGpuView | undefined)[] = new Array(MAX_CROWD_INSTANCES);
  let tileFallbacks = 0;
  let culledByBudget = 0;
  // Instances actually packed/drawn by the LAST sync(). info().visible reads
  // this, not the alive-record count: attached-but-hidden is a real state now
  // (the game attaches every actor at spawn and filters per frame).
  let packedCount = 0;
  // Fire/gib profiling counters (2026-09-14): see info()'s atlasFlushes /
  // recordsFlushes / volumeRebinds.
  let atlasFlushes = 0;
  let atlasRows = 0;
  let recordsFlushes = 0;
  let volumeRebinds = 0;
  // Frames where the type drew nothing and the tile-bin compute was skipped.
  let idleSkips = 0;

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
  // Reused inputs for the quad's screen rect (the drawn instances).
  const rectList: { centre: ArrayLike<number>; half: ArrayLike<number> }[] = [];
  // Mean camera-to-drawn-centre distance over the last sync (distance scene).
  let lastMeanDistance = 0;
  const viewProj = new THREE.Matrix4();
  let lastRect: [number, number, number, number] | null = null;
  let lastRectFrac = 0;
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
    name, atlas, records, uniforms, mesh, depthPreMesh, levelShadowTex, tiles, instCfg, quadRect,
    get dispatch() { return dispatch; },

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

    sync(camera, grid, visibleSlots) {
      groups.length = 0;
      list.length = 0;
      live.length = 0;
      drawnSlots.length = 0;
      let maxBlendK = 0;
      for (let s = 0; s < MAX_CROWD_INSTANCES; s++) {
        // VISIBLE-ONLY PACKING (perf 7e). `?crowd=1` attaches EVERY actor at
        // spawn; the per-body baseline draws only the frustum+clear-sight
        // culled set (updateVisibleActors). Packing the whole cast made the
        // crowd path cost track the LEVEL, not the visible bodies — and the
        // off-room behind-camera instance groups saturated every tile's
        // 64-entry cap. A slot outside the set stays attached and alive; its
        // record keeps its band, so re-showing costs nothing.
        if (!visibleSlots.has(s)) continue;
        const v = slots[s];
        if (!v) continue;
        // Dead slots (detached, or a record the view has not synced) never
        // enter the pack.
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

      // Bin ONCE for every drawn instance of the type. An IDLE TYPE (nothing
      // drawn after the visible filter and the group budget) skips the bin
      // entirely: it used to dispatch all four kernels per frame per type —
      // 24 compute dispatches per frame for the boot cast's six types, most
      // of them for types with no instance on screen — and each dispatch was
      // timestamp-tracked, feeding the compute query pool. The stale tile
      // lists an idle skip leaves behind are unread: nothing of this type
      // draws this frame (boxes: instanceCount 0; quad: rect null hides both
      // meshes), and the next frame that DOES draw re-bins before drawing
      // (same-queue ordering).
      let ok = false;
      if (drawnSlots.length > 0) {
        lastBinGroups.length = 0;
        for (const g of groups) lastBinGroups.push(g);
        lastBinMaxBlendK = maxBlendK;
        ok = tiles.bin(groups, camera, maxBlendK, {
          widthPx: grid.tilesX * grid.tilePx,
          heightPx: grid.tilesY * grid.tilePx,
        });
      } else {
        idleSkips++;
      }
      lastCamera = camera;
      lastGrid = grid;

      // MEAN CAMERA-TO-BODY DISTANCE over the DRAWN set (distance scene,
      // 2026-09-14). `live` is nearest-first and holds every packed instance
      // with its centre; `drawnSlots` is the subset the group budget kept, so
      // this is the distance to what is actually rendered. Diagnostic-only:
      // computed once per sync from data already in hand, no per-frame cost.
      {
        let sum = 0;
        let count = 0;
        for (const inst of live) {
          if (!drawnSlots.includes(inst.slot)) continue;
          const c = inst.centre;
          sum += Math.hypot(c[0] - cam.x, c[1] - cam.y, c[2] - cam.z);
          count++;
        }
        lastMeanDistance = count > 0 ? sum / count : 0;
      }

      // QUAD RASTERISATION RECT (stage a-2 (3)). Bound the quad to the union
      // screen rect of the DRAWN instances so the material runs only over the
      // pixels a body can occupy. The rect is conservative — the same inflated
      // spheres the binner projects, plus one tile of NDC margin for its
      // clamp-outward-to-whole-tiles rule — and the margin uses the LIT grid
      // (the larger target), which keeps the quarter-res depth-pre twin inside
      // it too. screenUV and the entry maths are untouched, so every pixel
      // inside is bit-identical to the full-screen version.
      if (dispatch === 'quad') {
        rectList.length = 0;
        for (const i of list) if (i.visible) rectList.push(i);
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        // Same reach the kernel's quad entry uses: maxBlendK * 4 + both slacks.
        const reach = maxBlendK * 4 + Number(RAY_CULL_SLACK) + Number(QUAD_ENTRY_SLACK);
        const marginNdc: [number, number] = [
          (2 * TILE_SIZE_PX) / (grid.tilesX * grid.tilePx),
          (2 * TILE_SIZE_PX) / (grid.tilesY * grid.tilePx),
        ];
        const rect = crowdScreenRect(rectList, viewProj, reach, marginNdc,
          camera.coordinateSystem === THREE.WebGPUCoordinateSystem);
        lastRect = rect;
        lastRectFrac = rect ? ((rect[2] - rect[0]) * (rect[3] - rect[1])) / 4 : 0;
        if (rect) {
          quadRect.value.set(rect[0], rect[1], rect[2], rect[3]);
          mesh.visible = true;
          depthPreMesh.visible = true;
        } else {
          // No visible instance: skip both draws entirely. The atlas/record
          // flush below still runs (other types share the buffer).
          mesh.visible = false;
          depthPreMesh.visible = false;
        }
      } else {
        mesh.visible = true;
        depthPreMesh.visible = true;
        lastRect = null;
        lastRectFrac = 0;
      }

      // BOX DISPATCH: pack the live instances densely and draw that many proxy
      // boxes. QUAD DISPATCH: one non-instanced screen quad draws every pixel,
      // so there is no attribute pack and no instanceCount — but keep the box
      // buffer at 0 so a later setDispatch('boxes') cannot draw stale rows
      // before its own sync repacks them.
      if (dispatch === 'boxes') {
        const n = packInstanceAttrs(list, instOut);
        geo.instanceCount = n;
        ib.needsUpdate = true;
      } else {
        geo.instanceCount = 0;
      }
      // info().visible is the game-visible body count for BOTH dispatches (in
      // box mode it equals the pack length).
      packedCount = drawnSlots.length;

      if (drawnSlots.length === 0) {
        // Idle: nothing of this type draws, so pin the instance count to zero
        // (the quad mesh is already hidden by the rect block below / box
        // instanceCount is 0) and leave the grid stamp alone — nothing reads
        // it this frame.
        instCfg.value.set(0, dispatch === 'quad' ? 2 : 1, 0, 0);
      } else if (!ok) {
        // The binder refused for a reason other than the group budget (which
        // is capped above). ZERO the slot count for this frame: every pixel
        // draws nothing rather than walking every slot's full cluster list
        // per step. tileCfg.x is NOT touched — it follows the game's tile
        // switch, not this frame's bin result.
        tileFallbacks++;
        if (dispatch === 'quad') instCfg.value.set(0, 2, 0, 0);
        else instCfg.value.set(0, 1, 0, 0);
      } else {
        // Stamp the ACTIVE grid for the shader, exactly as wireViewTiles does.
        uniforms.tileCfg.value.set(
          uniforms.tileCfg.value.x, grid.tilesX, grid.tilePx, grid.tilesY,
        );
        // x is the loop upper bound — the attached high-water mark of the
        // DRAWN instances, not the capacity (free slots below it carry
        // alive = 0 and are skipped). y selects the entry mode: 1 instanced
        // proxy box, 2 screen quad. w carries the type's max blend K to the
        // quad path's tile-sphere inflation (the box path reads the record).
        instCfg.value.set(highWater(drawnSlots), dispatch === 'quad' ? 2 : 1, 0, maxBlendK);
      }

      // Fire/gib profiling (2026-09-14): the flush is where the atlas is
      // re-uploaded, but only the bands written this frame — and only when the
      // type will actually draw. A hidden type keeps its dirty flags so the
      // first frame it draws uploads before drawing (nothing reads the atlas
      // while `mesh.visible` is false).
      const flushTiming = opts?.telemetry?.begin();
      if (drawnSlots.length > 0) {
        // Cap the upload to the highest DRAWN band: bands written for hidden
        // slots (every attached actor uploads each frame) need not go up.
        let hiDrawn = -1;
        for (const s of drawnSlots) if (s > hiDrawn) hiDrawn = s;
        const rows = atlas.flush(hiDrawn);
        if (rows > 0) { atlasFlushes++; atlasRows += rows; }
        if (records.dirty) { recordsFlushes++; records.flush(); }
      }
      opts?.telemetry?.end('crowd-atlas-flush', flushTiming);
    },

    setSkeletonVolume(atlasTex, meta) {
      // Fire/gib profiling (2026-09-14): count and time each actual rebind of
      // the type's four texture nodes (lit + depth-pre, boxes + quad).
      const rebindTiming = opts?.telemetry?.begin();
      volumeRebinds++;
      handles.setSkeletonVolume(atlasTex, meta);
      quadHandles.setSkeletonVolume(atlasTex, meta);
      opts?.telemetry?.end('crowd-volume-rebind', rebindTiming);
    },

    setDispatch(mode) {
      if (mode === dispatch) return;
      dispatch = mode;
      mesh.geometry = activeGeometry();
      mesh.material = activeHandles().material;
      depthPreMesh.geometry = activeGeometry();
      depthPreMesh.material = activeHandles().depthPreMaterial;
    },

    binInputs() { return { groups: lastBinGroups, maxBlendK: lastBinMaxBlendK }; },

    info() {
      let attached = 0;
      for (let s = 0; s < MAX_CROWD_INSTANCES; s++) {
        if (!slots[s]) continue;
        attached++;
      }
      // The count actually PACKED by the last sync() (the game's visible set),
      // not the alive-record census — see packedCount above.
      const visible = packedCount;
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
      // tilesOn mirrors the entry mode the shader will take: tileCfg.x is
      // stamped to 1 by the game's crowd sync (task 8: crowd mode requires the
      // tile list), so this reads the ACTUAL uniform rather than a guess.
      const tilesOn = uniforms.tileCfg.value.x > 0.5;
      return { attached, visible, tileFallbacks, tilesOn, culledByBudget, clampedTiles, dispatch, rect: lastRect, rectFrac: lastRectFrac, meanDistance: lastMeanDistance, atlasFlushes, atlasRows, recordsFlushes, volumeRebinds, idleSkips };
    },
  };
}
