// src/lab/sdf-zombie/webgpu/surface-nets.wgsl.ts
//
// GPU surface-nets hull extraction (hull-refine spec §4; plan deviation 1
// folds occupancy into the kernel prologue). A transliteration of
// surface-nets-cpu.ts — read that file's comments first; this one only notes
// what differs on the GPU.
//
// gridCfg  = (cell, band, distort, blocksX)
// gridDims = (dimsX, dimsY, dimsZ, blocksY)      fine cells / blocks
// origin   = the hull mesh's world position; vertices are written RELATIVE
//            to it so positionWorld in the march material comes out right.

/** The band-shifted tracer field: mapBody at noiseAmp 0 (the march loop's
 *  own field — march.wgsl.ts ~1801 passes 0.0 too), minus band. */
/** The band-shifted tracer field: mapBody at noiseAmp 0 (the march loop's
 *  own field — march.wgsl.ts ~1801 passes 0.0 too), minus band. The trailing
 *  vec4 is the wound union-reach bound (close-up wound-cull task): the hull
 *  kernel binds no uniform for it, so (0,0,0,1e9) — the no-cull identity —
 *  keeps this pass bit-identical to pre-cull. */
export const HULL_FIELD = /* wgsl */ `fn hullField(p: vec3<f32>, band: f32, data: texture_2d<f32>, counts: vec4<f32>, counts2: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, perfCfg: vec4<f32>) -> f32 {
  return mapBody(p, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, vec4<f32>(0.0, 0.0, 0.0, 1e9)).x - band;
}`;

/**
 * Pass 1. One workgroup [4,4,4] per block; wid.x is the linear block index
 * (three dispatches ceil(count/64) workgroups along x). EVERY thread runs the
 * block-centre live test redundantly (not broadcast through workgroup
 * memory): Tint rejects any barrier reached after a branch on a workgroup
 * storage read — 'may result in a non-uniform value' — so gBlockLive does
 * not exist. The test depends only on wid + uniforms, so the whole workgroup
 * computes the same value and the branch is provably uniform. Dead blocks
 * skip the corner fill, zero their edge bits after the barrier, and leave.
 */
