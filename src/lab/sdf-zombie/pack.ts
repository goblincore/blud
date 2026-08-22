// src/lab/sdf-zombie/pack.ts
import type { BuiltBody } from './types';
import { bendCtrl } from './vec';
import { MAX_CLUSTERS, MAX_PRIMS } from './validate';

export const PRIM_STRIDE = 4;    // vec4
export const CLUSTER_STRIDE = 4; // vec4

/** primScale.w encoding: 0 = additive, 1 = carve, 2 = dead (see markPrimDead). */
export const W_ADD = 0;
export const W_CARVE = 1;
export const W_DEAD = 2;
/** Cuts a channel along its surface rather than removing a solid. Handled in
 *  the carve pass beside W_CARVE — see sdGroove in validate.ts. */
export const W_GROOVE = 3;

export interface PackedBody {
  primA: Float32Array;         // xyz = endpoint A, w = radius
  primB: Float32Array;         // xyz = endpoint B, w = blendK
  primScale: Float32Array;     // xyz = ellipsoid scale, w = 1 when this is a carve
  primQuat: Float32Array;      // xyzw = prim orientation; identity when absent
  /** x = radius at endpoint B, NEGATIVE when untapered; y = fold profile
   *  (0 round, 1 chamfer, 2 round+BENT, 3 chamfer+BENT); zw spare (groove
   *  depth/width). Negative is the sentinel rather than "equal to radius"
   *  because 0 is a LEGITIMATE taper target — a true point is the whole
   *  reason the taper exists. */
  primShape: Float32Array;
  /** xyz = the quadratic Bezier control point in WORLD space — midpoint of
   *  the endpoints plus the authored bend displacement. Zeros when unbent;
   *  only prims with primShape.y >= 2 are ever read from this row. */
  primBend: Float32Array;
  /** xyz = linear albedo, w = 1 + gloss. w = 0 is the sentinel for "flesh":
   *  a painted prim always has w >= 1, so the shader needs one compare and
   *  an unpainted body packs as all zeros — bit-identical data rows for
   *  every character authored before colour existed. */
  primColor: Float32Array;
  restA: Float32Array;         // xyz = REST endpoint A, w = radius (0 = unwritten)
  restB: Float32Array;         // xyz = REST endpoint B, w = blendK
  clusterBounds: Float32Array; // xyz = centre, w = radius
  clusterRange: Float32Array;  // x = start, y = count, z = alive, w = 1 when the cluster carries oriented prims
  primCount: number;
  clusterCount: number;
  /** Cull margin: a cluster can still pull the surface from up to this far away. */
  maxBlendK: number;
  /** How many packed primitives are carves. Zero lets the shader skip the pass. */
  carveCount: number;
}

/**
 * Packs one body for the data texture.
 *
 * `rest` (motion-polish task 6) is the SAME body in its authored rest pose —
 * buildBody's un-rigged output, where applyRig produces the posed one. The
 * shader maps every noise sample into the DOMINANT prim's rest frame so the
 * flesh texture rides every limb (the texture-swimming fix), which needs the
 * rest endpoints alongside the posed ones. Prim indices correspond 1:1
 * (applyRig maps prims without reordering — the fold order is sacred).
 * Omitted, the posed prims double as the rest pose: the right answer for
 * never-rigged bodies (crowd statues, chunk views at spawn).
 */
