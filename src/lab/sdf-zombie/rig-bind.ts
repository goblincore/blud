// src/lab/sdf-zombie/rig-bind.ts
import type { BuildResult } from './build-body';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import type { Quat } from './vec';
import { boxReach, shellReach, strandReach } from './extent';
import { constrainRigBends, makeRig, type RigPoint, type RigState } from './rig';
import { IK_TUNING, clampDir } from './ik';
import { rotateYaw } from './gait';
import { segmentQuat } from './rig-frames';
import {
  add, bendCtrl, cross, dot, len, normalize, qRotate, qMul,
  scale as vscale, sub,
} from './vec';

/** Which rig point an endpoint follows, and its fixed offset from that point. */
interface EndpointBind { point: number; offset: Vec3 }
interface PrimBind {
  a: EndpointBind;
  b: EndpointBind;
  /** Arm endpoint insets rotate with their bone, including at full extension. */
  armFrame?: { head: number; tail: number; restDir: Vec3 };
}

/** The upper-arm / forearm bone for a side, under either naming convention:
 *  the zombie's `upperArm`/`foreArm` or the `.blob` idiom `upperarm`/`forearm`. */
function armBoneName(body: BuildResult, part: 'upper' | 'fore', side: 'l' | 'r'): string | null {
  for (const n of part === 'upper' ? ['upperArm', 'upperarm'] : ['foreArm', 'forearm']) {
    if (body.bones.has(`${n}.${side}`)) return `${n}.${side}`;
  }
  return null;
}
const ARM_BONE_RE = /^(upperArm|upperarm|foreArm|forearm)\.[lr]$/;

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

/**
 * A torso/head BONE prim's rigid frame: the axial rig segment (pelvis, spine,
 * neck) it belongs to, and its rest endpoints relative to that segment's head.
 * Posed as ONE rotation + translation derived from the segment's two rig
 * points, so the whole ribcage turns with the spine instead of each rib
 * translating with whichever joint it was nearest (owner, 2026-09-03: "the
 * ribcage has a top and bottom half and they shear" — a point-bind carries no
 * rotation, so the moment the spine tilted, ribs bound to the chest point and
 * ribs bound to the hips point slid past each other).
 */
export interface BoneFrame {
  head: number;
  tail: number;
  /** Bind-time unit direction head→tail. */
  restDir: Vec3;
  restA: Vec3;
  restB: Vec3;
}

export interface BoundRig {
  rig: RigState;
  binding: PrimBind[];
  /** Parallel to body.bonePrims — the same nearest-joint machinery. */
  boneBinding: PrimBind[];
  /** Torso/head bone prims keyed by index: posed rigidly from an axial segment. */
  boneFrames: Map<number, BoneFrame>;
  /** Null when the body has no `skull` bone or no skull-owned spheres. */
  head: HeadRigid | null;
  /** Extremity tips (hand and foot bone tails) held RIGID to their anchor
   *  joint — see pinTips. Empty for bodies without hand/foot bones. */
  tips: RigidTip[];
}

/**
 * A hand tip or toe: a leaf rig point that nothing in the gait drives. Left
 * free, it is a verlet point on a length constraint — it sags under gravity
 * and swings in the stride, so a boot posed from ankle→toe (rig-frames.ts)
 * pitched toe-down while the flesh foot, bound to the ankle, stayed level,
 * and the heel slid out under the boot (owner, 2026-09-05). Pinned, it is the
 * anchor plus its yawed rest offset every step: boot and flesh agree, the
 * gun's grip frame stops jiggling.
 */