export const K_HULL_NETS = /* wgsl */ `fn kHullNets(
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  counts: vec4<f32>,
  counts2: vec4<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  volumePose0: vec4<f32>,
  volumePose1: vec4<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  perfCfg: vec4<f32>,
  gridMin: vec3<f32>,
  gridCfg: vec4<f32>,
  gridDims: vec4<f32>,
  origin: vec3<f32>,
  cellVert: ptr<storage, array<u32>, read_write>,
  cellEdge: ptr<storage, array<u32>, read_write>,
  cellPos: ptr<storage, array<f32>, read_write>,
  counters: ptr<storage, array<atomic<u32>>, read_write>,
  wid: vec3<u32>,
  lid: vec3<u32>
) -> void {
  let cell = gridCfg.x;
  let band = gridCfg.y;
  let distort = gridCfg.z;
  let blocksX = u32(gridCfg.w);
  let blocksY = u32(gridDims.w);
  let dims = vec3<i32>(i32(gridDims.x), i32(gridDims.y), i32(gridDims.z));
  let blockCount = blocksX * blocksY * u32(dims.z / BLOCK);
  let b = wid.x;
  let lin = lid.x + lid.y * u32(BLOCK) + lid.z * u32(BLOCK) * u32(BLOCK);
  // Past the live grid: the whole workgroup leaves together (b is uniform).
  if (b >= blockCount) { return; }
  let bx = i32(b % blocksX);
  let by = i32((b / blocksX) % blocksY);
  let bz = i32(b / (blocksX * blocksY));
  let blockOrigin = gridMin + vec3<f32>(f32(bx), f32(by), f32(bz)) * (f32(BLOCK) * cell);

  // Block-live test ONCE per block (thread 0), broadcast through workgroup
  // memory with workgroupUniformLoad — the builtin that makes the value
  // provably uniform (it carries its own barrier), so the branch below is
  // uniform control flow and Tint accepts the barrier after the tile fill.
  // The earlier per-thread form was 64 field evals per block, 4M per frame
  // at the worst-case dispatch: MORE than the march spends drawing the body.
  if (lin == 0u) {
    let halfDiag = sqrt(3.0) * f32(BLOCK) * cell * 0.5;
    let blockC = blockOrigin + vec3<f32>(f32(BLOCK) * cell * 0.5);
    let fv = hullField(blockC, band, data, counts, counts2, woundCfg, woundCfg2, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg);
    gBlockLive = select(0u, 1u, abs(fv) <= halfDiag * distort + cell);
  }
  let live = workgroupUniformLoad(&gBlockLive);

  let i = bx * BLOCK + i32(lid.x);
  let j = by * BLOCK + i32(lid.y);
  let k = bz * BLOCK + i32(lid.z);
  let ci = u32((k * dims.y + j) * dims.x + i);
  if (live == 0u) {
    (*cellEdge)[ci] = 0u;
    (*cellVert)[ci] = NO_VERT;
    return;
  }

  // 125 corners, two per thread (64 threads cover 128 slots).
  for (var s = 0u; s < 2u; s = s + 1u) {
    let cidx = lin + s * 64u;
    if (cidx < 125u) {
      let cx = i32(cidx % 5u);
      let cy = i32((cidx / 5u) % 5u);
      let cz = i32(cidx / 25u);
      let p = blockOrigin + vec3<f32>(f32(cx), f32(cy), f32(cz)) * cell;
      gTile[cidx] = hullField(p, band, data, counts, counts2, woundCfg, woundCfg2, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg);
    }
  }
  workgroupBarrier();
  let lx = i32(lid.x); let ly = i32(lid.y); let lz = i32(lid.z);
  var v: array<f32, 8>;
  for (var c = 0; c < 8; c = c + 1) {
    let ox = c & 1; let oy = (c >> 1) & 1; let oz = (c >> 2) & 1;
    v[c] = gTile[(lz + oz) * 25 + (ly + oy) * 5 + (lx + ox)];
  }
  var neg = 0u;
  for (var c = 0; c < 8; c = c + 1) { if (v[c] < 0.0) { neg = neg | (1u << u32(c)); } }
  var bits = 0u;
  let in0 = (neg & 1u) != 0u;
  if (in0 != ((neg & 2u) != 0u)) { bits = bits | EDGE_X_CROSS | select(0u, EDGE_X_IN2OUT, in0); }
  if (in0 != ((neg & 4u) != 0u)) { bits = bits | EDGE_Y_CROSS | select(0u, EDGE_Y_IN2OUT, in0); }
  if (in0 != ((neg & 16u) != 0u)) { bits = bits | EDGE_Z_CROSS | select(0u, EDGE_Z_IN2OUT, in0); }
  (*cellEdge)[ci] = bits;
  if (neg == 0u || neg == 255u) { (*cellVert)[ci] = NO_VERT; return; }

  // The 12 cube edges, derived arithmetically (no const-array runtime
  // indexing — some WGSL compilers reject it): edge e has axis e/4 and
  // lower corner a with that axis bit clear; b = a | axisBit.
  var sum = vec3<f32>(0.0);
  var n = 0.0;
  for (var e = 0; e < 12; e = e + 1) {
    let axis = e / 4;
    let w = e % 4;
    var a = 0;
    var axisBit = 1;
    if (axis == 0) { a = w << 1; axisBit = 1; }
    else if (axis == 1) { a = (w & 1) | ((w >> 1) << 2); axisBit = 2; }
    else { a = w; axisBit = 4; }
    let bb = a | axisBit;
    let va = v[a]; let vb = v[bb];
    if ((va < 0.0) == (vb < 0.0)) { continue; }
    let t = va / (va - vb);
    let pa = vec3<f32>(f32(a & 1), f32((a >> 1) & 1), f32((a >> 2) & 1));
    let pb = vec3<f32>(f32(bb & 1), f32((bb >> 1) & 1), f32((bb >> 2) & 1));
    sum = sum + mix(pa, pb, t);
    n = n + 1.0;
  }
  let id = atomicAdd(&(*counters)[0], 1u);
  if (id >= u32(MAX_CELL_VERTS)) {
    atomicStore(&(*counters)[2], 1u);
    (*cellVert)[ci] = NO_VERT;
    return;
  }
  var p = blockOrigin + vec3<f32>(f32(lx), f32(ly), f32(lz)) * cell + (sum / n) * cell;
  // Sub-iso pull (surface-nets-cpu.ts header deviation note — the WGSL MUST
  // transliterate it): Newton-walk the vertex INWARD along the gradient to
  // field = VERT_PULL_TARGET * band, sphere-tracing steps (the field's own
  // value, so compressed regions under-step, never overshoot) capped at half
  // a cell. Without it the field=band iso sits up to band*distort from the
  // flesh in anisotropic smin fillets and the 2*band fragment walk cannot
  // reach the surface. hullField at band*VERT_PULL_TARGET IS the error term;
  // the constant shift leaves the gradient unchanged.
  // Direction = the cell's corner gradient (free); one field eval per step.
  let gcx = (v[1] - v[0]) + (v[3] - v[2]) + (v[5] - v[4]) + (v[7] - v[6]);
  let gcy = (v[2] - v[0]) + (v[3] - v[1]) + (v[6] - v[4]) + (v[7] - v[5]);
  let gcz = (v[4] - v[0]) + (v[5] - v[1]) + (v[6] - v[2]) + (v[7] - v[3]);
  var gl = sqrt(gcx * gcx + gcy * gcy + gcz * gcz);
  if (gl == 0.0) { gl = 1.0; }
  let dir = vec3<f32>(gcx, gcy, gcz) / gl;
  for (var it = 0; it < VERT_PULL_ITERS; it = it + 1) {
    let err = hullField(p, band * VERT_PULL_TARGET, data, counts, counts2, woundCfg, woundCfg2, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg);
    if (err <= 1e-4) { break; }
    let stepLen = min(err, cell * 0.5);
    p = p - dir * stepLen;
  }
  let pr = p - origin;
  (*cellPos)[id * 3u] = pr.x;
  (*cellPos)[id * 3u + 1u] = pr.y;
  (*cellPos)[id * 3u + 2u] = pr.z;
  (*cellVert)[ci] = id;
}
const BLOCK: i32 = 4;
const NO_VERT: u32 = 4294967295u;
const MAX_CELL_VERTS: i32 = 65536;
const EDGE_X_CROSS: u32 = 1u;
const EDGE_X_IN2OUT: u32 = 2u;
const EDGE_Y_CROSS: u32 = 4u;
const EDGE_Y_IN2OUT: u32 = 8u;
const EDGE_Z_CROSS: u32 = 16u;
const EDGE_Z_IN2OUT: u32 = 32u;
const VERT_PULL_TARGET: f32 = 0.6;
const VERT_PULL_ITERS: i32 = 4;
var<workgroup> gBlockLive: u32;
var<workgroup> gTile: array<f32, 125>;`;

