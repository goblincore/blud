// src/lab/sdf-zombie/webgpu/surface-nets-compute.ts
//
// GPU side of the hull extraction: buffers sized ONCE at the worst case,
// compute nodes built once, a per-frame extract() that moves only uniforms
// (the tile-bin-compute rule: grids come from uniforms, never from resource
// dimensions, so no pipeline churn). Consumers draw the soup through
// `soupAttribute` (a StorageBufferAttribute used as the geometry's position,
// itemSize 3) with `indirect` as the draw arguments.
import * as THREE from 'three/webgpu';
import { wgslFn, uniform, storage, instanceIndex, compute, workgroupId, localId, texture, texture3D } from 'three/tsl';
import { HELPERS } from './march.wgsl';
import type { MarchUniforms } from './zombie-gpu';
import { BLOCK, fitHullGrid, type HullGrid } from './surface-nets-cpu';
import {
  HULL_NETS_CHAIN, HULL_QUADS_CHAIN, K_HULL_ARGS,
  MAX_CELL_VERTS, MAX_SOUP_VERTS,
} from './surface-nets.wgsl';

export const MAX_DIM = 160;

export function hullCapacities() {
  return {
    cells: MAX_DIM ** 3,
    blocks: (MAX_DIM / BLOCK) ** 3,
    cellVerts: MAX_CELL_VERTS,
    soupVerts: MAX_SOUP_VERTS,
    soupFloats: MAX_SOUP_VERTS * 3,
  };
}

export function packGridUniforms(grid: HullGrid, band: number, distort: number) {
  const bx = grid.dims[0] / BLOCK, by = grid.dims[1] / BLOCK, bz = grid.dims[2] / BLOCK;
  return {
    gridCfg: [grid.cell, band, distort, bx] as [number, number, number, number],
    gridDims: [grid.dims[0], grid.dims[1], grid.dims[2], by] as [number, number, number, number],
    blockCount: bx * by * bz,
    cellCount: grid.dims[0] * grid.dims[1] * grid.dims[2],
  };
}

/** Kernel chain: the march HELPERS (one edge each — NOT acc.slice(), the
 *  quadratic form was a 57 s boot), then the hull sources on the end. */
function chainOf(sources: readonly string[]) {
  return sources.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
}
function buildKernels() {
  // Pass 1 needs the whole march field; pass 2 only its three helpers.
  const nets = chainOf([...HELPERS, ...HULL_NETS_CHAIN]).at(-1)!;
  const quads = chainOf(HULL_QUADS_CHAIN).at(-1)!;
  const args = wgslFn(K_HULL_ARGS);
  return { nets, quads, args };
}

export interface HullExtractStats {
  cellVerts: number; soupVerts: number; overflow: boolean; dropped: number;
  blockCount: number; cellCount: number; grid: HullGrid;
}

export interface SurfaceNetsCompute {
  /** Geometry position source (itemSize 3). */
  soupAttribute: THREE.StorageBufferAttribute;
  /** drawIndirect arguments (vertexCount, 1, 0, 0). */
  indirect: THREE.IndirectStorageBufferAttribute;
  /** Run the three kernels for one body. Call after the body's data texture
   *  has been uploaded for this frame. */
  extract(renderer: THREE.WebGPURenderer, centre: THREE.Vector3, half: THREE.Vector3, origin: THREE.Vector3,
          cell: number, band: number, distort: number): HullExtractStats;
  /** Test/parity only: meta + cell positions back to the CPU. */
  readback(renderer: THREE.WebGPURenderer): Promise<{ meta: Uint32Array; cellPos: Float32Array; soup: Float32Array }>;
  dispose(): void;
}