export interface RigidTip {
  point: number;
  anchor: number;
  /** Bind-time tip − anchor, body-local (yaw 0). */
  rest: Vec3;
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
  // Only intact upper-arm/forearm chains get an elbow stop. Dead distal
  // prims retain bone metadata for wound anchoring, so bone names alone
  // cannot tell us whether the joint is still attached.
  rig.bends = [];
  // The mirrored shoulders establish the authored body's lateral axis.
  // Flexion is toward body-forward, not toward the rest forearm: its inward
  // carrying angle otherwise lets sideways motion mask backward extension.
  const leftShoulderName = armBoneName(body, 'upper', 'l');
  const rightShoulderName = armBoneName(body, 'upper', 'r');
  const leftShoulder = leftShoulderName ? body.bones.get(leftShoulderName)?.head : undefined;
  const rightShoulder = rightShoulderName ? body.bones.get(rightShoulderName)?.head : undefined;
  const bodyForward = leftShoulder && rightShoulder
    ? normalize(cross(sub(leftShoulder, rightShoulder), [0, 1, 0])) : [0, 0, 1] as Vec3;
  for (const side of ['l', 'r'] as const) {
    const upperName = armBoneName(body, 'upper', side), foreName = armBoneName(body, 'fore', side);
    if (!upperName || !foreName) continue;
    const live = (name: string) => body.prims.some(p => p.bone === name && !p.dead &&
      (p.op === undefined || p.op === 'add') && len(sub(p.b, p.a)) > KEY_EPS &&
      body.clusters[p.cluster]?.alive);
    const upper = body.bones.get(upperName), fore = body.bones.get(foreName);
    if (!upper || !fore || !live(upperName) || !live(foreName)) continue;
    const restUpper = normalize(sub(upper.tail, upper.head));
    const restPole = normalize(sub(bodyForward, vscale(restUpper, dot(bodyForward, restUpper))));
    if (len(restPole) < 1e-8) continue; // no forward flexion axis for this rest arm
    rig.bends.push({ root: indexOf(upper.head), mid: indexOf(upper.tail),
      end: indexOf(fore.tail), restUpper, restPole, maxFlex: 150 * Math.PI / 180 });
  }