/** Pass-2 helpers, each its own chained source (the wgslFn parser is
 *  ^-anchored on ONE fn per source, so helpers cannot share a string with
 *  the kernel). Order: vertAt, putV, emitQuad, then the kernel. */
export const K_VERT_AT = /* wgsl */ `fn vertAt(i: i32, j: i32, k: i32, dims: vec3<i32>, cellVert: ptr<storage, array<u32>, read_write>) -> u32 {
  if (i < 0 || j < 0 || k < 0 || i >= dims.x || j >= dims.y || k >= dims.z) { return NO_VERT; }
  return (*cellVert)[u32((k * dims.y + j) * dims.x + i)];
}
const NO_VERT: u32 = 4294967295u;`;

/** SOUP STRIDE IS 4 FLOATS, NOT 3. three pads a StorageBufferAttribute of
 *  itemSize 3 to vec4 on upload (WebGPUAttributeUtils.js "WGSL does not
 *  support packed vec3 data in storage buffers, pad to vec4") and mutates
 *  the attribute to itemSize 4, so the VERTEX stage reads a 16-byte stride.
 *  A kernel writing xyzxyz produced garbage triangles spanning the bbox
 *  (2026-09-02: the "blob" that hid the torso). w is left untouched. */
export const K_PUT_V = /* wgsl */ `fn putV(id: u32, at: u32, cellPos: ptr<storage, array<f32>, read_write>, soup: ptr<storage, array<f32>, read_write>) -> void {
  (*soup)[at * SOUP_STRIDE] = (*cellPos)[id * 3u];
  (*soup)[at * SOUP_STRIDE + 1u] = (*cellPos)[id * 3u + 1u];
  (*soup)[at * SOUP_STRIDE + 2u] = (*cellPos)[id * 3u + 2u];
}
const SOUP_STRIDE: u32 = 4u;`;
export const SOUP_STRIDE = 4;

export const K_EMIT_QUAD = /* wgsl */ `fn emitQuad(qIn: vec4<u32>, flip: bool, cellPos: ptr<storage, array<f32>, read_write>, soup: ptr<storage, array<f32>, read_write>, counters: ptr<storage, array<atomic<u32>>, read_write>) -> void {
  if (qIn.x == NO_VERT || qIn.y == NO_VERT || qIn.z == NO_VERT || qIn.w == NO_VERT) {
    atomicAdd(&(*counters)[3], 1u);
    return;
  }
  let q = select(qIn, vec4<u32>(qIn.x, qIn.w, qIn.z, qIn.y), flip);
  let base = atomicAdd(&(*counters)[1], 6u);
  if (base + 6u > MAX_SOUP_VERTS) { atomicStore(&(*counters)[2], 1u); return; }
  putV(q.x, base, cellPos, soup);      putV(q.y, base + 1u, cellPos, soup); putV(q.z, base + 2u, cellPos, soup);
  putV(q.x, base + 3u, cellPos, soup); putV(q.z, base + 4u, cellPos, soup); putV(q.w, base + 5u, cellPos, soup);
}
const MAX_SOUP_VERTS: u32 = 1179648u;`;

