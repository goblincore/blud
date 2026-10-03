// src/lab/sdf-zombie/pose.ts
//
// The POSE LAYER's pure half (spec docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md, plan
// docs/superpowers/plans/2026-10-03-goblin-pose-layer.md): hold an authored pose, or play a short keyed clip of them, on any
// character's own skeleton.
//
// A POSE IS BONE ANGLES, written the way the .blob writes them: per bone, an absolute `pitch` and/or `tilt` in degrees
// (`thigh pitch=86`). .blob bone directions are ABSOLUTE, not cumulative down the chain, so a pose is just "replace these bones'
// directions" and the forward kinematics is the engine's own `resolveBones` (head = parent tail + side offset, tail = head +
// dir x length). The Flat look-dev's pose strings are valid keys unchanged.
//
// BLENDING IS IN ANGLE SPACE. Lerping joint POSITIONS between two poses a quarter turn apart shortens a limb by 29% at the
// midpoint (cos 45). Keys interpolate per-bone pitch/tilt and the skeleton is re-resolved every frame (about 35 bones), so every
// limb keeps its length through every blend. pose.test.ts pins it.
//
// A CLIP is a list of timed keys; a held pose is a one-key clip. A bone a key does not mention takes its REST angle, so "sit"
// blends from the standing rest with no extra data. A clip authored elsewhere (a Blender armature exported as the same key list)
// plays unchanged, which keeps the authoring route open.
//
// Pure: plain data in, plain data out, no renderer (port-ready). The wiring (motion.ts `cfg.pose`) only reads the joint
// positions this returns.
import type { BlobBone, BlobDoc } from './blob-ast';
import { compileBlob, dirVector } from './blob-compile';
import { expandMirror } from './mirror';
import { resolveBones } from './resolve';
import { jointForBoneEnd, type GaitJointName } from './gait';
import type { BodyDef, ResolvedBone, Vec3 } from './types';

/** One bone's absolute angles in degrees, like a .blob bone line's `pitch=` and `tilt=`. Absent = the bone's rest value. */
export interface BoneAngle { pitch?: number; tilt?: number }

export interface PoseKey {
  /** Seconds from the clip's start. */
  t: number;
  /** BASE bone names (`thigh`, not `thigh.l`): a mirrored bone takes the angle on both sides, as in the .blob. */
  bones: Record<string, BoneAngle>;
  /** Metres added to the whole skeleton, in the rest frame. x/z only: y is the ground-lock's job (below). */
  root?: { x?: number; z?: number };
  /** Put the lower foot on the rest ground height (default true): sitting lowers the pelvis instead of lifting the feet. */
  groundLock?: boolean;
  /** Easing INTO this key from the previous one. Default 'linear'. */
  ease?: 'linear' | 'smooth';
}

export interface PoseClip { name: string; keys: PoseKey[] }

interface JointSource { bone: string; end: 'head' | 'tail' }

/** Everything per-character the pose math needs, built once: the .blob's own bone definitions, and which bone end each rig point is. */
export interface PoseRig {
  readonly docBones: ReadonlyMap<string, BlobBone>;
  readonly def: BodyDef;
  readonly sources: readonly JointSource[];
  readonly footL: number;
  readonly footR: number;
  /** The rest ground height: the lower foot joint's y at rest. */
  readonly groundY: number;
}

const KEY_EPS = 1e-4;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The rig points' bone ends, matched by joint NAME and then by rest position (the same dedup bindRig and
 *  jointNamesForBody use: a bone's tail and its child's head are one point). */
export function makePoseRig(doc: BlobDoc, names: readonly GaitJointName[], base: readonly Vec3[]): PoseRig {
  const def = compileBlob(doc);
  const expanded = expandMirror({ ...def, prims: [], bonePrims: [] });
  const rest = resolveBones(expanded.bones, expanded.root);
  const sources: JointSource[] = names.map((name, i) => {
    for (const [bone, rb] of rest) {
      for (const end of ['head', 'tail'] as const)
        if (jointForBoneEnd(bone, end) === name && dist(rb[end], base[i]!) < KEY_EPS) return { bone, end };
    }
    throw new Error(`pose rig: no bone end for joint "${name}" at rest (${base[i]!.join(', ')})`);
  });
  const footL = names.indexOf('footL'), footR = names.indexOf('footR');
  if (footL < 0 || footR < 0) throw new Error('pose rig: the body has no foot joints');
  return {
    docBones: new Map(doc.bones.map(b => [b.name, b])),
    def, sources, footL, footR,
    groundY: Math.min(base[footL]![1], base[footR]![1]),
  };
}

const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** The two keys bracketing t and the (eased) fraction between them. One key, or t outside the clip, holds an end. */
function bracket(clip: PoseClip, t: number): { a: PoseKey; b: PoseKey; f: number } {
  const keys = clip.keys;
  if (keys.length === 0) throw new Error(`pose clip "${clip.name}" has no keys`);
  if (t <= keys[0]!.t) return { a: keys[0]!, b: keys[0]!, f: 0 };
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return { a: last, b: last, f: 0 };
  let i = 0;
  while (keys[i + 1]!.t <= t) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const raw = (t - a.t) / (b.t - a.t);
  return { a, b, f: b.ease === 'smooth' ? smooth01(raw) : raw };
}

/**
 * The joint positions of a clip at time t, in RIG-POINT order and the rest world frame (the body at the origin facing +z, y up):
 * `joints[i]` is the target for `rig.points[i]`. Cheap enough for every frame.
 */
export function poseJoints(rig: PoseRig, clip: PoseClip, t: number): Vec3[] {
  const { a, b, f } = bracket(clip, t);
  const angle = (key: PoseKey, bone: BlobBone) => ({
    pitch: key.bones[bone.name]?.pitch ?? bone.pitchDeg,
    tilt: key.bones[bone.name]?.tilt ?? bone.tiltDeg,
  });

  const bones = rig.def.bones.map(db => {
    const doc = rig.docBones.get(db.name);
    if (!doc) return db; // the root bone: always straight up
    const pa = angle(a, doc), pb = angle(b, doc);
    return { ...db, dir: dirVector(doc.dir, lerp(pa.pitch, pb.pitch, f), lerp(pa.tilt, pb.tilt, f)) };
  });

  const rx = lerp(a.root?.x ?? 0, b.root?.x ?? 0, f);
  const rz = lerp(a.root?.z ?? 0, b.root?.z ?? 0, f);
  const expanded = expandMirror({ ...rig.def, bones, prims: [], bonePrims: [] });
  const resolved: Map<string, ResolvedBone> = resolveBones(
    expanded.bones, [expanded.root[0] + rx, expanded.root[1], expanded.root[2] + rz]);

  const joints: Vec3[] = rig.sources.map(s => resolved.get(s.bone)![s.end]);

  // The lock follows whichever key the blend is nearer, so a clip can leave the ground (a jump) and come back.
  const lock = (f < 0.5 ? a : b).groundLock !== false;
  if (!lock) return joints.map(p => [p[0], p[1], p[2]] as Vec3);
  const dy = rig.groundY - Math.min(joints[rig.footL]![1], joints[rig.footR]![1]);
  return joints.map(p => [p[0], p[1] + dy, p[2]] as Vec3);
}