  // Joints of the unmirrored (centreline) bones: pelvis, spine, neck, skull.
  // Mirrored bones expand to `name.l` / `name.r` (mirror.ts), so the suffix is
  // the honest marker. Falls back to every joint when a body has none.
  const axialJoints: number[] = [];
  for (const [name, bone] of body.bones) {
    if (/\.[lr]$/.test(name)) continue;
    for (const j of [indexOf(bone.head), indexOf(bone.tail)])
      if (!axialJoints.includes(j)) axialJoints.push(j);
  }
  // Axial SEGMENTS (head/tail joint pairs of the unmirrored bones) for the
  // rigid torso-bone frames below.
  const axialSegs: { head: number; tail: number }[] = [];
  for (const [name, bone] of body.bones) {
    if (/\.[lr]$/.test(name)) continue;
    const h = indexOf(bone.head), t = indexOf(bone.tail);
    if (h !== t) axialSegs.push({ head: h, tail: t });
  }
  const nearestSeg = (p: Vec3): { head: number; tail: number } | null => {
    let best: { head: number; tail: number } | null = null;
    let bestD = Infinity;
    for (const s of axialSegs) {
      const a = positions[s.head]!, b = positions[s.tail]!;
      const ab = sub(b, a), ap = sub(p, a);
      const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2));
      const d = len(sub(p, add(a, vscale(ab, t))));
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  };
  const bindAxial = (p: Vec3): number => {
    const pool = axialJoints.length > 0 ? axialJoints : positions.map((_, i) => i);
    let best = pool[0]!;
    let bestD = Infinity;
    for (const i of pool) { const d = len(sub(p, positions[i]!)); if (d < bestD) { bestD = d; best = i; } }
    return best;
  };

  const bindEnd = (p: Vec3): EndpointBind => {
    let best = 0;
    let bestD = Infinity;
    positions.forEach((q, i) => { const d = len(sub(p, q)); if (d < bestD) { bestD = d; best = i; } });
    return { point: best, offset: sub(p, positions[best]!) };
  };

  // The rigid head frame: skull-owned prims ride ONE transform derived from
  // the skull rig points, not per-endpoint nearest-joint binds. The neck-flesh
  // capsule (spanning chest→neck) deliberately stays per-endpoint: rigidly
  // rotating it would tear its chest end loose.
  //
  // MEMBERSHIP IS SHAPE-BLIND, and was not (fixed 2026-09-06). The rule used
  // to be head-limb SPHERES (a === b at rest), justified as "exactly the face
  // prims face.ts emits" — true of face.ts, and false of every face authored
  // in a .blob. The goblin's ears, hooked nose and lip blobs carry a `tip=`,
  // so a !== b, so all four fell through to per-endpoint nearest-joint binds;
  // when the skull rotated on the neck the cranium turned and the FACE DID
  // NOT. The owner found it by eye ("the prims on the head/face don't move
  // with the rest of the head", and "he looks fine if you turn movement off"),
  // and ELEVEN of the sixteen shipped characters are affected — the ZOMBIE is
  // one of the few that is not, which is why no gate saw it: he is what every
  // capture in this repo renders.
  //
  // What actually distinguishes a face prim from the neck capsule is not its
  // SHAPE but WHERE ITS ENDS LIVE: both of a face prim's ends sit on the skull
  // segment, while the neck capsule has one end down at the chest. So a prim
  // joins when both endpoints bind to a skull rig point. Spheres stay in
  // unconditionally, exactly as before — that keeps the change ADDITIVE, so a
  // body whose head prims are all spheres (the zombie, and every pixel
  // baseline taken of him) is provably unmoved. See rig-bind.test.ts, which
  // pins the zombie's rigid set to precisely his head spheres.
  const skull = body.bones.get('skull');
  const skullPts = skull ? new Set([indexOf(skull.head), indexOf(skull.tail)]) : null;
  /** Does this prim ride the ONE rigid head transform? Shared by the rigid
   *  set built below and by boneFrames further down, which must agree with it
   *  exactly — a bone prim posed BOTH rigidly and axially is posed twice. */
  const ridesHead = (p: { limb: string; a: Vec3; b: Vec3 }): boolean =>
    skullPts !== null
    && p.limb === 'head'
    && (len(sub(p.a, p.b)) < KEY_EPS
      || (skullPts.has(bindEnd(p.a).point) && skullPts.has(bindEnd(p.b).point)));
  let head: HeadRigid | null = null;
  if (skull) {
    const pivot = indexOf(skull.head);
    const tip = indexOf(skull.tail);
    const prims = new Map<number, { a: Vec3; b: Vec3 }>();
    body.prims.forEach((p, i) => {
      if (ridesHead(p))
        prims.set(i, { a: sub(p.a, positions[pivot]!), b: sub(p.b, positions[pivot]!) });
    });
    // Bones follow the SAME membership rule as the face prims above.
    const bones = new Map<number, { a: Vec3; b: Vec3 }>();
    body.bonePrims.forEach((p, i) => {
      if (ridesHead(p))
        bones.set(i, { a: sub(p.a, positions[pivot]!), b: sub(p.b, positions[pivot]!) });
    });
    if (prims.size > 0 || bones.size > 0) {
      const restTip = sub(positions[tip]!, positions[pivot]!);
      head = { pivot, tip, restDir: normalize(restTip), restTip, prims, bones };
    }
  }

  const bindPrim = (p: Primitive): PrimBind => {
    const binding: PrimBind = { a: bindEnd(p.a), b: bindEnd(p.b) };
    const bone = p.bone && ARM_BONE_RE.test(p.bone) ? body.bones.get(p.bone) : undefined;
    if (bone) binding.armFrame = { head: indexOf(bone.head), tail: indexOf(bone.tail),
      restDir: normalize(sub(bone.tail, bone.head)) };
    return binding;
  };

  return {
    rig,
    binding: body.prims.map(bindPrim),
    // BONE prims: torso and head bones bind BOTH ends to the ONE joint nearest
    // the bone's midpoint, so a rib is rigid with its spine segment. Per-end
    // nearest-joint binding put a rib's tip on a hip or shoulder joint (zombie:
    // six torso bones spanned two joints) and the ribcage sheared apart under
    // the gait — invisible while bone was field-shaded inside cavities, obvious
    // once bone tubes drew it (owner, 2026-09-03). Limb bones legitimately span
    // two joints (upper arm: shoulder -> elbow) and keep the per-end bind.
    //
    // And the joint is the nearest AXIAL one — a joint of an unmirrored bone
    // (pelvis, spine, neck, skull), never a hip or shoulder. A real rib hoop
    // has its chord midpoint out at the flank (x ~0.08-0.15), which is nearer
    // the hip or shoulder joint than any spine joint; hips, shoulders and the
    // spine each take their own gait offsets (gait.ts hip drop, shoulder
    // sway/droop), so a rib bound there would shear off the cage exactly as
    // the per-end bind did. A rib belongs to a vertebra (2026-09-03 skeleton
    // re-author, which is what made hoops wide enough to need this).
    boneBinding: body.bonePrims.map(p => {
      if (p.limb !== 'torso' && p.limb !== 'head') return bindPrim(p);
      const mid: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      const j = bindAxial(mid);
      return { a: { point: j, offset: sub(p.a, positions[j]!) }, b: { point: j, offset: sub(p.b, positions[j]!) } };
    }),
    boneFrames: (() => {
      const frames = new Map<number, BoneFrame>();
      body.bonePrims.forEach((p, i) => {
        if (p.limb !== 'torso' && p.limb !== 'head') return;
        // Skull-owned prims ride the rigid head instead — SAME membership
        // test as the rigid set above, not a second copy of it. This was a
        // duplicated `a === b` shape check, and leaving it behind when the
        // rigid rule widened would have posed the goblin's nose bone twice.
        if (ridesHead(p)) return;
        const mid: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
        const seg = nearestSeg(mid);
        if (!seg) return;
        const h = positions[seg.head]!;
        frames.set(i, {
          head: seg.head, tail: seg.tail,
          restDir: normalize(sub(positions[seg.tail]!, h)),
          restA: sub(p.a, h), restB: sub(p.b, h),
        });
      });
      return frames;
    })(),
    head,
    tips: (() => {
      const tips: RigidTip[] = [];
      const heads = new Set<number>();
      for (const b of body.bones.values()) heads.add(indexOf(b.head));
      for (const [name, b] of body.bones) {
        if (!/^(hand|foot)\.[lr]$/.test(name)) continue;
        const tip = indexOf(b.tail), anchor = indexOf(b.head);
        if (tip === anchor || heads.has(tip)) continue; // not a leaf
        tips.push({ point: tip, anchor, rest: sub(positions[tip]!, positions[anchor]!) });
      }
      return tips;
    })(),
  };
}

