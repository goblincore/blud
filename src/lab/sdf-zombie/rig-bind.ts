// src/lab/sdf-zombie/rig-bind.ts
import type { BuildResult } from './build-body';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import type { Quat } from './vec';
import { boxReach } from './extent';
import { makeRig, type RigPoint, type RigState } from './rig';
import { IK_TUNING, clampDir } from './ik';
import { rotateYaw } from './gait';
import {
  add, bendCtrl, len, normalize, qFromAxisAngle, qFromTo, qIdentity, qMul, qRotate,
  scale as vscale, sub,
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
  /**
   * Skull-owned BONE prims (wound pass r2), same rule and same frame — a
   * derived cranium bone is a head-limb sphere and would shear off the face
   * under per-endpoint nearest-joint binds, the exact bug the rigid pass
   * exists to prevent. Keyed by index into body.bonePrims.
   */
  bones: Map<number, { a: Vec3; b: Vec3 }>;
}

export interface BoundRig {
  rig: RigState;
  binding: PrimBind[];
  /** Parallel to body.bonePrims — the same nearest-joint machinery. */
  boneBinding: PrimBind[];
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
    // Bones follow the SAME membership rule as the face prims above — head-limb
    // spheres ride the rigid frame, everything else stays per-endpoint.
    const bones = new Map<number, { a: Vec3; b: Vec3 }>();
    body.bonePrims.forEach((p, i) => {
      if (p.limb === 'head' && len(sub(p.a, p.b)) < KEY_EPS)
        bones.set(i, { a: sub(p.a, positions[pivot]!), b: sub(p.b, positions[pivot]!) });
    });
    if (prims.size > 0 || bones.size > 0) {
      const restTip = sub(positions[tip]!, positions[pivot]!);
      head = { pivot, tip, restDir: normalize(restTip), restTip, prims, bones };
    }
  }

  return {
    rig,
    binding: body.prims.map(p => ({ a: bindEnd(p.a), b: bindEnd(p.b) })),
    // BONE prims: torso and head bones bind BOTH ends to the ONE joint nearest
    // the bone's midpoint, so a rib is rigid with its spine segment. Per-end
    // nearest-joint binding put a rib's tip on a hip or shoulder joint (zombie:
    // six torso bones spanned two joints) and the ribcage sheared apart under
    // the gait — invisible while bone was field-shaded inside cavities, obvious
    // once bone tubes drew it (owner, 2026-09-03). Limb bones legitimately span
    // two joints (upper arm: shoulder -> elbow) and keep the per-end bind.
    boneBinding: body.bonePrims.map(p => {
      if (p.limb !== 'torso' && p.limb !== 'head') return { a: bindEnd(p.a), b: bindEnd(p.b) };
      const mid: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      const j = bindEnd(mid).point;
      return { a: { point: j, offset: sub(p.a, positions[j]!) }, b: { point: j, offset: sub(p.b, positions[j]!) } };
    }),
    head,
  };
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
 * The refit itself must know about `boxReach` for the same reason: a box
 * primitive's surface reaches its CORNER, past `radius`, and a refit that
 * forgets that term reintroduces the exact stale-bound failure above by a
 * second route — the bound is freshly computed every frame, but freshly
 * WRONG for any posed body carrying a box (X1.28 task 4c, site 8). This is
 * the posed-body counterpart of assignClusters' rest-space fit; both must
 * agree, or a character reads as solid at rest and grows a hole the moment
 * it moves.
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
      // orient carries the head's rigid rotation into the field maths so the
      // anisotropic face ellipsoids (brow/nose/jaw) squash along the TURNED
      // skull axes, not the world's — the detached-visor fix. Same q
      // headTransform derived; reused, not recomputed.
      return { ...p, a: add(rigid.origin, face.a), b: add(rigid.origin, face.b), orient: rigid.q };
    }
    const bind = bound.binding[i]!;
    const pa = pos[bind.a.point]!;
    const pb = pos[bind.b.point]!;
    return { ...p, a: add(pa.pos, bind.a.offset), b: add(pb.pos, bind.b.offset) };
  });

  // Bones pose in the SAME pass with the SAME machinery — a bone left at rest
  // would float while its limb moves. Skull-owned bones take the rigid-head
  // branch exactly as the face prims do.
  const bonePrims: Primitive[] = body.bonePrims.map((p, i) => {
    const face = rigid?.bones.get(i);
    if (face && rigid) {
      return { ...p, a: add(rigid.origin, face.a), b: add(rigid.origin, face.b), orient: rigid.q };
    }
    const bind = bound.boneBinding[i]!;
    const pa = pos[bind.a.point]!;
    const pb = pos[bind.b.point]!;
    return { ...p, a: add(pa.pos, bind.a.offset), b: add(pb.pos, bind.b.offset) };
  });

  const clusters: ClusterInfo[] = body.clusters.map(c => {
    const members = prims.slice(c.start, c.start + c.count);
    // Same bent-prim rule as assignClusters: the ctrl point joins the fit or
    // a swung horn escapes the sphere the shader culls by.
    let sum: Vec3 = [0, 0, 0];
    let pts = 0;
    for (const m of members) {
      sum = add(sum, add(m.a, m.b));
      pts += 2;
      if (m.bend !== undefined) { sum = add(sum, bendCtrl(m.a, m.b, m.bend)); pts += 1; }
    }
    const center = vscale(sum, 1 / pts);
    let radius = 0;
    for (const m of members) {
      const maxScale = Math.max(m.scale[0], m.scale[1], m.scale[2]);
      const ends = m.bend === undefined
        ? [m.a, m.b] : [m.a, m.b, bendCtrl(m.a, m.b, m.bend)];
      const rMax = Math.max(m.radius, m.radiusB ?? m.radius) * boxReach(m.box);
      for (const end of ends)
        radius = Math.max(radius, len(sub(end, center)) + rMax * maxScale);
    }
    return { ...c, center, radius };
  });

  return { ...body, prims, bonePrims, clusters };
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
 *
 * THE YAW MUST BE EXPLICIT (motion-polish task 5): the pivot→tip axis is
 * near-VERTICAL in every walking direction, so a bare qFromTo(restDir,
 * clamped) — the shortest arc between two near-vertical directions — carries
 * the head's pitch but ZERO azimuth: the body's 180° turn about the head's
 * long axis is invisible to it, and the face prims kept pointing the authored
 * way (nose lead 0.17 m walking +z but 0.02 m walking -z — quadrant-
 * dependent, the owner's "head turned around" screenshot). The rotation is
 * therefore composed as qMul(residual, qYaw): the known body turn first (the
 * exact rotateYaw quaternion), then the shortest-arc residual from the TURNED
 * rest direction to the clamped solve — the residual only ever expresses the
 * in-cone look-at tilt it can see.
 */
function headTransform(h: HeadRigid, pos: readonly RigPoint[], bodyYaw = 0): {
  origin: Vec3;
  prims: Map<number, { a: Vec3; b: Vec3 }>;
  bones: Map<number, { a: Vec3; b: Vec3 }>;
  /** The clamped rigid rotation — applyRig also stamps it as prim.orient. */
  q: Quat;
} {
  const pivot = pos[h.pivot]!.pos;
  const tip = pos[h.tip]!.pos;
  const dir = normalize(sub(tip, pivot));
  // The cone anchor turns with the body: at yaw 0 this is exactly h.restDir.
  const rest = bodyYaw === 0 ? h.restDir : rotateYaw(h.restDir, bodyYaw);
  const clamped = clampDir(dir, rest, IK_TUNING.headMaxYaw, IK_TUNING.headMaxPitch);
  const qYaw = bodyYaw === 0 ? qIdentity() : qFromAxisAngle([0, 1, 0], bodyYaw);
  // qMul(a, b) applies b first: the body turn, then the in-cone residual.
  const q = qMul(qFromTo(rest, clamped), qYaw);

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
  const bones = new Map<number, { a: Vec3; b: Vec3 }>();
  h.bones.forEach((rest, i) => bones.set(i, { a: qRotate(q, rest.a), b: qRotate(q, rest.b) }));
  return { origin, prims, bones, q };
}

/**
 * The rigid head's CURRENT clamped rotation (the same quaternion applyRig
 * poses the face with), for consumers outside the pose path — the face
 * texture projection un-rotates by it so the painted face rides the skull.
 * Null when the body has no skull (gibbed).
 */
export function headQuatOf(bound: BoundRig, bodyYaw = 0): Quat | null {
  const h = bound.head;
  if (!h) return null;
  const pivot = bound.rig.points[h.pivot]!.pos;
  const tip = bound.rig.points[h.tip]!.pos;
  // Same composition as headTransform (the painted face must ride the SAME
  // rotation the skull masses were posed with): explicit body yaw first,
  // then the in-cone residual off the TURNED rest direction.
  const rest = bodyYaw === 0 ? h.restDir : rotateYaw(h.restDir, bodyYaw);
  const clamped = clampDir(
    normalize(sub(tip, pivot)), rest, IK_TUNING.headMaxYaw, IK_TUNING.headMaxPitch);
  const qYaw = bodyYaw === 0 ? qIdentity() : qFromAxisAngle([0, 1, 0], bodyYaw);
  return qMul(qFromTo(rest, clamped), qYaw);
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
