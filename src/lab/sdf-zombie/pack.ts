// src/lab/sdf-zombie/pack.ts
import type { BuiltBody, Primitive } from './types';
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
/** Bone: a second material inside the flesh. Skipped by the additive fold and
 *  by the carve pass; folded as a hard `min` AFTER applyWounds, so it is only
 *  ever visible where a carve has eaten down to it. See
 *  docs/superpowers/specs/2026-09-01-wound-pass-r2-design.md §1. */
export const W_BONE = 4;

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
  /** x = half-thickness, y = rim radius, z = clip offset, w = hasClip (0/1).
   *  Only read by prims folded as a shell (profile bit 2). */
  primShell: Float32Array;
  /** xyz = the clip plane's unit normal (w spare). See primShell. */
  primClip: Float32Array;
  restA: Float32Array;         // xyz = REST endpoint A, w = radius (0 = unwritten)
  restB: Float32Array;         // xyz = REST endpoint B, w = blendK
  clusterBounds: Float32Array; // xyz = centre, w = radius
  clusterRange: Float32Array;  // x = start, y = count, z = alive, w = 1 when the cluster carries oriented prims
  /**
   * BOUND GROUPS: the fold's cull unit. A cluster is a limb, and a limb's one
   * sphere is fat — the schoolgirl's leg sphere (0.57 m, centred at the
   * thigh) swallows the skirt and the other leg, so a pixel near the hip
   * folded 42 of her 56 prims per march step (zombie: 18 of 23). Groups are
   * contiguous runs of a cluster's prims in FOLD ORDER, each with its own
   * sphere no larger than GROUP_RADIUS_MAX, so the shader skips a far run
   * with one texel read. Fold order is untouched: a skipped run is exactly
   * the far-smin no-op the cluster cull already relies on (same margin).
   * groupBounds: xyz centre, w radius. groupRange: x start, y count (0 =
   * end of list, the shader's loop sentinel), z the group's DISTORTION
   * FACTOR (below), w the same flag bitfield as clusterRange.w but computed
   * over the group's OWN prims, so one chamfered nose no longer makes the
   * whole head read the shape row. (No per-group alive flag: the shader only
   * reaches a group through its cluster, whose alive flag it has checked.)
   *
   * DISTORTION: sdPrimitive is a scaled-space field — sd = scaledDist *
   * minScale — so for an anisotropic prim the reported distance under-reports
   * Euclidean distance by up to maxScale/minScale (the schoolgirl's sole
   * plate: 22x). A cull that compares a Euclidean sphere distance straight
   * against the field's running d skips groups still inside smin support and
   * tears the surface — found as white shells and holes around wounds, where
   * the lip reads d as a precise field. The shader multiplies the threshold
   * by this factor: skip only when sphereDist > (d + margin) * distort.
   */
  groupBounds: Float32Array;
  groupRange: Float32Array;
  /** Per cluster: x = index of its first group, y = its group count, z =
   *  the cluster's own distortion factor (see groupRange.z). The shader only
   *  walks a cluster's own span, so far limbs stay a few texels. */
  clusterGroups: Float32Array;
  groupCount: number;
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
export interface PackOpts {
  /**
   * One bound group per CLUSTER, mirroring it exactly, instead of the
   * finer per-run split. For bodies whose prims are re-transformed in place
   * every frame without re-packing (gib chunks: rotate + squash + translate
   * in zombie-gpu's apply()), where a baked group sphere would go stale
   * while the cluster sphere is rewritten from the chunk's own position.
   */
  singleGroup?: boolean;
}

