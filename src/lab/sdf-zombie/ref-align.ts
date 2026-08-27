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
import type { Vec3 } from './types';
import type { RefSkin } from './ref-skin';

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
function side(l: string, r: string) {
  return { l, r };
}

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
  void side;
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