export function packBody(body: BuiltBody, rest?: BuiltBody): PackedBody {
  const primA = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primB = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primScale = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primQuat = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primShape = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primBend = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primColor = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const restA = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const restB = new Float32Array(MAX_PRIMS * PRIM_STRIDE);

  let maxBlendK = 0;
  let carveCount = 0;
  body.prims.forEach((p, i) => {
    const o = i * PRIM_STRIDE;
    // The prim role rides primScale.w, which held a cluster id the shader
    // never actually read.
    //
    // It used to ride the SIGN of blendK, which was free but silently broken:
    // -0 is indistinguishable from 0 once stored in a Float32Array, so a carve
    // authored with blendK 0 folded in as ADDITIVE. That matters because
    // blendK 0 is the useful case — smin short-circuits to a hard min, giving
    // crisp-edged features instead of the smear that made carved eye sockets
    // fail. Never encode a flag in a sign whose zero is meaningful.
    //
    // w=2 (dead) outranks w=1 (carve): a mid-limb sever only ever kills add
    // prims, but if a carve ever went dead it must stop carving too.
    const isCarve = p.op === 'sub';
    if (isCarve && !p.dead) carveCount++;
    const w = p.dead ? W_DEAD : p.op === 'groove' ? W_GROOVE : isCarve ? W_CARVE : W_ADD;
    primA.set([p.a[0], p.a[1], p.a[2], p.radius], o);
    primB.set([p.b[0], p.b[1], p.b[2], p.blendK], o);
    primScale.set([p.scale[0], p.scale[1], p.scale[2], w], o);
    // Identity default: sdPrim branches on |1 - w| so an unoriented prim
    // costs one compare. Only rig-posed skull prims ever carry a real quat.
    const q = p.orient;
    primQuat.set(q ? [q[0], q[1], q[2], q[3]] : [0, 0, 0, 1], o);
    // -1 for an untapered prim, which is the plain-capsule branch in coneCap.
    // A radiusB EQUAL to radius is still written as a taper: it is a
    // no-op geometrically, and rewriting it to -1 to save a branch would make
    // the packed data depend on a float comparison the author did not make.
    // zw carry the groove's depth and width, which is why the groove needed no
    // new row — they were spare here from the moment the taper claimed xy.
    // y encodes profile AND bend: +2 means the Bezier path. placePrims has
    // already dropped collinear/zero bends, so anything that arrives here
    // bent is genuinely curved. The bent values sit ABOVE chamfer so every
    // existing "> 0.5 means chamfer" consumer keeps working.
    const bent = p.bend !== undefined ? 2 : 0;
    primBend.set(p.bend === undefined ? [0, 0, 0, 0] : [...bendCtrl(p.a, p.b, p.bend), 0], o);
    primColor.set(p.color === undefined
      ? [0, 0, 0, 0]
      : [p.color[0], p.color[1], p.color[2], 1 + (p.gloss ?? 0)], o);
    primShape.set([
      p.radiusB === undefined ? -1 : p.radiusB,
      (p.blendProfile === 'chamfer' ? 1 : 0) + bent,
      p.grooveDepth ?? 0, p.grooveWidth ?? 0,
    ], o);
    // Rest endpoints (motion-polish task 6). A missing rest prim packs as
    // ZEROS — restA.w = 0 is the shader's 'unwritten' sentinel (a real prim
    // always has radius > 0), which falls back to the old noiseLocal anchor.
    const rp = (rest ?? body).prims[i];
    if (rp) {
      restA.set([rp.a[0], rp.a[1], rp.a[2], rp.radius], o);
      restB.set([rp.b[0], rp.b[1], rp.b[2], rp.blendK], o);
    }
    // Cull margin is a distance: always the magnitude, never the sign.
    if (p.blendK > maxBlendK) maxBlendK = p.blendK;
  });

  const clusterBounds = new Float32Array(MAX_CLUSTERS * CLUSTER_STRIDE);
  const clusterRange = new Float32Array(MAX_CLUSTERS * CLUSTER_STRIDE);
  body.clusters.forEach((c, i) => {
    const o = i * CLUSTER_STRIDE;
    clusterBounds.set([c.center[0], c.center[1], c.center[2], c.radius], o);
    // w: oriented-cluster flag. The shader hoists the per-prim quat branch to
    // cluster granularity with it (a second textureLoad per sdPrim call cost
    // a measured ~10-18% frame time — see the sdPrimO note in march.wgsl.ts),
    // so a cluster whose prims are ALL identity takes the plain world-axis
    // path, which is every cluster except a turned head. Bit-identical either
    // way: sdPrimO with an identity quat runs the identical op sequence.
    //
    // It is a BITFIELD now, not a bool: bit 1 is that oriented flag, bit 2 says
    // some prim here is tapered, chamfered OR BENT. ROW_PRIM_SHAPE and
    // ROW_PRIM_BEND are hoisted the same way and for the same measured reason
    // — a cluster with no shaped prim never reads either row, so a body with
    // one pointed nose does not make its legs pay for it.
    const own = body.prims.slice(c.start, c.start + c.count);
    const oriented = own.some(p => p.orient && Math.abs(1 - p.orient[3]) > 1e-6);
    const shaped = own.some(p =>
      p.radiusB !== undefined || p.blendProfile === 'chamfer' || p.op === 'groove'
      || p.bend !== undefined);
    clusterRange.set(
      [c.start, c.count, c.alive ? 1 : 0, (oriented ? 1 : 0) + (shaped ? 2 : 0)], o);
  });

  return {
    primA, primB, primScale, primQuat, primShape, primBend, primColor, restA, restB, clusterBounds, clusterRange,
    primCount: body.prims.length,
    clusterCount: body.clusters.length,
    maxBlendK,
    carveCount,
  };
}

/**
 * Kills a primitive in an ALREADY-PACKED body without re-packing: sets the
 * primScale.w slot to W_DEAD. The fold order never changes, so this is the
 * cheap path for mid-limb severs (severDistal also re-packs from source via
 * the normal update path; this helper exists for packed-data consumers).
 */
export function markPrimDead(packed: PackedBody, primIdx: number): void {
  packed.primScale[primIdx * PRIM_STRIDE + 3] = W_DEAD;
}

/** True unless the prim is a carve or dead — i.e. it folds into the surface. */
export function primAlive(packed: PackedBody, primIdx: number): boolean {
  return packed.primScale[primIdx * PRIM_STRIDE + 3] === W_ADD;
}