/** Snap every rigid tip to anchor + yawed rest offset (pos AND prev, so the
 *  verlet carries no velocity into the next step). Pure; returns new points. */
export function pinTips(points: readonly RigPoint[], tips: readonly RigidTip[], bodyYaw = 0, targets?: readonly Vec3[]): RigPoint[] {
  if (tips.length === 0) return points as RigPoint[];
  const out = points.slice();
  for (const t of tips) {
    const offset = targets ? vscale(normalize(sub(targets[t.point]!, targets[t.anchor]!)), len(t.rest))
      : bodyYaw === 0 ? t.rest : rotateYaw(t.rest, bodyYaw);
    const pos = add(out[t.anchor]!.pos, offset);
    out[t.point] = { ...out[t.point]!, pos, prev: pos };
  }
  return out;
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
  const rigid = bound.head ? headTransform(bound.head, pos, bodyYaw, bound.rig.headFollowsRig) : null;
  // Every rib/vertebra on an axial segment uses the same rotation. Derive it
  // once per applyRig call; a cache lasting across calls would retain a stale
  // pose after Verlet, yaw changes, or a collapse. Check restDir too because
  // callers can supply custom bindings for the same pair of rig points.
  const rotations = new Map<number, { restDir: Vec3; q: Quat }>();
  const rotationOf = (frame: { head: number; tail: number; restDir: Vec3 }): Quat => {
    const key = frame.head * pos.length + frame.tail;
    const cached = rotations.get(key);
    const r = frame.restDir;
    if (cached && cached.restDir[0] === r[0] && cached.restDir[1] === r[1] && cached.restDir[2] === r[2]) return cached.q;
    const dir = normalize(sub(pos[frame.tail]!.pos, pos[frame.head]!.pos));
    const q = segmentQuat(r, dir, bodyYaw);
    rotations.set(key, { restDir: r, q });
    return q;
  };
  const yawRotation: Quat = [0, Math.sin(bodyYaw / 2), 0, Math.cos(bodyYaw / 2)];
  const posePrimitive = (p: Primitive, bind: PrimBind): Primitive => {
    const q = bind.armFrame ? rotationOf(bind.armFrame) : yawRotation;
    const turned = Math.abs(1 - q[3]) > 1e-6;
    const orientedShape = p.scale[0] !== p.scale[1] || p.scale[1] !== p.scale[2]
      || p.box || p.shell || p.strand || p.orient;
    // Endpoint insets and anisotropic axes belong to the character, not the
    // world. Leaving either behind made the same zombie look thin-chested
    // and wide-footed when it faced sideways (the apparent room variants).
    // Isotropic capsules retain the cheap un-oriented field path.
    return {
      ...p,
      a: add(pos[bind.a.point]!.pos, qRotate(q, bind.a.offset)),
      b: add(pos[bind.b.point]!.pos, qRotate(q, bind.b.offset)),
      ...(p.bend ? { bend: qRotate(q, p.bend) } : {}),
      ...(turned && orientedShape
        ? (p.orient ? { orient: qMul(q, p.orient) } : { orient: q, poseOrient: true })
        : {}),
    };
  };
  const prims: Primitive[] = body.prims.map((p, i) => {
    const face = rigid?.prims.get(i);
    if (face && rigid) {
      // orient carries the head's rigid rotation into the field maths so the
      // anisotropic face ellipsoids (brow/nose/jaw) squash along the TURNED
      // skull axes, not the world's — the detached-visor fix. Same q
      // headTransform derived; reused, not recomputed.
      //
      // bend turns with it, as in posePrimitive: the field conjugates the
      // control point by orient along with the endpoints, so a rest-space
      // bend bowed a turned head's curve back into the skull — the ogre's
      // painted lips showed only their two end caps (rig-bind.test.ts).
      return { ...p, a: add(rigid.origin, face.a), b: add(rigid.origin, face.b), orient: rigid.q,
        ...(p.bend ? { bend: qRotate(rigid.q, p.bend) } : {}) };
    }
    return posePrimitive(p, bound.binding[i]!);
  });

  // Bones pose in the SAME pass with the SAME machinery — a bone left at rest
  // would float while its limb moves. Skull-owned bones take the rigid-head
  // branch exactly as the face prims do.
  //
  // Each bone prim is also TAGGED with its rigid segment (boneSegment), the
  // unit the bone-segment sphere cull groups rows by (pack.ts): the skull
  // unit, one axial BoneFrame per spine/pelvis segment, one limb bone per
  // bind-point pair, and one segment for every organ. Ids are dense small
  // ints assigned in first-seen order — deterministic because the map is.
  const segIds = new Map<string, number>();
  const segOf = (key: string): number => {
    let v = segIds.get(key);
    if (v === undefined) { v = segIds.size; segIds.set(key, v); }
    return v;
  };
  const bonePrims: Primitive[] = body.bonePrims.map((p, i) => {
    const face = rigid?.bones.get(i);
    const frame = bound.boneFrames.get(i);
    const boneSegment = segOf(
      p.op === 'organ' ? 'organs'
      : face && rigid ? 'head'
      : frame ? `axial:${frame.head}-${frame.tail}`
      : `limb:${p.limb}:${bound.boneBinding[i]!.a.point}-${bound.boneBinding[i]!.b.point}`);
    if (face && rigid) {
      return { ...p, a: add(rigid.origin, face.a), b: add(rigid.origin, face.b), orient: rigid.q,
        ...(p.bend ? { bend: qRotate(rigid.q, p.bend) } : {}), boneSegment };
    }
    if (frame) {
      // Same composition as headTransform: the known body yaw first (the
      // segment is near-vertical, so a bare shortest-arc rotation between rest
      // and current direction would drop the azimuth), then the residual tilt.
      const h = pos[frame.head]!.pos;
      const q = rotationOf(frame);
      return { ...p, a: add(h, qRotate(q, frame.restA)), b: add(h, qRotate(q, frame.restB)), orient: q,
        ...(p.bend ? { bend: qRotate(q, p.bend) } : {}), boneSegment };
    }
    return { ...posePrimitive(p, bound.boneBinding[i]!), boneSegment };
  });

  const clusters = refitClusters(prims, body.clusters);

  return { ...body, prims, bonePrims, clusters };
}