export function createSurfaceNetsCompute(
  dataTex: THREE.Texture, volumeTex: THREE.Texture, u: MarchUniforms,
): SurfaceNetsCompute {
  const cap = hullCapacities();
  const cellVertAttr = new THREE.StorageBufferAttribute(cap.cells, 1);
  const cellEdgeAttr = new THREE.StorageBufferAttribute(cap.cells, 1);
  const cellPosAttr = new THREE.StorageBufferAttribute(cap.cellVerts * 3, 1);
  const soupAttr = new THREE.StorageBufferAttribute(cap.soupVerts, 3);
  const countersAttr = new THREE.StorageBufferAttribute(4, 1);
  const metaAttr = new THREE.StorageBufferAttribute(4, 1);
  // Typed array, not a count: the 0.185 .d.ts only declares the TypedArray
  // constructor form for IndirectStorageBufferAttribute (the JS takes both).
  const indirect = new THREE.IndirectStorageBufferAttribute(new Uint32Array(4), 1);

  const cellVert = storage(cellVertAttr, 'uint', cap.cells);
  const cellEdge = storage(cellEdgeAttr, 'uint', cap.cells);
  const cellPos = storage(cellPosAttr, 'float', cap.cellVerts * 3);
  const soup = storage(soupAttr, 'float', cap.soupVerts * 3);
  const counters = storage(countersAttr, 'uint', 4).toAtomic();
  const meta = storage(metaAttr, 'uint', 4);
  const args = storage(indirect, 'uint', 4);

  const uGridMin = uniform(new THREE.Vector3());
  const uGridCfg = uniform(new THREE.Vector4());
  const uGridDims = uniform(new THREE.Vector4());
  const uOrigin = uniform(new THREE.Vector3());

  const k = buildKernels();
  // POSITIONAL against the WGSL signatures. Re-read the parameter list in
  // surface-nets.wgsl.ts before touching this call — a misordered slot dies
  // at pipeline creation with a bare type-mismatch.
  const netsCall = k.nets(
    texture(dataTex), texture3D(volumeTex),
    u.counts, u.counts2, u.woundCfg, u.woundCfg2,
    u.volumePose0, u.volumePose1, u.volumeMin, u.volumeInvExtent, u.volumeWarp, u.volumeClip, u.perfCfg,
    uGridMin, uGridCfg, uGridDims, uOrigin,
    cellVert, cellEdge, cellPos, counters,
    workgroupId, localId,
  );
  const quadsCall = k.quads(uGridDims, cellVert, cellEdge, cellPos, soup, counters, instanceIndex);
  const argsCall = k.args(counters, args, meta);

  // Worst-case dispatch counts; kernels early-out past the live grid. The
  // NETS kernel carries workgroupBarrier(), so it must be dispatched by an
  // explicit WORKGROUP dispatchSize [blocks,1,1], NOT an invocation count:
  // a numeric count makes three emit `if (instanceIndex >= count) return;`
  // ahead of the kernel call (ComputeNode.js ~213), and Tint rejects the
  // barrier as non-uniform control flow behind that guard. With an array,
  // count stays null, no guard is emitted, and the barrier is uniform. The
  // other two kernels have no barrier and keep the invocation-count form.
  // (the .d.ts types count as number only — the array dispatchSize form is
  // supported at runtime, ComputeNode.js `compute()` ~291; cast, don't build)
  const netsNode = compute(netsCall, [cap.blocks, 1, 1] as unknown as number, [BLOCK, BLOCK, BLOCK]);
  const quadsNode = compute(quadsCall, cap.cells, [64]);
  const argsNode = compute(argsCall, 1, [1]);

  const countersZero = countersAttr.array as Uint32Array;
  let last: HullExtractStats | null = null;

  return {
    soupAttribute: soupAttr,
    indirect,
    extract(renderer, centre, half, origin, cell, band, distort) {
      const grid = fitHullGrid(
        [centre.x, centre.y, centre.z], [half.x, half.y, half.z], cell, band, MAX_DIM);
      const g = packGridUniforms(grid, band, distort);
      uGridMin.value.set(grid.min[0], grid.min[1], grid.min[2]);
      uGridCfg.value.set(...g.gridCfg);
      uGridDims.value.set(...g.gridDims);
      uOrigin.value.copy(origin);
      // Counters reset by upload: cheapest correct thing for 16 bytes.
      countersZero.fill(0);
      countersAttr.needsUpdate = true;
      renderer.compute([netsNode, quadsNode, argsNode]);
      last = { cellVerts: -1, soupVerts: -1, overflow: false, dropped: -1,
               blockCount: g.blockCount, cellCount: g.cellCount, grid };
      return last;
    },
    async readback(renderer) {
      const metaBuf = new Uint32Array(await renderer.getArrayBufferAsync(metaAttr));
      const cellPosBuf = new Float32Array(await renderer.getArrayBufferAsync(cellPosAttr));
      const soupBuf = new Float32Array(await renderer.getArrayBufferAsync(soupAttr));
      return { meta: metaBuf, cellPos: cellPosBuf.subarray(0, metaBuf[1]! * 3), soup: soupBuf.subarray(0, metaBuf[2]! * 3) };
    },
    dispose() {
      for (const a of [cellVertAttr, cellEdgeAttr, cellPosAttr, soupAttr, countersAttr, metaAttr, indirect]) {
        (a as unknown as { dispose?: () => void }).dispose?.();
      }
    },
  };
}
