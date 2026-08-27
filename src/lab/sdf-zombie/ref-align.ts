// src/lab/sdf-zombie/ref-align.ts
//
// Bring a reference skin into the .blob body's space: which reference joint
// corresponds to which of our bones, one measured global scale, and a
// per-bone RIGID transform.
//
// WHY RIGID PER BONE UNDER ONE GLOBAL SCALE. Rigid alignment makes limb
// fitting POSE-INDEPENDENT — the mouse mesh's T-posed arm and the .blob's
// 47-degree arm produce the same forearm rings, because each is measured in
// its own bone's frame. Refusing a PER-BONE scale keeps proportion errors
// visible: a bone of the wrong length shows up as residual piling up at one
// end instead of being quietly normalised away.
import type { ResolvedBone, Vec3 } from './types';
import type { RefSkin } from './ref-skin';
import { add, cross, dot, len, normalize, scale as vscale, sub } from './vec';

export interface BoneMapEntry {
  /** Reference joint at this bone's head. */
  head: string;
  /** Reference joint at this bone's tail. */
  tail: string;
  /** Reference joints whose vertices belong to this bone. */
  claims: string[];
}

/**
 * Our bone name -> reference rig joints. Written down, never inferred from
 * names.
 *
 * THE SPINE NAMES ARE COUNTER-INTUITIVE AND WERE VERIFIED AGAINST THE FILE.
 * The reference chain runs Hips -> Spine02 -> Spine01 -> Spine ->
 * {LeftShoulder, RightShoulder, neck}, so Spine02 is the LOWEST spine joint
 * and Spine the HIGHEST. An early draft had this inverted, which would have
 * attributed every torso vertex to the wrong bone while looking entirely
 * plausible. Do not "fix" it back.
 *
 * hand/finger bones are deliberately absent: the reference ends each arm at a
 * single LeftHand joint while the .blob models a hand plus four fingers, so
 * there is no sane attribution across the mismatch. skull is absent because
 * head prims are offset-positioned features plus a face block — use
 * scripts/head-profile.ts.
 */
export const BONE_MAP: Record<string, BoneMapEntry> = (() => {
  const m: Record<string, BoneMapEntry> = {
    pelvis: { head: 'Hips',    tail: 'Spine02', claims: ['Hips'] },
    spine1: { head: 'Spine02', tail: 'Spine01', claims: ['Spine02'] },
    chest:  { head: 'Spine01', tail: 'Spine',   claims: ['Spine01'] },
    spine2: { head: 'Spine',   tail: 'neck',    claims: ['Spine'] },
    neck:   { head: 'neck',    tail: 'Head',    claims: ['neck'] },
  };
  const limbs: Array<[string, (s: 'Left' | 'Right') => BoneMapEntry]> = [
    ['clavicle', (s) => ({ head: `${s}Shoulder`, tail: `${s}Arm`,     claims: [`${s}Shoulder`] })],
    ['upperarm', (s) => ({ head: `${s}Arm`,      tail: `${s}ForeArm`, claims: [`${s}Arm`] })],
    ['forearm',  (s) => ({ head: `${s}ForeArm`,  tail: `${s}Hand`,    claims: [`${s}ForeArm`] })],
    ['thigh',    (s) => ({ head: `${s}UpLeg`,    tail: `${s}Leg`,     claims: [`${s}UpLeg`] })],
    ['shin',     (s) => ({ head: `${s}Leg`,      tail: `${s}Foot`,    claims: [`${s}Leg`] })],
    ['foot',     (s) => ({ head: `${s}Foot`,     tail: `${s}ToeBase`, claims: [`${s}Foot`, `${s}ToeBase`] })],
  ];
  for (const [name, make] of limbs) {
    m[`${name}.l`] = make('Left');
    m[`${name}.r`] = make('Right');
  }
  return m;
})();

/** Reference joint name -> our bone name, derived from BONE_MAP's claims. */
const CLAIMED: Map<string, string> = new Map(
  Object.entries(BONE_MAP).flatMap(([bone, e]) => e.claims.map((j) => [j, bone] as [string, string])),
);

export interface Grouped {
  /** Our bone name -> the reference positions claimed by it. */
  byBone: Map<string, Vec3[]>;
  /** Reference joint name -> vertex count, for joints no bone claims. */
  unmapped: Map<string, number>;
}

export function groupByBone(skin: RefSkin): Grouped {
  const byBone = new Map<string, Vec3[]>();
  const unmapped = new Map<string, number>();
  for (const v of skin.verts) {
    const bone = CLAIMED.get(v.joint);
    if (bone === undefined) {
      unmapped.set(v.joint, (unmapped.get(v.joint) ?? 0) + 1);
      continue;
    }
    let list = byBone.get(bone);
    if (list === undefined) { list = []; byBone.set(bone, list); }
    list.push(v.position);
  }
  return { byBone, unmapped };
}

/** Index order of Primitive.scale. */
export const SCALE_AXIS_NAMES = ['wide', 'tall', 'deep'] as const;