/**
 * Recompute every cluster's centre and radius from a POSED prim set.
 *
 * A cluster sphere is an OUTER bound: the march culls by it and the proxy box
 * is sized from it, so a bound left over a body whose prims have MOVED does not
 * draw a wrong shape — it CULLS, which presents as a round see-through hole
 * (extent.ts's header counts the eight sites that compute this recipe and warns
 * about a ninth). It is exported for exactly that reason: the hurt-box tear
 * (gib-tear.ts) displaces posed prims and needs the same refit, and two copies
 * of this arithmetic is how the ninth site happens.
 */
export function refitClusters(prims: Primitive[], clusters: ClusterInfo[]): ClusterInfo[] {
  return clusters.map(c => {
    const end = Math.min(prims.length, c.start + c.count);
    // Keep the original addition order while avoiding member slices and the
    // two temporary vectors previously allocated for every endpoint pair.
    let sx = 0, sy = 0, sz = 0, pts = 0;
    for (let i = c.start; i < end; i++) {
      const m = prims[i]!;
      sx += m.a[0] + m.b[0]; sy += m.a[1] + m.b[1]; sz += m.a[2] + m.b[2];
      pts += 2;
      if (m.bend !== undefined) {
        const ctrl = bendCtrl(m.a, m.b, m.bend);
        sx += ctrl[0]; sy += ctrl[1]; sz += ctrl[2]; pts++;
      }
    }
    const inv = 1 / (pts || 1);
    const center: Vec3 = [sx * inv, sy * inv, sz * inv];
    let radius = 0;
    const distance = (v: Vec3): number => {
      const x = v[0] - center[0], y = v[1] - center[1], z = v[2] - center[2];
      return Math.sqrt(x * x + y * y + z * z);
    };
    for (let i = c.start; i < end; i++) {
      const m = prims[i]!;
      const maxScale = Math.max(m.scale[0], m.scale[1], m.scale[2]);
      const rMax = Math.max(m.radius, m.radiusB ?? m.radius) * boxReach(m.box) * strandReach(m.strand);
      const reach = rMax * maxScale, shell = shellReach(m);
      radius = Math.max(radius, distance(m.a) + reach + shell);
      radius = Math.max(radius, distance(m.b) + reach + shell);
      if (m.bend !== undefined) radius = Math.max(radius, distance(bendCtrl(m.a, m.b, m.bend)) + reach + shell);
    }
    return { ...c, center, radius };
  });
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
function headTransform(h: HeadRigid, pos: readonly RigPoint[], bodyYaw = 0, followRig = false): {
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
  const clamped = followRig ? dir : clampDir(dir, rest, IK_TUNING.headMaxYaw, IK_TUNING.headMaxPitch);
  // qMul(a, b) applies b first: the body turn, then the in-cone residual.
  const q = segmentQuat(h.restDir, clamped, bodyYaw);

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
  const clamped = bound.rig.headFollowsRig ? normalize(sub(tip, pivot)) : clampDir(
    normalize(sub(tip, pivot)), rest, IK_TUNING.headMaxYaw, IK_TUNING.headMaxPitch);
  return segmentQuat(h.restDir, clamped, bodyYaw);
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
    rig: constrainRigBends({
      ...bound.rig,
      points: bound.rig.points.map((p, i) => i === best ? { ...p, pos: add(p.pos, delta) } : p),
    }),
  };
}
