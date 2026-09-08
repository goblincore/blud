// src/lab/sdf-zombie/webgpu/skeleton-spike/contract.ts
//
// SKELETON REPRESENTATION COMPARISON — shared field contract (Task 1).
// Spec: docs/superpowers/specs/2026-09-07-skeleton-representation-comparison-design.md
// Findings: docs/dev-notes/2026-09-07-skeleton-comparison/task-1.md
//
// One BoneFieldSource per RIGID SEGMENT — the same units applyRig poses bones
// by and tags with Primitive.boneSegment (rig-bind.ts): the skull unit, one
// axial BoneFrame per spine/pelvis segment, one limb bone per bind-point
// pair. ORGANS ARE EXCLUDED: the 'organs' segment and any op 'organ' prim
// stay procedural (they shade differently — the isOrgan branch — and ride no
// rigid frame).
//
// distance() consumes SEGMENT-LOCAL metres and folds the segment's bone
// prims exactly the way the march does: a HARD MIN over sdPrimitive
// (foldBoneRange in march.wgsl.ts — never smin; "meat meeting bone should
// crease"), preserving every authored operation a bone can carry: taper
// (radiusB), ellipsoid scale, quadratic Bezier bend, box. At bind the local
// frame is the rest world frame shifted to the segment anchor, so a rest
// pose is the exact identity.
//
// WHAT A RIGID FRAME CANNOT REPRODUCE (measured in contract.test.ts, the
// procedural fallback rule for tasks 2/3):
//  1. BEND VECTORS DO NOT ROTATE. Primitive.bend is a world-axis displacement
//     off the endpoint midpoint and applyRig never rotates it — a rigid bake
//     rotates it with the segment. Zero at rest; grows with pose angle. The
//     zombie's ribs are bent (bend up to 0.162), so this is the rib case.
//  2. LIMB SEGMENTS ARE TWO ANCHORS, NOT ONE FRAME. Per-endpoint binds pose
//     a = jointPosA + offA, b = jointPosB + offB (offsets rotated only for
//     arm bones via armFrame). One rigid frame reproduces its carrier endpoint A exactly
//     and endpoint B up to joint-spacing/offset slack. Other members share
//     that frame; poseEndpointError measures every member.
//  3. LIMB SQUASH STAYS WORLD-AXIS. applyRig sets prim.orient ONLY on the
//     head and axial paths, so a limb bone's ellipsoid scale never turns
//     with the limb in the shipped field. A rigid local bake rotates the
//     squash — geometrically nicer, but a DIFFERENCE from the oracle.
//
// POSING: sources are created against a REST bind (bindRig output, unmoved
// rig). pose() then reads the CURRENT rig points, so one source set rides
// the whole animation without rebuilding; create again after any change to
// body.bonePrims (anatomy, ratio, sever re-derive — see revision).

import type { BuildResult } from '../../build-body';
import type { BoundRig } from '../../rig-bind';
import { headQuatOf, HEAD_RIGID_TUNING } from '../../rig-bind';
import type { RigState } from '../../rig';
import { segmentQuat } from '../../rig-frames';
import { sdPrimitive } from '../../validate';
import { boxReach, shellReach, strandReach } from '../../extent';
import type { Primitive, Vec3 } from '../../types';
import type { Quat } from '../../vec';
import { add, bendCtrl, len, normalize, qRotate, scale as vscale, sub } from '../../vec';

/** The experiment selector. 'procedural' is the shipped field path and stays
 *  the default everywhere; 'mesh'/'volume' are opt-in task 2/3 prototypes. */
export type SkeletonMode = 'procedural' | 'mesh' | 'volume';

export type Point3 = readonly [number, number, number];

/** A rigid local→world frame: world = origin + qRotate(quat, local). */
export interface SegmentPose {
  origin: Point3;
  quat: readonly [number, number, number, number];
}

export interface BoneFieldSource {
  character: string;
  /**
   * The applyRig segment key: 'head', `axial:<headJoint>-<tailJoint>`, or
   * `limb:<limb>:<bindA>-<bindB>`. Never 'organs' (excluded by contract).
   */
  segment: string;
  /**
   * Invalidation token: changes when the segment's rest geometry or prim
   * set changes. Cache keys for mesh/volume bakes MUST include it — a baked
   * asset from a stale revision is the wrong skeleton, silently.
   */
  revision: string;
  /** Segment-local AABB enclosing every member prim's surface. */
  bounds: { min: Point3; max: Point3 };
  /** Bone-only field in segment-local metres. Hard min over member prims. */
  distance(p: Point3): number;

