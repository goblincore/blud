// src/lab/sdf-zombie/webgpu/tile-bin-compute.ts
//
// GPU tile binning (perf task 5 step 5 — the compute port). Four tiny compute
// kernels replace the per-frame CPU bin + DataTexture upload:
//
//   kTileRange  one thread per group slot: projects the group's bound sphere
//               to a conservative screen-space tile AABB — the EXACT
//               arithmetic of TileBinner.bin, including the deliberate Y flip
//               and the behind-camera cover-everything rule — and stores the
//               integer range.
//   kTileCounts one thread per tile: counts covering groups by scanning the
//               ranges.
//   kTileScan   ONE thread: exclusive prefix sum -> per-tile (base, count)
//               headers + the total entry count.
//   kTileWrite  one thread per tile: walks groups in ASCENDING index order
//               and writes each covering group's record into the entry
//               stream.
//
// WHY NO ATOMICS AND NO ORDER PROBLEM. The CPU binner emits a tile's entries
// ordered by group index; smooth-min is not commutative in float arithmetic,
// so a reordering could shift the folded field. The scan/scatter scheme
// reproduces the ascending-group order exactly, which makes the GPU lists
// BIT-IDENTICAL to TileBinner for the same camera and groups — the unit gate
// this module exists to pass.
//
// WHY THE ENTRY CAP IS STRUCTURAL, NOT ENFORCED. One group contributes AT
// MOST ONE entry per tile, so a tile's list can never exceed the group slot
// count; MAX_TILE_GROUPS === TILE_MAX_ENTRIES makes the cap unreachable.
// Nothing is clamped and nothing can be truncated — the close-camera hole
// class dies with the texture that carried it.
//
// WHY NOTHING RESIZES. All buffers are allocated ONCE at the caller's
// worst-case grid; the ACTIVE grid dimensions travel in tileCfg every frame.
// That is what kills the scale bug: adaptive resolution changes rungs freely
// while the shader reads its grid from a uniform instead of inferring it from
// resource dimensions. Kernels dispatch at the fixed worst-case thread count
// with an early return past the active tiles/groups, so no pipeline or
// dispatch-size churn ever happens either.

import * as THREE from 'three/webgpu';
import { wgslFn, uniform, storage, instanceIndex, compute } from 'three/tsl';
import { TILE_MAX_ENTRIES, TILE_SIZE_PX, type TileGroupInput } from './tile-cull';

/**
 * Group slots in the groups buffer. EQUALS TILE_MAX_ENTRIES on purpose: a
 * tile's entry list can then never exceed the cap, because one group adds at
 * most one entry to any tile. Pinned by test — raise both or neither.
 */
export const MAX_TILE_GROUPS = TILE_MAX_ENTRIES;

/** Floats per group record: [centre.xyz, radius], [start,count,distort,flags]
 *  (the ROW_GROUP_RANGE texel verbatim), [bodyIndex, 0, 0, 0]. Three vec4s —
 *  the same shape as one entry stream record, which is why kTileWrite copies
 *  records through unchanged. */
export const GROUP_RECORD_SCALARS = 12;

/** Worst-case tile grid for an SDF-pass pixel size. */
export function worstCaseTiles(widthPx: number, heightPx: number): { tilesX: number; tilesY: number } {
  return {
    tilesX: Math.ceil(Math.max(1, widthPx) / TILE_SIZE_PX),
    tilesY: Math.ceil(Math.max(1, heightPx) / TILE_SIZE_PX),
  };
}

/** Worst-case entry-stream capacity in ENTRIES (one entry = 3 vec4): every
 *  tile listing every group. The same bound createTileTextures used. */
export function worstCaseEntries(tilesX: number, tilesY: number): number {
  return Math.max(1, tilesX * tilesY * TILE_MAX_ENTRIES);
}

/**
 * Packs the binner's group inputs into the groups-buffer layout. Returns
 * `out` for chaining. Exported pure so tests pin exactly what the kernels
 * read. More groups than MAX_TILE_GROUPS throws LOUDLY — callers should never
 * hit it (hero bodies run ~40), and silent dropping would delete whole tiles'
 * lists downstream.
 */
