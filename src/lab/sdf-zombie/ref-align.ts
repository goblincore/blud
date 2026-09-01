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
 * A named rig: our bone name -> reference rig joints, written down, never
 * inferred from names.
 *
 * WHY A REGISTRY AND NOT ONE GLOBAL TABLE. BONE_MAP was written for the one
 * rig every reference then shared, and green_dragon_rigged.glb broke that
 * assumption: its 29 joints are named Bone_000..Bone_028, so every joint was
 * unmapped and the report came back silently EMPTY — which reads as a perfect
 * measurement of nothing. Rigs are now named and selected by joint-name
 * signature (see detectRig), and a reference no rig matches is a loud error,
 * not an empty report.
 */
export interface RigDef {
  /** Registry name; printed with the report and named in detection errors. */
  name: string;
  boneMap: Record<string, BoneMapEntry>;
}

/**
 * The Meshy biped rig (mouse, schoolgirl, schoolgirl-alt, bonewalker).
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
export const MESHY_BIPED: RigDef = {
  name: 'meshy-biped',
  boneMap: (() => {
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
  })(),
};

/**
 * The Meshy table itself, under its historical name. Kept because it IS the
 * meshy-biped table — existing callers and tests mean exactly this object —
 * but new code should select a rig with detectRig rather than reaching for a
 * global.
 */
export const BONE_MAP: Record<string, BoneMapEntry> = MESHY_BIPED.boneMap;

/**
 * The green_dragon_rigged.glb rig (docs/dev-notes/refs/dragon-mesh/): 29
 * joints Bone_000..Bone_028, one skin, no animations, exact bind pose.
 *
 * VERIFIED against the file, not read off the names — measured from composed
 * joint world positions and per-joint vertex clouds. The chain: Bone_000
 * (root, its cloud sits at the pelvis/tail underside) -> Bone_001 (the
 * pelvis AND tail base — the mesh has no tail joints, so tail surface rides
 * here) -> {Bone_005 -> Bone_004 -> Bone_003 -> Bone_002 (the spine, and
 * unlike the meshy rig the numbering ASCENDS it), legL 010 -> 009 -> 008 ->
 * 007 -> 006, legR 015 -> 014 -> 013 -> 012 -> 011}, and off Bone_002:
 * {wingL 020 -> 019 -> 018 -> 017 -> 016, wingR 025 -> 024 -> 023 -> 022 ->
 * 021, neck 028 -> 027 -> 026}.
 *
 * The wings ARE the arms: they leave the shoulder at y 0.86 and reach |x|
 * 0.36 while only descending to y 0.44, so the arm chain maps onto their
 * first three segments and the tip (017/016, 022/021) stays unmapped — the
 * wing's "hand", same call as the meshy hands. The hind legs are
 * DIGITIGRADE: the chain reaches the ground at 007 (y 0.035), so the foot
 * spans hock -> toe (008 -> 006) and claims the whole load-bearing assembly
 * (008, 007, 006); the .blob `stance` keyword supports the pose.
 *
 * The head is deliberately unmapped: Bone_027's vertex cloud alone spans y
 * 1.01..1.60 and x +-0.36 — head, jaw and horns (24% of the mesh), far above
 * the 1.065 joint the neck bone ends at. Head work belongs to
 * scripts/head-profile.ts, as on the meshy rig. spine2 claims Bone_003 and
 * Bone_002, which carry no dominant vertices (the wing shoulders take that
 * surface) — the claims keep the shoulder bridge's ownership explicit.
 */