/**
 * Pass 2. One thread per cell (linear instanceIndex). Emits up to three
 * quads as six vertices each into the soup, reading neighbours' cell
 * vertices. Dead blocks wrote edge bits 0 in pass 1, so stale cellVert
 * entries are never read. Soup vertices are the cell positions copied —
 * the vertex stage needs nothing but a position.
 */
export const K_HULL_QUADS = /* wgsl */ `fn kHullQuads(
  gridDims: vec4<f32>,
  cellVert: ptr<storage, array<u32>, read_write>,
  cellEdge: ptr<storage, array<u32>, read_write>,
  cellPos: ptr<storage, array<f32>, read_write>,
  soup: ptr<storage, array<f32>, read_write>,
  counters: ptr<storage, array<atomic<u32>>, read_write>,
  gi: u32
) -> void {
  let dims = vec3<i32>(i32(gridDims.x), i32(gridDims.y), i32(gridDims.z));
  let cellCount = u32(dims.x * dims.y * dims.z);
  if (gi >= cellCount) { return; }
  let bits = (*cellEdge)[gi];
  if (bits == 0u) { return; }
  let i = i32(gi % u32(dims.x));
  let j = i32((gi / u32(dims.x)) % u32(dims.y));
  let k = i32(gi / u32(dims.x * dims.y));

  if ((bits & EDGE_X_CROSS) != 0u) {
    let q = vec4<u32>(vertAt(i, j, k, dims, cellVert), vertAt(i, j - 1, k, dims, cellVert), vertAt(i, j - 1, k - 1, dims, cellVert), vertAt(i, j, k - 1, dims, cellVert));
    emitQuad(q, (bits & EDGE_X_IN2OUT) == 0u, cellPos, soup, counters);
  }
  if ((bits & EDGE_Y_CROSS) != 0u) {
    let q = vec4<u32>(vertAt(i, j, k, dims, cellVert), vertAt(i, j, k - 1, dims, cellVert), vertAt(i - 1, j, k - 1, dims, cellVert), vertAt(i - 1, j, k, dims, cellVert));
    emitQuad(q, (bits & EDGE_Y_IN2OUT) == 0u, cellPos, soup, counters);
  }
  if ((bits & EDGE_Z_CROSS) != 0u) {
    let q = vec4<u32>(vertAt(i, j, k, dims, cellVert), vertAt(i - 1, j, k, dims, cellVert), vertAt(i - 1, j - 1, k, dims, cellVert), vertAt(i, j - 1, k, dims, cellVert));
    emitQuad(q, (bits & EDGE_Z_IN2OUT) == 0u, cellPos, soup, counters);
  }
}
const EDGE_X_CROSS: u32 = 1u;
const EDGE_X_IN2OUT: u32 = 2u;
const EDGE_Y_CROSS: u32 = 4u;
const EDGE_Y_IN2OUT: u32 = 8u;
const EDGE_Z_CROSS: u32 = 16u;
const EDGE_Z_IN2OUT: u32 = 32u;`;

/**
 * Pass 3, one thread. drawIndirect args = (vertexCount, instanceCount,
 * firstVertex, firstInstance). Clamped to capacity; overflow flag already
 * set by whichever kernel hit it. Also snapshots the counters into meta for
 * the page's stats readback.
 */
export const K_HULL_ARGS = /* wgsl */ `fn kHullArgs(
  counters: ptr<storage, array<atomic<u32>>, read_write>,
  args: ptr<storage, array<u32>, read_write>,
  metaOut: ptr<storage, array<u32>, read_write>
) -> void {
  let verts = min(atomicLoad(&(*counters)[1]), MAX_SOUP_VERTS);
  (*args)[0] = verts;
  (*args)[1] = 1u;
  (*args)[2] = 0u;
  (*args)[3] = 0u;
  (*metaOut)[0] = atomicLoad(&(*counters)[2]);
  (*metaOut)[1] = atomicLoad(&(*counters)[0]);
  (*metaOut)[2] = verts;
  (*metaOut)[3] = atomicLoad(&(*counters)[3]);
}
const MAX_SOUP_VERTS: u32 = 1179648u;`;

/** Chain for pass 1: the march HELPERS, then the field, then the kernel. */
export const HULL_NETS_CHAIN = [HULL_FIELD, K_HULL_NETS];
/** Chain for pass 2: the three helpers, then the kernel. Order load-bearing. */
export const HULL_QUADS_CHAIN = [K_VERT_AT, K_PUT_V, K_EMIT_QUAD, K_HULL_QUADS];

/** counters layout: 0 cell verts, 1 soup verts, 2 overflow flag, 3 dropped quads. */
export const COUNTER_CELL_VERTS = 0, COUNTER_SOUP_VERTS = 1, COUNTER_OVERFLOW = 2, COUNTER_DROPPED = 3;
export const MAX_CELL_VERTS = 65536;
export const MAX_SOUP_VERTS = MAX_CELL_VERTS * 3 * 6;