export function packGroups(groups: TileGroupInput[], out: Float32Array): Float32Array {
  if (groups.length > MAX_TILE_GROUPS) {
    throw new Error(
      `[tile-bin-compute] ${groups.length} groups exceed MAX_TILE_GROUPS (${MAX_TILE_GROUPS}); `
      + 'raise MAX_TILE_GROUPS and TILE_MAX_ENTRIES together',
    );
  }
  out.fill(0);
  for (let g = 0; g < groups.length; g++) {
    const s = groups[g]!;
    const o = g * GROUP_RECORD_SCALARS;
    out[o] = s.center[0];
    out[o + 1] = s.center[1];
    out[o + 2] = s.center[2];
    out[o + 3] = s.radius;
    out[o + 4] = s.start;
    out[o + 5] = s.count;
    out[o + 6] = s.distort;
    out[o + 7] = s.flags;
    out[o + 8] = s.bodyIndex;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kernel sources.
//
// Uniform packing (one vec4 each, so the kernels take flat params):
//   cfg  = (groupCount, blendReach, tilesX, tilesY)   — ACTIVE numbers
//   dims = (widthPx, heightPx, focalY, tileTotal)     — focalY = proj[5],
//                                                       tileTotal = ACTIVE
//                                                       tilesX*tilesY
//
// The projection block mirrors TileBinner.bin line for line; if one changes,
// change both (the unit A/B gate will say so loudly otherwise).
// ---------------------------------------------------------------------------

const PROJECTION_BLOCK = /* wgsl */ `
  let rBlend = radius + blendReach;
  let v4 = viewM * vec4<f32>(centre, 1.0);
  let nearDist = -v4.z - rBlend;
  let clip = projM * vec4<f32>(v4.xyz, 1.0);
  var tx0 = 0;
  var tx1 = -1;
  var ty0 = 0;
  var ty1 = -1;
  // Behind-camera / eye-plane-crossing spheres cover EVERY tile, exactly as
  // the CPU binner does — the cull may never omit a touching group.
  if (nearDist <= 0.0 || clip.w <= 0.0) {
    tx1 = i32(cfg.z) - 1;
    ty1 = i32(cfg.w) - 1;
  } else {
    let ndcX = clip.x / clip.w;
    let ndcY = clip.y / clip.w;
    let cx = (ndcX * 0.5 + 0.5) * dims.x;
    // Y IS FLIPPED HERE ON PURPOSE. NDC +Y is up; shader rows grow downward
    // (screenUV derives from @builtin(position)). See tile-cull.ts.
    let cy = (0.5 - ndcY * 0.5) * dims.y;
    // Screen extent at NEAREST depth — the largest projection possible.
    let rpix = (rBlend / nearDist) * dims.z * (dims.y * 0.5);
    // REJECT off-screen rather than clamp inward: edge-clamping would pin
    // far-off geometry onto the border columns.
    if (!(cx + rpix <= 0.0 || cx - rpix >= dims.x || cy + rpix <= 0.0 || cy - rpix >= dims.y)) {
      tx0 = max(0, i32(floor((cx - rpix) / ${TILE_SIZE_PX}.0)));
      tx1 = min(i32(cfg.z) - 1, i32(floor((cx + rpix - 1e-6) / ${TILE_SIZE_PX}.0)));
      ty0 = max(0, i32(floor((cy - rpix) / ${TILE_SIZE_PX}.0)));
      ty1 = min(i32(cfg.w) - 1, i32(floor((cy + rpix - 1e-6) / ${TILE_SIZE_PX}.0)));
    }
  }
`;

/** Thread i projects group i. Dispatched at MAX_TILE_GROUPS threads. */
export const K_TILE_RANGE = /* wgsl */ `fn kTileRange(
  groups: ptr<storage, array<vec4<f32>>, read>,
  outRanges: ptr<storage, array<vec4<i32>>, read_write>,
  viewM: mat4x4<f32>,
  projM: mat4x4<f32>,
  cfg: vec4<f32>,
  dims: vec4<f32>,
  gi: u32
) -> void {
  if (gi >= u32(cfg.x)) { return; }
  let rec = gi * 3u;
  let centre = (*groups)[rec].xyz;
  let radius = (*groups)[rec].w;
  let blendReach = cfg.y;
${PROJECTION_BLOCK}
  (*outRanges)[gi] = vec4<i32>(tx0, tx1, ty0, ty1);
}`;

/** Thread t counts how many group ranges cover tile t. Dispatched at the
 *  WORST-CASE tile count; threads past the active total return early. */
export const K_TILE_COUNTS = /* wgsl */ `fn kTileCounts(
  ranges: ptr<storage, array<vec4<i32>>, read>,
  outCounts: ptr<storage, array<u32>, read_write>,
  cfg: vec4<f32>,
  dims: vec4<f32>,
  ti: u32
) -> void {
  if (ti >= u32(dims.w)) { return; }
  let tx = i32(ti % u32(cfg.z));
  let ty = i32(ti / u32(cfg.z));
  var n = 0;
  for (var g = 0u; g < u32(cfg.x); g++) {
    let rg = (*ranges)[g];
    if (tx >= rg.x && tx <= rg.y && ty >= rg.z && ty <= rg.w) { n = n + 1; }
  }
  (*outCounts)[ti] = u32(n);
}`;

/** Single-thread exclusive prefix sum over the ACTIVE tiles: headers get
 *  (base, count), meta.x gets the total entry count. Also resets counts to
 *  zero for the next frame? No — counts are rewritten by kTileCounts every
 *  frame before this runs, so no clearing pass exists at all. */
export const K_TILE_SCAN = /* wgsl */ `fn kTileScan(
  counts: ptr<storage, array<u32>, read>,
  outHeaders: ptr<storage, array<vec2<u32>>, read_write>,
  outMeta: ptr<storage, array<vec4<f32>>, read_write>,
  dims: vec4<f32>
) -> void {
  var running = 0u;
  for (var t = 0u; t < u32(dims.w); t++) {
    var h = (*outHeaders)[t];
    h.x = running;
    h.y = (*counts)[t];
    (*outHeaders)[t] = h;
    running = running + h.y;
  }
  var m = (*outMeta)[0];
  m.x = f32(running);
  (*outMeta)[0] = m;
}`;

/** Thread t writes tile t's entries, walking groups in ASCENDING index order
 *  — the CPU binner's order, which is what makes the lists bit-identical. */
export const K_TILE_WRITE = /* wgsl */ `fn kTileWrite(
  groups: ptr<storage, array<vec4<f32>>, read>,
  ranges: ptr<storage, array<vec4<i32>>, read>,
  headers: ptr<storage, array<vec2<u32>>, read>,
  outEntries: ptr<storage, array<vec4<f32>>, read_write>,
  cfg: vec4<f32>,
  dims: vec4<f32>,
  ti: u32
) -> void {
  if (ti >= u32(dims.w)) { return; }
  let base = (*headers)[ti].x;
  let tx = i32(ti % u32(cfg.z));
  let ty = i32(ti / u32(cfg.z));
  var slot = base;
  for (var g = 0u; g < u32(cfg.x); g++) {
    let rg = (*ranges)[g];
    if (tx >= rg.x && tx <= rg.y && ty >= rg.z && ty <= rg.w) {
      let rec = g * 3u;
      let e = slot * 3u;
      (*outEntries)[e] = (*groups)[rec];
      (*outEntries)[e + 1u] = (*groups)[rec + 1u];
      (*outEntries)[e + 2u] = (*groups)[rec + 2u];
      slot = slot + 1u;
    }
  }
}`;

// ---------------------------------------------------------------------------

export interface ComputeTileBinding {
  /**
   * Bins this frame's posed groups on the GPU. Schedules all four dispatches
   * inside ONE compute pass on the renderer's queue, ordered before anything
   * three submits afterwards this frame — the march reads finished data.
   *
   * `camera` must have matrixWorldInverse current (the callers already do
   * `updateMatrixWorld` + invert, the same dance the CPU path required).
   *
   * `grid` is the ACTIVE SDF-pass size this frame; it only moves uniforms.
   * Pass the layer's targetSize every frame — adaptive resolution changes it
   * under your feet, and that is exactly the case this design exists to make
   * boring.
   */
  bin(
    groups: TileGroupInput[], camera: THREE.PerspectiveCamera, maxBlendK: number,
    grid: { widthPx: number; heightPx: number },
  ): void;
  /** Readback of headers/meta/entries for tests and debug tooling. */
  readback(): Promise<{
    /** Per-tile (base, count) pairs, length tilesX*tilesY*2 (ACTIVE grid). */
    headers: Uint32Array;
    entries: Float32Array;
    totalEntries: number;
    tilesX: number;
    tilesY: number;
  }>;
  /** Read-only storage nodes the march material binds. */
  readonly headerNode: unknown;
  readonly entryNode: unknown;
  dispose(): void;
}

/**
 * Creates the GPU binner for one tiled view. `maxWidthPx/maxHeightPx` are the
 * WORST-CASE SDF-pass pixel size (the full render size at scale 1.0, not
 * today's scaled size — the whole point is that scale changes reallocate
 * nothing).
 */
export function createComputeTileBinding(
  renderer: import('three/webgpu').WebGPURenderer,
  maxWidthPx: number, maxHeightPx: number,
): ComputeTileBinding {
  const { tilesX, tilesY } = worstCaseTiles(maxWidthPx, maxHeightPx);
  const maxTiles = tilesX * tilesY;
  const capEntries = worstCaseEntries(tilesX, tilesY);

  // Buffers, sized once at the worst case. StorageBufferAttribute(count,
  // itemSize) with the element type named in storage() below.
  const groupsAttr = new THREE.StorageBufferAttribute(MAX_TILE_GROUPS * 3, 4);
  const rangesAttr = new THREE.StorageBufferAttribute(MAX_TILE_GROUPS, 4);
  const countsAttr = new THREE.StorageBufferAttribute(maxTiles, 1);
  const headersAttr = new THREE.StorageBufferAttribute(maxTiles, 2);
  const entriesAttr = new THREE.StorageBufferAttribute(capEntries * 3, 4);
  const metaAttr = new THREE.StorageBufferAttribute(4, 1);

  const groupsBuf = storage(groupsAttr, 'vec4', MAX_TILE_GROUPS * 3);
  const rangesBufRw = storage(rangesAttr, 'ivec4', MAX_TILE_GROUPS);
  const countsBufRw = storage(countsAttr, 'uint', maxTiles);
  const headersBufRw = storage(headersAttr, 'uvec2', maxTiles);
  const entriesBufRw = storage(entriesAttr, 'vec4', capEntries * 3);
  const metaBufRw = storage(metaAttr, 'vec4', 4);

  // Fragment-stage views: WebGPU only permits READ-ONLY storage in fragment,
  // and the march only ever reads.
  const headerNode = storage(headersAttr, 'uvec2', maxTiles).toReadOnly();
  const entryNode = storage(entriesAttr, 'vec4', capEntries * 3).toReadOnly();

  const uView = uniform(new THREE.Matrix4());
  const uProj = uniform(new THREE.Matrix4());
  const uCfg = uniform(new THREE.Vector4());
  const uDims = uniform(new THREE.Vector4());

  const rangeCall = wgslFn(K_TILE_RANGE)(
    groupsBuf, rangesBufRw, uView, uProj, uCfg, uDims, instanceIndex,
  );
  const countsCall = wgslFn(K_TILE_COUNTS)(
    rangesBufRw, countsBufRw, uCfg, uDims, instanceIndex,
  );
  const scanCall = wgslFn(K_TILE_SCAN)(countsBufRw, headersBufRw, metaBufRw, uDims);
  const writeCall = wgslFn(K_TILE_WRITE)(
    groupsBuf, rangesBufRw, headersBufRw, entriesBufRw, uCfg, uDims, instanceIndex,
  );

  // Fixed dispatches at the WORST-case sizes, workgroup 64 (kTileScan runs a
  // single thread). Active counts travel in the uniforms; threads past them
  // return immediately.
  const rangeNode = compute(rangeCall, MAX_TILE_GROUPS, [64]);
  const countsNode = compute(countsCall, maxTiles, [64]);
  const scanNode = compute(scanCall, 1, [1]);
  const writeNode = compute(writeCall, maxTiles, [64]);

  let disposed = false;

  // Active grid, updated by bin() every frame from the caller's SDF-pass size.
  let activeTilesX = tilesX;
  let activeTilesY = tilesY;

  return {
    bin(groupsIn, camera, maxBlendK, grid) {
      if (disposed) throw new Error('tile binding disposed');
      if (groupsIn.length > MAX_TILE_GROUPS) {
        // Loud, never truncating — dropped groups would delete whole tiles'
        // lists and those pixels render as holes.
        throw new Error(
          `[tile-bin-compute] ${groupsIn.length} groups exceed MAX_TILE_GROUPS (${MAX_TILE_GROUPS})`,
        );
      }
      packGroups(groupsIn, groupsAttr.array as Float32Array);
      // BufferAttribute.version bump -> three re-uploads the (tiny) buffer.
      groupsAttr.needsUpdate = true;

      // The caller may hand a bigger grid than the worst case if its own
      // worst-case estimate changed; fail LOUDLY rather than corrupt memory.
      activeTilesX = Math.ceil(Math.max(1, grid.widthPx) / TILE_SIZE_PX);
      activeTilesY = Math.ceil(Math.max(1, grid.heightPx) / TILE_SIZE_PX);
      if (activeTilesX > tilesX || activeTilesY > tilesY) {
        throw new Error(
          `[tile-bin-compute] active grid ${activeTilesX}x${activeTilesY} exceeds `
          + `allocation ${tilesX}x${tilesY} — recreate the binding with the larger size`,
        );
      }

      const cfg = uCfg.value as THREE.Vector4;
      const dims = uDims.value as THREE.Vector4;
      cfg.set(groupsIn.length, maxBlendK * 4.0, activeTilesX, activeTilesY);
      dims.set(
        grid.widthPx, grid.heightPx,
        camera.projectionMatrix.elements[5]!, activeTilesX * activeTilesY,
      );

      (uView.value as THREE.Matrix4).copy(camera.matrixWorldInverse);
      (uProj.value as THREE.Matrix4).copy(camera.projectionMatrix);

      // ONE pass, kernels in dependency order; same-queue ordering puts the
      // finished data ahead of everything three renders this frame.
      renderer.compute([rangeNode, countsNode, scanNode, writeNode]);
    },
    async readback() {
      if (disposed) throw new Error('tile binding disposed');
      // Whole-buffer reads (count defaults to the full byte length). Only
      // tests and debug tooling call this.
      const headersAll = new Uint32Array(await renderer.getArrayBufferAsync(headersAttr));
      const meta = new Float32Array(await renderer.getArrayBufferAsync(metaAttr));
      const entriesAll = new Float32Array(await renderer.getArrayBufferAsync(entriesAttr));
      const headersOut = new Uint32Array(activeTilesX * activeTilesY * 2);
      headersOut.set(headersAll.subarray(0, headersOut.length));
      return {
        headers: headersOut,
        entries: entriesAll,
        totalEntries: Math.round(meta[0]!),
        tilesX: activeTilesX,
        tilesY: activeTilesY,
      };
    },
    headerNode,
    entryNode,
    dispose() {
      // three 0.185 BufferAttribute has no dispose(); the GPU buffers are
      // owned by the renderer's attribute cache and released with the device
      // context. Marking disposed prevents any further use-after-close.
      disposed = true;
    },
  };
}