export interface RingBasis {
  origin: Vec3;
  /**
   * First cross-section axis; theta is measured from here.
   *
   * ITS ROLL CARRIES NO MEANING. An earlier draft named e1/e2 "held" and
   * "solved" and attributed the residual's cos-2-theta term to whichever
   * world axis seeded e1. That was unsound — on mouse.blob, upperarm and
   * forearm (neighbours in one chain) seed from DIFFERENT world axes, and
   * both sit ~42 degrees off any of them, so the attribution was about half
   * right. The fit now solves all three scale components at once from each
   * sample's own world direction, so any orthonormal frame spanning the
   * perpendicular plane does equally well here.
   */
  e1: Vec3;
  /** Second cross-section axis, `u x e1`. */
  e2: Vec3;
  /** Along the bone, head -> tail. */
  u: Vec3;
  length: number;
}

const WORLD: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * Orthonormal frame for measuring a ring around a bone.
 *
 * NOT vec.ts's basisFromAxis: that seeds from the world axis LEAST aligned
 * with the bone, so its roll turns as the bone turns. Seeding from a world
 * axis instead keeps the frame STABLE under small authoring changes, which is
 * what makes a theta histogram comparable between two versions of a body. The
 * roll itself is not meaningful — see RingBasis.e1.
 */
export function ringBasis(head: Vec3, tail: Vec3): RingBasis {
  const d = sub(tail, head);
  const length = len(d);
  const u = length === 0 ? ([0, 1, 0] as Vec3) : normalize(d);

  // Seed from the lowest-indexed world axis that is NOT the one the bone runs
  // most closely along, so the projection never degenerates.
  let drop: 0 | 1 | 2 = 0;
  for (const i of [1, 2] as const) if (Math.abs(u[i]) > Math.abs(u[drop])) drop = i;
  const seed = WORLD[drop === 0 ? 1 : 0]!;
  const e1 = normalize(sub(seed, vscale(u, dot(seed, u))));
  const e2 = cross(u, e1);
  return { origin: head, e1, e2, u, length };
}

export interface Local { x1: number; x2: number; along: number }

export function toLocal(p: Vec3, b: RingBasis): Local {
  const v = sub(p, b.origin);
  return { x1: dot(v, b.e1), x2: dot(v, b.e2), along: dot(v, b.u) };
}

export function fromLocal(l: Local, b: RingBasis): Vec3 {
  return add(b.origin, add(vscale(b.e1, l.x1), add(vscale(b.e2, l.x2), vscale(b.u, l.along))));
}

export interface GlobalScale {
  /** Multiply reference lengths by this to reach our metres. */
  scale: number;
  /** 100 * (max - min) / median across mapped bones. */
  spreadPct: number;
  /** Bone whose ratio is furthest from the median — read this before trusting the fit. */
  worstBone: string;
  n: number;
}

/**
 * ONE uniform scale for the whole figure, from the median of per-bone length
 * ratios. Deliberately not per bone: a per-bone scale would normalise away a
 * bone of the wrong LENGTH, which is a `len=` edit we want to stay visible.
 */
export function globalScale(
  refBones: Map<string, { head: Vec3; tail: Vec3 }>,
  ourBones: Map<string, ResolvedBone>,
): GlobalScale {
  const ratios: Array<{ bone: string; r: number }> = [];
  // Every bone present in BOTH maps. refBones() only ever emits BONE_MAP
  // bones, so this is already the mapped set; intersecting here rather than
  // re-filtering through BONE_MAP keeps the function honest about its inputs
  // and lets our body carry bones (hand, fingers, skull) the reference lacks.
  for (const [bone, ref] of refBones) {
    const our = ourBones.get(bone);
    if (!our) continue;
    const refLen = len(sub(ref.tail, ref.head));
    const ourLen = len(sub(our.tail, our.head));
    if (refLen < 1e-9 || ourLen < 1e-9) continue;
    ratios.push({ bone, r: ourLen / refLen });
  }
  if (ratios.length === 0) throw new Error('no bone appears in both the reference and the body');
  const sorted = [...ratios].sort((a, b) => a.r - b.r);
  const mid = sorted[Math.floor((sorted.length - 1) / 2)]!.r;
  const median = sorted.length % 2 === 1
    ? mid
    : (mid + sorted[Math.floor(sorted.length / 2)]!.r) / 2;
  const worst = ratios.reduce((w, c) => (Math.abs(c.r - median) > Math.abs(w.r - median) ? c : w));
  return {
    scale: median,
    spreadPct: 100 * (sorted[sorted.length - 1]!.r - sorted[0]!.r) / median,
    worstBone: worst.bone,
    n: ratios.length,
  };
}

/**
 * Reference point -> our body's space: scale the bone-local coordinates by the
 * ONE global scale, then rebuild them in our bone's frame. Rotation and
 * translation are absorbed here, which is what makes the fit pose-independent;
 * `along` is NOT renormalised, so a bone of the wrong length still shows.
 */
export function refToBody(p: Vec3, refB: RingBasis, ourB: RingBasis, s: number): Vec3 {
  const l = toLocal(p, refB);
  return fromLocal({ x1: l.x1 * s, x2: l.x2 * s, along: l.along * s }, ourB);
}

/** Reference bone head/tail from joint world positions, via BONE_MAP. */
export function refBones(jointWorld: Map<string, Vec3>): Map<string, { head: Vec3; tail: Vec3 }> {
  const out = new Map<string, { head: Vec3; tail: Vec3 }>();
  for (const [bone, e] of Object.entries(BONE_MAP)) {
    const head = jointWorld.get(e.head), tail = jointWorld.get(e.tail);
    if (head && tail) out.set(bone, { head, tail });
  }
  return out;
}
