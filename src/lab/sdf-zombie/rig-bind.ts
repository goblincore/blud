// src/lab/sdf-zombie/rig-bind.ts
import type { BuildResult } from './build-body';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { makeRig, type RigPoint, type RigState } from './rig';
import { IK_TUNING, clampDir } from './ik';
import { rotateYaw } from './gait';
import {
  add, len, normalize, qFromTo, qRotate, scale as vscale, sub,
} from './vec';

/** Which rig point an endpoint follows, and its fixed offset from that point. */
interface EndpointBind { point: number; offset: Vec3 }
interface PrimBind { a: EndpointBind; b: EndpointBind }

/**
 * The head as ONE RIGID UNIT (motion-polish fix, X1.22 playtest).
 *
 * bindRig's nearest-joint rule maps the face prims (cranium/jaw/brow/nose)
 * to whichever of the neck/head points each endpoint happens to sit nearest —
 * so when the head rig point orbits the neck (the verlet skull constraint
 * holds only the LENGTH, never the direction), prims bound to different
 * points shear apart: the brow stretches up to 16 cm out of the cranium, the
 * owner's "horn". The rigid pass instead derives a single transform from the
 * two skull rig points every applyRig and applies it to every skull-owned
 * prim: rotation about the neck pivot, clamped to the same IK_TUNING cone the
 * look-at uses, plus a bounded translation.
 */
export interface HeadRigid {
  /** Rig point index of the neck pivot (skull bone head). */
  pivot: number;
  /** Rig point index of the skull tip (skull bone tail). */
  tip: number;
  /** Bind-time unit direction pivot→tip — the rest gaze direction. */
  restDir: Vec3;
  /** Bind-time pivot-relative tip offset (restDir × skull length). */
  restTip: Vec3;
  /** Skull-owned prims, pivot-relative rest endpoints keyed by prim index. */
  prims: Map<number, { a: Vec3; b: Vec3 }>;
}

export interface BoundRig {
  rig: RigState;
  binding: PrimBind[];
  /** Null when the body has no `skull` bone or no skull-owned spheres. */
  head: HeadRigid | null;
}

/** Head-rigidity knobs — the loose-neck creature is a TUNING, not a code path. */
export const HEAD_RIGID_TUNING = {
  /** How far the rigid head's origin may follow the head point off the neck
   *  pivot (m). 0.01 ≈ rigid: a centimetre of flesh breathing, and whatever
   * the clamped rotation cannot express. Crank toward 0.10+ for the M5
   * loose-neck bestiary variant — the rotation clamp keeps it attached, so
   * cranking degrades gracefully into the dislocated-head horror instead of
   * detaching the face. */
  driftMax: 0.01,
} as const;

const KEY_EPS = 1e-4;

/**
 * Builds a rig from the body's resolved bone joints and binds every primitive
 * endpoint to its nearest joint.
 *
 * One endpoint follows exactly one point — an SDF primitive is owned by a
 * single bone, so there are no skinning weights to solve and no blend seams.
 */
export function bindRig(body: BuildResult): BoundRig {
  // Deduplicate joints: a bone's tail and its child's head are the same point.
  const positions: Vec3[] = [];
  const indexOf = (p: Vec3): number => {
    for (let i = 0; i < positions.length; i++)
      if (len(sub(positions[i]!, p)) < KEY_EPS) return i;
    positions.push(p);
    return positions.length - 1;
  };

  const constraints: { a: number; b: number; rest: number; stiffness: number }[] = [];
  for (const bone of body.bones.values()) {
    const h = indexOf(bone.head);
    const t = indexOf(bone.tail);
    if (h !== t) constraints.push({ a: h, b: t, rest: len(sub(bone.tail, bone.head)), stiffness: 1 });
  }

  // Pin the lowest joint — without an anchor the whole rig falls under gravity.
  let lowest = 0;
  positions.forEach((p, i) => { if (p[1] < positions[lowest]![1]) lowest = i; });

  const rig = makeRig(
    positions.map((pos, i) => ({ pos, pinned: i === lowest })),
    constraints,
  );

  const bindEnd = (p: Vec3): EndpointBind => {
    let best = 0;
    let bestD = Infinity;
    positions.forEach((q, i) => { const d = len(sub(p, q)); if (d < bestD) { bestD = d; best = i; } });
    return { point: best, offset: sub(p, positions[best]!) };
  };

  // The rigid head frame: skull-owned prims ride ONE transform derived from
  // the skull rig points, not per-endpoint nearest-joint binds. Membership is
  // head-limb SPHERES (a === b at rest) — exactly the face prims face.ts
  // emits. The neck-flesh capsule (a !== b, spanning chest→neck) deliberately
  // stays per-endpoint: rigidly rotating it would tear its chest end loose.
  // Spheres cannot shear, so per-endpoint binding is only ever WRONG for them
  // in the sense of leaving them behind — the rigid pass exists so they
  // rotate WITH the cranium instead.
  const skull = body.bones.get('skull');
  let head: HeadRigid | null = null;
  if (skull) {
    const pivot = indexOf(skull.head);
    const tip = indexOf(skull.tail);
    const prims = new Map<number, { a: Vec3; b: Vec3 }>();
    body.prims.forEach((p, i) => {
      if (p.limb === 'head' && len(sub(p.a, p.b)) < KEY_EPS)
        prims.set(i, { a: sub(p.a, positions[pivot]!), b: sub(p.b, positions[pivot]!) });
    });
    if (prims.size > 0) {
      const restTip = sub(positions[tip]!, positions[pivot]!);
      head = { pivot, tip, restDir: normalize(restTip), restTip, prims };
    }
  }

  return { rig, binding: body.prims.map(p => ({ a: bindEnd(p.a), b: bindEnd(p.b) })), head };
}