export function packBody(body: BuiltBody, rest?: BuiltBody, opts: PackOpts = {}): PackedBody {
  const primA = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primB = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primScale = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primQuat = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primShape = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primBend = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primColor = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primShell = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primClip = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
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
    const w = p.dead ? W_DEAD
      : p.op === 'groove' ? W_GROOVE
      : p.op === 'bone' ? W_BONE
      : isCarve ? W_CARVE : W_ADD;
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
    // y = fold profile. 0 round, 1 chamfer, 2 round+bent, 3 chamfer+bent;
    // a SHELL adds bit 2 (value 4) so straight=4, bent=6. The shader folds any
    // prof >= 4 as a shell and reads the shell rows; the low bits still mean
    // chamfer/bend for the non-shell range and are ignored on a shell.
    const prof = (p.blendProfile === 'chamfer' ? 1 : 0) + bent + (p.shell ? 4 : 0);
    primBend.set(p.bend === undefined ? [0, 0, 0, 0] : [...bendCtrl(p.a, p.b, p.bend), 0], o);
    primColor.set(p.color === undefined
      ? [0, 0, 0, 0]
      : [p.color[0], p.color[1], p.color[2], 1 + (p.gloss ?? 0)], o);
    // Shell fold (2026-08-25): the row-array pair for a shell-clipped sheet.
    // Sets ROW_PRIM_SHELL (thickness, rim, clip offset, hasClip) and
    // ROW_PRIM_CLIP (clip normal). Rows are zero for every non-shell prim, and
    // the shader only reads them when the prim's profile marks it a shell, so
    // an additive prim pays nothing for the extra rows.
    const sh = p.shell;
    primShell.set(sh
      ? [sh.thickness, sh.rim, sh.clipOffset, 1]
      : [0, 0, 0, 0], o);
    primClip.set(sh
      ? [sh.clipNormal[0], sh.clipNormal[1], sh.clipNormal[2], 0]
      : [0, 0, 0, 0], o);
    primShape.set([
      p.radiusB === undefined ? -1 : p.radiusB,
      prof,
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
      || p.bend !== undefined || p.shell !== undefined);
    clusterRange.set(
      [c.start, c.count, c.alive ? 1 : 0, (oriented ? 1 : 0) + (shaped ? 2 : 0)], o);
  });

  const groupBounds = new Float32Array(MAX_PRIMS * CLUSTER_STRIDE);
  const groupRange = new Float32Array(MAX_PRIMS * CLUSTER_STRIDE);
  const clusterGroups = new Float32Array(MAX_CLUSTERS * CLUSTER_STRIDE);
  let groupCount = 0;
  body.clusters.forEach((c, ci) => {
    const first = groupCount;
    const own = body.prims.slice(c.start, c.start + c.count);
    const cDistort = distortOf(own);
    const groups = opts.singleGroup
      ? [{ start: c.start, count: c.count, center: c.center, radius: c.radius, distort: cDistort }]
      : boundGroups(body.prims, c.start, c.count);
    for (const g of groups) {
      const o = groupCount * CLUSTER_STRIDE;
      groupBounds.set([g.center[0], g.center[1], g.center[2], g.radius], o);
      const gOwn = body.prims.slice(g.start, g.start + g.count);
      const oriented = gOwn.some(p => p.orient && Math.abs(1 - p.orient[3]) > 1e-6);
      const shaped = gOwn.some(p =>
        p.radiusB !== undefined || p.blendProfile === 'chamfer' || p.op === 'groove'
        || p.bend !== undefined);
      groupRange.set([g.start, g.count, g.distort, (oriented ? 1 : 0) + (shaped ? 2 : 0)], o);
      groupCount++;
    }
    clusterGroups.set([first, groupCount - first, cDistort, 0], ci * CLUSTER_STRIDE);
  });

  return {
    primA, primB, primScale, primQuat, primShape, primBend, primColor, primShell, primClip, restA, restB, clusterBounds, clusterRange,
    groupBounds, groupRange, clusterGroups, groupCount,
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

/**
 * Largest bounding-sphere radius a bound group may grow to before the next
 * prim in fold order starts a new group. Body-scale metres. 0.16 is about a
 * thigh's length: small enough that a hip pixel no longer folds the shin and
 * foot, large enough that a limb is two or three groups, not nine.
 */
export const GROUP_RADIUS_MAX = 0.16;

export interface BoundGroup { start: number; count: number; center: [number, number, number]; radius: number; distort: number }

/** Worst-case field-vs-Euclid distance ratio over a run of prims. */
function distortOf(prims: Primitive[]): number {
  let f = 1;
  for (const p of prims) {
    if (p.op === 'sub' || p.op === 'groove') continue;
    const mx = Math.max(p.scale[0], p.scale[1], p.scale[2]);
    const mn = Math.min(p.scale[0], p.scale[1], p.scale[2]);
    f = Math.max(f, mx / Math.max(mn, 1e-4));
  }
  return f;
}

/** Bounding sphere of a run of prims — the same fit assignClusters uses. */
function fitSphere(prims: Primitive[]): { center: [number, number, number]; radius: number } {
  const solid = prims.filter(p => p.op !== 'sub');
  const fitTo = solid.length > 0 ? solid : prims;
  const sum: [number, number, number] = [0, 0, 0];
  let pts = 0;
  const pointsOf = (p: Primitive) =>
    p.bend === undefined ? [p.a, p.b] : [p.a, p.b, bendCtrl(p.a, p.b, p.bend)];
  for (const p of fitTo) for (const q of pointsOf(p)) { sum[0] += q[0]; sum[1] += q[1]; sum[2] += q[2]; pts++; }
  const center: [number, number, number] = [sum[0] / pts, sum[1] / pts, sum[2] / pts];
  let radius = 0;
  for (const p of fitTo) {
    const reach = Math.max(p.radius, p.radiusB ?? p.radius) * Math.max(p.scale[0], p.scale[1], p.scale[2])
      + (p.shell ? p.shell.thickness : 0);
    if (p.orient && Math.abs(1 - p.orient[3]) > 1e-6) {
      // An oriented prim rotates about its MIDPOINT, so its endpoints move:
      // bound by the rotation-invariant ball around the midpoint instead of
      // the endpoints as authored (goblin: a 0.04 mm escape in the sweep).
      const mid: [number, number, number] = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      const half = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2;
      const d = Math.hypot(mid[0] - center[0], mid[1] - center[1], mid[2] - center[2]);
      radius = Math.max(radius, d + half + reach);
      continue;
    }
    for (const q of pointsOf(p)) {
      const d = Math.hypot(q[0] - center[0], q[1] - center[1], q[2] - center[2]);
      radius = Math.max(radius, d + reach);
    }
  }
  return { center, radius };
}

/**
 * Splits one cluster's prims [start, start+count) into contiguous bound
 * groups. Greedy in fold order: a prim joins the open group unless the
 * group's sphere would then exceed GROUP_RADIUS_MAX (a group always takes at
 * least one prim, so a single huge prim is its own group). Deterministic and
 * cheap — the hero re-packs every frame.
 */
export function boundGroups(prims: Primitive[], start: number, count: number): BoundGroup[] {
  const out: BoundGroup[] = [];
  let gStart = start;
  let fit: { center: [number, number, number]; radius: number } | null = null;
  for (let i = start; i < start + count; i++) {
    const run = prims.slice(gStart, i + 1);
    const next = fitSphere(run);
    if (fit !== null && next.radius > GROUP_RADIUS_MAX) {
      out.push({ start: gStart, count: i - gStart, ...fit, distort: distortOf(prims.slice(gStart, i)) });
      gStart = i;
      fit = fitSphere(prims.slice(gStart, i + 1));
    } else {
      fit = next;
    }
  }
  if (fit !== null)
    out.push({ start: gStart, count: start + count - gStart, ...fit, distort: distortOf(prims.slice(gStart, start + count)) });
  return out;
}