export const DRAGON_BIPED: RigDef = {
  name: 'dragon-biped',
  boneMap: (() => {
    // Joint names are zero-padded to three digits; a bare template literal
    // produced Bone_9 for Bone_009 and the whole table silently matched
    // nothing — caught by the detection test, which is why it exists.
    const joint = (i: number) => `Bone_${String(i).padStart(3, '0')}`;
    const m: Record<string, BoneMapEntry> = {
      pelvis:  { head: joint(1), tail: joint(5), claims: [joint(1), joint(0)] },
      spine1:  { head: joint(5), tail: joint(4), claims: [joint(5)] },
      chest:   { head: joint(4), tail: joint(3), claims: [joint(4)] },
      spine2:  { head: joint(3), tail: joint(28), claims: [joint(3), joint(2)] },
      neck:    { head: joint(28), tail: joint(27), claims: [joint(28)] },
    };
    const limbs: Array<[string, (n: 0 | 1) => BoneMapEntry]> = [
      ['clavicle', (n) => ({ head: joint(20 + n * 5), tail: joint(19 + n * 5), claims: [joint(20 + n * 5)] })],
      ['upperarm', (n) => ({ head: joint(19 + n * 5), tail: joint(18 + n * 5), claims: [joint(19 + n * 5)] })],
      ['forearm',  (n) => ({ head: joint(18 + n * 5), tail: joint(17 + n * 5), claims: [joint(18 + n * 5)] })],
      ['thigh',    (n) => ({ head: joint(10 + n * 5), tail: joint(9 + n * 5),  claims: [joint(10 + n * 5)] })],
      ['shin',     (n) => ({ head: joint(9 + n * 5),  tail: joint(8 + n * 5),  claims: [joint(9 + n * 5)] })],
      ['foot',     (n) => ({ head: joint(8 + n * 5),  tail: joint(6 + n * 5),  claims: [joint(8 + n * 5), joint(7 + n * 5), joint(6 + n * 5)] })],
    ];
    const side: Array<'l' | 'r'> = ['l', 'r'];
    for (const [name, make] of limbs) for (const s of side) m[`${name}.${s}`] = make(s === 'l' ? 0 : 1);
    return m;
  })(),
};

/** Every rig this tool can measure, in detection order. */
const RIGS: RigDef[] = [MESHY_BIPED, DRAGON_BIPED];

/** All joint names a rig's table references — its detection signature. */
function requiredJoints(rig: RigDef): Set<string> {
  return new Set(Object.values(rig.boneMap).flatMap((e) => [e.head, e.tail, ...e.claims]));
}

/**
 * Select the rig whose table this reference can satisfy: a rig matches when
 * EVERY joint its table names is present. Anything less would silently skip
 * bones in refBones, so the match is all-or-nothing.
 *
 * Throws — by name, on both sides — when nothing matches (listing the
 * reference's joints and every known rig) or when several match. The empty
 * report a previous global-table world produced for the dragon must not be
 * reachable.
 */
export function detectRig(jointNames: Iterable<string>): RigDef {
  const present = new Set(jointNames);
  const matches = RIGS.filter((rig) => {
    for (const j of requiredJoints(rig)) if (!present.has(j)) return false;
    return true;
  });
  if (matches.length === 1) return matches[0]!;
  const names = [...present].sort();
  const listing = names.length > 12
    ? `${names.slice(0, 12).join(', ')}, … (${names.length} joints)`
    : names.join(', ');
  if (matches.length === 0) {
    throw new Error(
      `no known rig matches this reference's joints: ${listing}. ` +
      `Known rigs: ${RIGS.map((r) => r.name).join(', ')} — a rig matches only when every joint its table names is present. ` +
      'To measure this reference, add its rig table to ref-align.ts.',
    );
  }
  throw new Error(
    `ambiguous rig: the reference's joints (${listing}) satisfy more than one table: ` +
    `${matches.map((r) => r.name).join(', ')}. Disambiguate with an explicit rig.`,
  );
}

/** Reference joint name -> our bone name, derived from a rig's claims. */
function claimedBy(rig: RigDef): Map<string, string> {
  return new Map(
    Object.entries(rig.boneMap).flatMap(([bone, e]) => e.claims.map((j) => [j, bone] as [string, string])),
  );
}

export interface Grouped {
  /** Our bone name -> the reference positions claimed by it. */
  byBone: Map<string, Vec3[]>;
  /** Reference joint name -> vertex count, for joints no bone claims. */
  unmapped: Map<string, number>;
}

export function groupByBone(skin: RefSkin, rig: RigDef): Grouped {
  const byBone = new Map<string, Vec3[]>();
  const unmapped = new Map<string, number>();
  const claimed = claimedBy(rig);
  for (const v of skin.verts) {
    const bone = claimed.get(v.joint);
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
  // Every bone present in BOTH maps. refBones() only ever emits the rig's
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

/** Reference bone head/tail from joint world positions, via the rig's table. */
export function refBones(jointWorld: Map<string, Vec3>, rig: RigDef): Map<string, { head: Vec3; tail: Vec3 }> {
  const out = new Map<string, { head: Vec3; tail: Vec3 }>();
  for (const [bone, e] of Object.entries(rig.boneMap)) {
    const head = jointWorld.get(e.head), tail = jointWorld.get(e.tail);
    if (head && tail) out.set(bone, { head, tail });
  }
  return out;
}