/**
 * Re-derives primitive endpoints from the current rig pose and RECOMPUTES the
 * cluster bounding spheres.
 *
 * Skull-owned prims (the face) bypass the per-endpoint binding entirely: they
 * are posed by ONE rigid transform — rotation about the neck pivot clamped to
 * the IK_TUNING look-at cone, translation bounded by HEAD_RIGID_TUNING — so
 * the cranium, jaw, brow and nose can never shear apart no matter what the
 * verlet head point does. Every other prim follows its endpoint binds.
 *
 * Recomputing bounds is not optional: the shader culls on them, so a stale
 * bound silently discards flesh that has moved outside it — the exact failure
 * `validateBody`'s bounding-sphere check exists to catch. Cluster start/count
 * and ordering are left untouched, preserving the fold order.
 *
 * `bodyYaw` is the motion pipeline's applied body rotation (motion.ts
 * state.bodyYaw, 0 in the statue loop): the rigid head's clamp cone is
 * anchored to the ROTATED rest gaze, so turning the body does not clamp the
 * head back to the authored facing.
 */
export function applyRig(body: BuildResult, bound: BoundRig, bodyYaw = 0): BuildResult {
  const pos = bound.rig.points;
  const rigid = bound.head ? headTransform(bound.head, pos, bodyYaw) : null;
  const prims: Primitive[] = body.prims.map((p, i) => {
    const face = rigid?.prims.get(i);
    if (face && rigid) {
      return { ...p, a: add(rigid.origin, face.a), b: add(rigid.origin, face.b) };
    }
    const bind = bound.binding[i]!;
    const pa = pos[bind.a.point]!;
    const pb = pos[bind.b.point]!;
    return { ...p, a: add(pa.pos, bind.a.offset), b: add(pb.pos, bind.b.offset) };
  });

  const clusters: ClusterInfo[] = body.clusters.map(c => {
    const members = prims.slice(c.start, c.start + c.count);
    let sum: Vec3 = [0, 0, 0];
    for (const m of members) sum = add(sum, add(m.a, m.b));
    const center = vscale(sum, 1 / (members.length * 2));
    let radius = 0;
    for (const m of members) {
      const maxScale = Math.max(m.scale[0], m.scale[1], m.scale[2]);
      for (const end of [m.a, m.b])
        radius = Math.max(radius, len(sub(end, center)) + m.radius * maxScale);
    }
    return { ...c, center, radius };
  });

  return { ...body, prims, clusters };
}

/**
 * The head cluster's one rigid transform for the current pose: rotate every
 * skull prim by the clamped pivot→tip rotation about the neck pivot, and let
 * the unit's origin trail the head point by at most HEAD_RIGID_TUNING.driftMax
 * beyond what the rigid prediction already explains.
 *
 * At rest this is the exact identity: clampedDir === restDir makes qFromTo the
 * identity quaternion and the tip prediction lands on the tip point, so the
 * drift vector is zero — bit-identical to the pre-rigid posed body.
 */
function headTransform(h: HeadRigid, pos: readonly RigPoint[], bodyYaw = 0): {
  origin: Vec3;
  prims: Map<number, { a: Vec3; b: Vec3 }>;
} {
  const pivot = pos[h.pivot]!.pos;
  const tip = pos[h.tip]!.pos;
  const dir = normalize(sub(tip, pivot));
  // The cone anchor turns with the body: at yaw 0 this is exactly h.restDir.
  const rest = bodyYaw === 0 ? h.restDir : rotateYaw(h.restDir, bodyYaw);
  const clamped = clampDir(dir, rest, IK_TUNING.headMaxYaw, IK_TUNING.headMaxPitch);
  const q = qFromTo(h.restDir, clamped);

  // Translation: the neck pivot plus a bounded share of the drift the rigid
  // rotation does not explain (verlet lag, gait bob, whatever pulled the head
  // point). Bounded, not zero, so the head keeps a little life — and so the
  // loose-neck variant is a slider rather than a code path.
  const drift = sub(tip, add(pivot, qRotate(q, h.restTip)));
  const d = len(drift);
  const origin = d > HEAD_RIGID_TUNING.driftMax
    ? add(pivot, vscale(drift, HEAD_RIGID_TUNING.driftMax / d))
    : pivot;

  const prims = new Map<number, { a: Vec3; b: Vec3 }>();
  h.prims.forEach((rest, i) => prims.set(i, { a: qRotate(q, rest.a), b: qRotate(q, rest.b) }));
  return { origin, prims };
}

/** Shoves the rig point nearest a world position — used to make hits push flesh. */
export function impulseAt(bound: BoundRig, world: Vec3, delta: Vec3): BoundRig {
  let best = 0;
  let bestD = Infinity;
  bound.rig.points.forEach((p, i) => {
    const d = len(sub(world, p.pos));
    if (d < bestD && !p.pinned) { bestD = d; best = i; }
  });
  return {
    ...bound,
    rig: {
      ...bound.rig,
      points: bound.rig.points.map((p, i) => i === best ? { ...p, pos: add(p.pos, delta) } : p),
    },
  };
}