  // ——— Documented extensions (needed by the round-trip/pose contract) ———
  /**
   * 'rigid': the segment is posed by ONE rotation+translation in applyRig
   *   (head unit, axial BoneFrame) — a rigid bake reproduces its endpoint
   *   motion exactly (bend-vector caveat above).
   * 'limb': endpoints follow independent joint anchors — see caveat 2. A
   *   rigid bake is an approximation; poseEndpointError() measures it.
   */
  rigidity: 'rigid' | 'limb';
  /** Member bone prim count (organs never counted). */
  primCount: number;
  /** The segment's CURRENT local→world frame, read off the live rig. */
  pose(): SegmentPose;
  /** world → segment-local, the exact inverse of pose(). */
  toLocal(p: Point3): Vec3;
  /** segment-local → world. */
  toWorld(p: Point3): Vec3;
  /**
   * Worst |frame-mapped endpoint − applyRig-posed endpoint| over member
   * prims for the CURRENT pose, metres. 0 at rest; the honest rigidity
   * error under pose (bend caveat excluded — it is geometric, not
   * endpoint). Callers compare this against their extraction cell size.
   */
  poseEndpointError(): number;
  /** False once the owning flesh cluster is severed (pack.ts drops those
   *  bone rows; a mesh/volume must drop the segment the same frame). */
  isLive(): boolean;
}

const qConj = (q: SegmentPose['quat']): Quat => [-q[0], -q[1], -q[2], q[3]];

interface SegDef {
  key: string;
  rigidity: 'rigid' | 'limb';
  /** Indices into body.bonePrims. */
  members: number[];
  /** Rest-local endpoints per member, in creation order. */
  local: { a: Vec3; b: Vec3 }[];
  /** Live pose frame from the current rig points. */
  poseOf(): SegmentPose;
}

/**
 * Builds the segment source set for a rigged body. `bound` MUST be
 * bindRig(body) against the same body, with the rig at REST at creation —
 * the local frames are captured from the bind offsets, so a pre-posed rig
 * bakes the pose into the geometry.
 */
export interface SkeletonSourceOpts {
  character?: string;
  /** Applied body yaw — a constant, or a live accessor for a walking body. */
  bodyYaw?: number | (() => number);
  /**
   * Live rig accessor. DEFAULTS TO A SNAPSHOT OF bound.rig — wrong the
   * moment anything steps the rig, because stepRig returns a NEW RigState
   * and callers replace bound.rig with it. The game and every posed test
   * must pass `rig: () => currentRig` or pose() reads the rest pose
   * forever (contract.test.ts caught exactly this: a stale rig reads as a
   * ~1 cm phantom distance error under a moved pose).
   */
  rig?: () => RigState;
}

export function createSkeletonSources(
  body: BuildResult,
  bound: BoundRig,
  opts: SkeletonSourceOpts = {},
): BoneFieldSource[] {
  const character = opts.character ?? 'unknown';
  const rigNow = () => opts.rig?.() ?? bound.rig;
  const yawNow = () => typeof opts.bodyYaw === 'function' ? opts.bodyYaw() : opts.bodyYaw ?? 0;
  const pts = () => rigNow().points;

  // Segment keys, mirroring applyRig's segOf ladder exactly (organ → organs
  // → head-rigid → axial BoneFrame → limb bind-point pair). Recomputed here
  // because applyRig exposes only the dense int, not the key.
  const defs = new Map<string, SegDef>();
  const defOf = (key: string, make: () => SegDef): SegDef => {
    let d = defs.get(key);
    if (!d) { d = make(); defs.set(key, d); }
    return d;
  };

  body.bonePrims.forEach((p, i) => {
    // Organs are out of contract: procedural forever, never baked.
    if (p.op === 'organ') return;
    const headLocal = bound.head?.bones.get(i);
    const frame = bound.boneFrames.get(i);
    if (headLocal && bound.head) {
      const h = bound.head;
      defOf('head', () => ({
        key: 'head', rigidity: 'rigid', members: [], local: [],
        poseOf: () => {
          const pivot = pts()[h.pivot]!.pos;
          const tip = pts()[h.tip]!.pos;
          // headQuatOf is the SAME clamped composition applyRig poses with —
          // called with the CURRENT rig, not the bind-time one.
          const q = headQuatOf({ ...bound, rig: rigNow() }, yawNow()) ?? ([0, 0, 0, 1] as Quat);
          // The rigid head's bounded-drift origin — headTransform's rule.
          const drift = sub(tip, add(pivot, qRotate(q, h.restTip)));
          const d = len(drift);
          const origin = d > HEAD_RIGID_TUNING.driftMax
            ? add(pivot, vscale(drift, HEAD_RIGID_TUNING.driftMax / d)) : pivot;
          return { origin, quat: q };
        },
      })).members.push(i);
      defs.get('head')!.local.push({ a: headLocal.a, b: headLocal.b });
      return;
    }
    if (frame) {
      const key = `axial:${frame.head}-${frame.tail}`;
      const f = frame;
      defOf(key, () => ({
        key, rigidity: 'rigid', members: [], local: [],
        poseOf: () => {
          const origin = pts()[f.head]!.pos;
          const dir = normalize(sub(pts()[f.tail]!.pos, origin));
          return { origin, quat: segmentQuat(f.restDir, dir, yawNow()) };
        },
      })).members.push(i);
      defs.get(key)!.local.push({ a: f.restA, b: f.restB });
      return;
    }
    // Limb: one segment per bind-point pair, anchored at endpoint A's joint.
    const bind = bound.boneBinding[i]!;
    const key = `limb:${p.limb}:${bind.a.point}-${bind.b.point}`;
    // Local B is expressed in the A-anchor frame from the immutable rest-body
    // endpoint and bind offset. Do not read the rig's mutable motion target.
    // Recover the bind-time A anchor from the stable body endpoint and its
    // stable bind offset. `rig.restPose` is a live motion target: soldier
    // weapon IK rewrites it before the renderer's first lazy source build.
    // Reading it here baked that raised pose into otherwise-rest geometry,
    // then pose() applied the live arm rotation a second time (the long pink
    // arm/boot protrusions). The body endpoint is the cache identity and is
    // immutable for this source revision, so derive both locals from it.
    const restJointA = sub(p.a, bind.a.offset);
    const localB = sub(p.b, restJointA);
    defOf(key, () => ({
      key, rigidity: 'limb', members: [], local: [],
      poseOf: () => {
        const origin = pts()[bind.a.point]!.pos;
        // Arm endpoints rotate with their bone's frame (armFrame); every
        // other limb bone's offsets are unrotated in applyRig — identity.
        if (bind.armFrame) {
          const dir = normalize(sub(pts()[bind.armFrame.tail]!.pos, pts()[bind.armFrame.head]!.pos));
          return { origin, quat: segmentQuat(bind.armFrame.restDir, dir, yawNow()) };
        }
        // A two-anchor leg must follow BOTH live endpoints. Keeping identity
        // here translated the whole baked shin by the knee while leaving its
        // ankle at the bind direction, exposing long rods in a squat.
        // Rotate the actual primitive axis (including world-axis offsets),
        // then compensate the origin so endpoint A still matches poseEnds.
        const restAxis = sub(p.b, p.a);
        if (len(restAxis) > 1e-9 && bind.a.point !== bind.b.point) {
          const a = add(origin, bind.a.offset);
          const b = add(pts()[bind.b.point]!.pos, bind.b.offset);
          const quat = segmentQuat(normalize(restAxis), normalize(sub(b, a)), 0);
          return { origin: sub(a, qRotate(quat, bind.a.offset)), quat };
        }
        return { origin, quat: [0, 0, 0, 1] };
      },
    })).members.push(i);
    defs.get(key)!.local.push({ a: bind.a.offset, b: localB });
  });

  const sources: BoneFieldSource[] = [];
  for (const def of defs.values()) {
    // Rest-local member prims: bind-relative endpoints, orient stripped
    // (identity at bind by construction), every other authored op intact.
    const prims: Primitive[] = def.members.map((bi, k) => ({
      ...body.bonePrims[bi]!,
      a: def.local[k]!.a,
      b: def.local[k]!.b,
      orient: undefined,
    }));

    // Surface AABB: endpoints AND Bezier control points, fattened by the
    // same reach the cluster refit uses (scale reaches corners, a box
    // reaches past its radius).
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const pr of prims) {
      const reach = Math.max(pr.radius, pr.radiusB ?? pr.radius)
        * Math.max(pr.scale[0], pr.scale[1], pr.scale[2])
        * boxReach(pr.box) * strandReach(pr.strand) + shellReach(pr);
      const pts3 = pr.bend === undefined ? [pr.a, pr.b] : [pr.a, pr.b, bendCtrl(pr.a, pr.b, pr.bend)];
      for (const q of pts3) for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, q[k]! - reach);
        hi[k] = Math.max(hi[k]!, q[k]! + reach);
      }
    }

    // Revision: stable over floats that actually reach the field. Deliberately
    // a content hash, not a counter — a stale-cache hit is the failure mode.
    let h = 2166136261 >>> 0;
    const mix = (n: number) => { h ^= n >>> 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(def.members.length);
    for (const pr of prims) {
      for (const v of [...pr.a, ...pr.b, pr.radius, pr.radiusB ?? -1, ...pr.scale,
        ...(pr.bend ?? [0, 0, 0])])
        mix(Math.round(v * 1e6) + 0x8000000);
    }
    const revision = `${character}:${def.key}:${prims.length}:${(h >>> 0).toString(16)}`;

    const src: BoneFieldSource = {
      character,
      segment: def.key,
      revision,
      bounds: { min: lo, max: hi },
      rigidity: def.rigidity,
      primCount: prims.length,
      distance(p) {
        // foldBoneRange's fold: hard min, no smin, organs absent by
        // construction. Bone blendK is intentionally unread — the march
        // never reads it on this path either.
        let d = Infinity;
        for (const pr of prims) {
          const sd = sdPrimitive([p[0], p[1], p[2]], pr);
          if (sd < d) d = sd;
        }
        return d;
      },
      pose: () => def.poseOf(),
      toLocal(p) {
        const { origin, quat } = def.poseOf();
        return qRotate(qConj(quat), sub([p[0], p[1], p[2]], origin as Vec3));
      },
      toWorld(p) {
        const { origin, quat } = def.poseOf();
        return add(origin as Vec3, qRotate(quat as Quat, [p[0], p[1], p[2]]));
      },
      poseEndpointError() {
        // Reference: the endpoints applyRig would write right now. We cannot
        // call applyRig here (it re-derives everything), so reproduce the
        // three pose paths per member — same code as poseOf, per prim.
        let worst = 0;
        const { origin, quat } = def.poseOf();
        def.members.forEach((bi, k) => {
          const p = body.bonePrims[bi]!;
          const bind = bound.boneBinding[bi]!;
          const headLocal = bound.head?.bones.get(bi);
          const frame = bound.boneFrames.get(bi);
          let pa: Vec3, pb: Vec3;
          if (headLocal && bound.head) {
            pa = add(origin, qRotate(quat as Quat, headLocal.a));
            pb = add(origin, qRotate(quat as Quat, headLocal.b));
          } else if (frame) {
            pa = add(origin, qRotate(quat as Quat, frame.restA));
            pb = add(origin, qRotate(quat as Quat, frame.restB));
          } else {
            // poseEnds verbatim: per-endpoint anchor + (armFrame-rotated) offset.
            const rot = (v: Vec3) => bind.armFrame ? qRotate(quat as Quat, v) : v;
            pa = add(pts()[bind.a.point]!.pos, rot(bind.a.offset));
            pb = add(pts()[bind.b.point]!.pos, rot(bind.b.offset));
          }
          const fa = add(origin, qRotate(quat as Quat, def.local[k]!.a));
          const fb = add(origin, qRotate(quat as Quat, def.local[k]!.b));
          worst = Math.max(worst, len(sub(fa, pa)), len(sub(fb, pb)));
          void p;
        });
        return worst;
      },
      isLive: () => def.members.every(bi => body.clusters[body.bonePrims[bi]!.cluster]?.alive),
    };
    sources.push(src);
  }
  // Deterministic order: head, axial by key, limb by key — independent of
  // bonePrims ordering, so two runs diff cleanly.
  sources.sort((a, b) => a.segment < b.segment ? -1 : a.segment > b.segment ? 1 : 0);
  return sources;
}

/**
 * The composed bone field the sources represent, in WORLD space: the hard
 * min over every live segment's local field at the mapped point. This is the
 * reference composition the march's applyBones implements (minus the
 * nearWound gate, which is an exactness no-op, not a shape rule) — tasks 2/3
 * compare against it, and the sever rule lives here via isLive().
 */
export function composedBoneDistance(sources: readonly BoneFieldSource[], world: Point3): number {
  let d = Infinity;
  for (const s of sources) {
    if (!s.isLive()) continue;
    const sd = s.distance(s.toLocal(world));
    if (sd < d) d = sd;
  }
  return d;
}
