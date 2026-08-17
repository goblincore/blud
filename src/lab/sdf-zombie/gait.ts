// src/lab/sdf-zombie/gait.ts
//
// Procedural shamble — phase-clocked oscillators producing rest-pose TARGET
// offsets for the verlet rig (rig.ts), plus a root translation/bob.
//
// The rig stays the single motion authority: stepRig pulls points toward the
// rest pose every step, so "heavy damping comes free" — this module only
// nudges where the targets are, and the rig integrates toward them. Every
// value here is a PURE function of (GaitState, GaitSkew, dt): no Date.now,
// no Math.random. The clock is state.time, the per-body asymmetry is
// state.seed, so identical inputs produce bit-identical poses (determinism is
// load-bearing — the gait feeds the same solver every frame).
//
// Axes: +x = the body's right, +y = up, +z = the body's forward (the zombie
// is authored facing +z — see body.ts). Offsets are body-local; the wiring
// rotates them into world space by the wander heading (see rotateYaw).
//
// Claymation bias: low stride frequency, a longer stance than swing, and
// seeded per-side asymmetry so left and right steps never mirror exactly —
// it reads hand-posed rather than sinusoidal.
import type { Vec3 } from './types';
import type { BuildResult } from './build-body';

const TAU = Math.PI * 2;
const Z: Vec3 = [0, 0, 0];

/** The two authored arm styles — see GAIT_TUNING.armStyle. */
export type ArmStyle = 'swing' | 'reach';

// ---------------------------------------------------------------------------
// Joint schema — one name per rig point.
// ---------------------------------------------------------------------------

/** One name per rig point, mirroring the zombie's authored bones (body.ts).
 *  Mirrored bones use the `.l`/`.r` suffix convention from mirror.ts. */
export type GaitJointName =
  | 'pelvis' | 'hips' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'handL' | 'handR'
  | 'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'footL' | 'footR';

/** The 17 joints in rig-point order. bindRig emits points as dedup'd bone
 *  head/tail positions in body.bones iteration order; jointNamesForBody
 *  reproduces that order with names, so `pose.offsets[names[i]]` lines up
 *  with `rig.points[i]`. */
export const GAIT_JOINTS: readonly GaitJointName[] = [
  'pelvis', 'hips', 'chest', 'neck', 'head',
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
  'hipL', 'kneeL', 'hipR', 'kneeR', 'footL', 'footR',
];

/** All gait frequencies and amplitudes in one place — the "motion DNA".
 *  Frequencies are per-stride ratios of the master stride clock so sway/bob
 *  never beat against the steps. */
export const GAIT_TUNING = {
  /** Stride cycles per second — the master clock. Low on purpose (shamble). */
  strideFreq: 1.05,
  /** Hip-sway cycles per stride (0.5 = one sway per stride cycle). */
  swayPerStride: 0.5,
  /** Root-bob beats per stride (2 = one dip per footfall). */
  bobPerStride: 2,
  /** Fraction of a stride spent with the foot on the ground. */
  stanceDuty: 0.62,
  /** Max foot forward reach during swing (m). */
  strideLen: 0.32,
  /** Max foot lift during swing (m). */
  footLift: 0.16,
  /** Foot push-back while planted (m) — the shamble drag. */
  footPush: 0.10,
  /** Knee forward bow during swing (m) — the knee's offset OFF the
   *  hip→ankle line, always toward +z (forward): knees never bend backward
   *  (the "cow standing up" look, owner playtest). */
  kneeBend: 0.09,
  /** Fraction of the foot's forward swing the knee tracks. At full reach
   *  the leg is near-straight, so the knee must ride most of the way to the
   *  foot for the bow (kneeBend) to land on the FORWARD side of the
   *  hip→ankle line — a fixed offset sits BEHIND the line once the foot is
   *  out front (motion-polish task 5). */
  kneeTrack: 0.5,
  /** Knee lift during swing (m). */
  kneeLift: 0.02,
  /** Lateral hip sway amplitude (m). */
  swayAmp: 0.05,
  /** Shoulder counter-rotation as a fraction of hip sway. */
  shoulderSway: 0.55,
  /** Root bob amplitude (m). */
  bobAmp: 0.035,
  /** Forward rock at each footfall (m). */
  rockAmp: 0.02,
  /** Arm swing amplitude (m) — hands opposite the ipsilateral leg. */
  armSwing: 0.09,
  /** Elbow flex during the arm swing (m). */
  elbowFlex: 0.04,
  /** The authored arm style — the wiring may override per body. 'swing' is
   *  the natural counter-swing; 'reach' is the classic zombie mummy-arms
   *  (both arms raised toward the heading, slight bob/sway). Default reach:
   *  it is a zombie. */
  armStyle: 'reach' as ArmStyle,
  /** Reach style: shoulder pivot pitch (rad) — 0 is the authored hang,
   *  π/2 is straight at the horizon. The reach pose is a ROTATION about the
   *  shoulder anchor, never an additive displacement (see GaitPose.reach):
   *  displacing the elbow/hand rest targets shortens both arm segments, the
   *  verlet length constraints win against the soft rest pull, and the
   *  shoulder ball gets dragged out of the torso (owner playtest). ~1.42 rad
   *  reproduces the old pose's hand placement with the chain rigid. */
  reachPitch: 1.42,
  /** Reach style: forearm droop relative to the upper arm (rad) — the arm
   *  reads as a shallow ramp toward the prey, not a locked straight bar. */
  reachElbowDrop: 0.22,
  /** Reach style: shoulder lift (m) — the whole arm rides up a touch. */
  reachShoulderUp: 0.03,
  /** Reach style: vertical bob riding the footfall beat (m). */
  reachBobAmp: 0.035,
  /** Reach style: lateral sway riding the hip-sway beat (m). */
  reachSwayAmp: 0.025,
  /** Head counter-bob as a fraction of the root bob. */
  headBob: 0.5,
  /** Seeded per-side asymmetry magnitude — the claymation "hand-posed" jitter. */
  asymJitter: 0.18,
  /** Missing-arm shoulder droop (m). */
  missingArmDrop: 0.07,
  /** Surviving-arm swing boost when the other arm is missing. */
  missingArmSwingBoost: 1.35,
  /** Wounded-arm swing scale (m). */
  woundedArmSwingScale: 0.6,
  /** Wounded-leg swing scale (foot lifts/reaches less). */
  woundedSwingScale: 0.5,
  /** How much a wounded leg's stance shortens (fraction of the stride). */
  woundedStanceShorten: 0.06,
  /** Wounded-side hip drop (m) — the limping lean. */
  woundedHipDrop: 0.03,
  /** Hop state: stride-frequency multiplier. */
  hopFreqScale: 1.5,
  /** Hop state: root-bob amplitude multiplier. */
  hopBobScale: 1.7,
  /** Hop state: surviving-leg swing multiplier. */
  hopSwingScale: 1.25,
  /** Hop state: lateral sway shrink (hopping stays narrow). */
  hopSwayScale: 0.6,
  /** Hop state: both arms raise this much (m). */
  hopArmsUp: 0.06,
  /** Hop state: lean toward the missing leg (m). */
  hopLean: 0.025,
  /** Damage: root bob shrinks by up to this fraction. */
  damageBobScale: 0.55,
  /** Damage: lateral sway grows by up to this fraction. */
  damageSwayBoost: 0.8,
  /** Damage: foot lift shrinks by up to this fraction — feet drag. */
  damageLiftScale: 0.6,
  /** Damage: forward-back lurch amplitude (m). */
  damageLurchAmp: 0.06,
  /** Damage: lurch wobble frequency (Hz). */
  damageLurchFreq: 0.7,
} as const;

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/** The gait clock. time advances by dt each step; seed is immutable per body
 *  and drives the deterministic per-side asymmetry. */
export interface GaitState {
  /** Accumulated sim time (s). */
  time: number;
  /** Per-body asymmetry seed — any integer; never changes. */
  seed: number;
}

/** Limb health inputs. Absent/false = intact. */
export interface GaitSkew {
  /** Accumulated damage 0..1 — high ⇒ heavier stumble (GAIT_TUNING.damage*). */
  damageMeter: number;
  /** Severed limbs. Exactly one missing leg switches the gait to hop-limp. */
  missing: {
    armL?: boolean;
    armR?: boolean;
    legL?: boolean;
    legR?: boolean;
  };
  /** Wounded (present but hurt) limbs — limp/droop on that side. */
  wounded: {
    armL?: boolean;
    armR?: boolean;
    legL?: boolean;
    legR?: boolean;
  };
}

/**
 * The reach style's per-frame arm pose — a ROTATION SPEC, not offsets.
 * gait.ts owns the animation (pitch/droop/bob/sway as pure clock functions);
 * the wiring (motion.ts) owns the actual pivot, because only it knows the
 * rest arm geometry: each arm rotates about its shoulder rig point by
 * `pitch`, so both segments keep their exact rest lengths and the shoulder
 * ball stays socketed in the torso silhouette — only the distal chain
 * travels. While this is present, the elbow and hand offset entries are ZERO.
 */
export interface ReachPose {
  /** Shoulder pivot pitch per side (rad): 0 = the authored hang,
   *  GAIT_TUNING.reachPitch = full mummy reach, wounded/asymmetry-scaled. */
  pitchL: number;
  pitchR: number;
  /** Forearm droop relative to the upper arm (rad). */
  drop: number;
  /** Rigid bob/sway translation riding the stride beat — applied to the
   *  WHOLE arm (shoulder-relative), so it never changes a segment length. */
  shift: Vec3;
}

/** One frame of gait output — rest-pose TARGET offsets, body-local. */
export interface GaitPose {
  /** Offset for the root (pelvis) rig point — translation, bob, rock, lurch. */
  rootOffset: Vec3;
  /** Offset per joint. Every joint except pelvis is present; zero = no offset.
   *  In 'reach' style the elbow/hand entries are zero — the reach pivot
   *  spec drives them instead. */
  offsets: Record<Exclude<GaitJointName, 'pelvis'>, Vec3>;
  /** The reach-style arm pivot spec — present only when armStyle === 'reach'. */
  reach?: ReachPose;
  /** Normalised stride phase in [0, 1) — 0 = left-foot stance start. */
  phase: number;
  /** Which feet are currently planted. */
  stance: { legL: boolean; legR: boolean };
  /** True while in one-leg hop-limp (exactly one leg missing). */
  hop: boolean;
}

/** stepGait result — new state plus the pose to apply to the rig. */
export interface GaitStep {
  state: GaitState;
  pose: GaitPose;
}

// ---------------------------------------------------------------------------
// Deterministic primitives.
// ---------------------------------------------------------------------------

/** A fresh gait clock at t=0 with the given asymmetry seed. */
export function makeGaitState(seed: number): GaitState {
  return { time: 0, seed: seed >>> 0 };
}

/** Deterministic 32-bit string hash → [0, 1). */
function hash01(seed: number, key: string): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

/** Seeded per-side/per-joint asymmetry in [-1, 1]. */
function asym(seed: number, key: string): number {
  return hash01(seed, key) * 2 - 1;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Splits a leg phase (radians) into stance/swing with progress 0..1 each. */
function stanceProgress(phi: number, duty: number): { stance: boolean; u: number; v: number } {
  let p = (phi % TAU) / TAU;
  if (p < 0) p += 1;
  if (p < duty) return { stance: true, u: 0, v: p / duty };
  const swing = 1 - duty;
  return { stance: false, u: swing <= 0 ? 0 : (p - duty) / swing, v: 0 };
}

// ---------------------------------------------------------------------------
// The gait.
// ---------------------------------------------------------------------------

/**
 * One gait step: advances the clock by dt and produces the rest-pose target
 * pose for that instant. Pure and deterministic — same (state, skew, dt)
 * always yields the same pose.
 *
 * Wiring (task 4): add pose.rootOffset to the pelvis rig point's rest target
 * and pose.offsets[joint] to every other point's, rotated into world space by
 * the body yaw via rotateYaw. The rig integrates toward the targets,
 * so no further smoothing is needed here.
 *
 * `armStyle` selects the arm animation (GAIT_TUNING.armStyle is the default):
 * 'swing' counter-swings the arms against the legs; 'reach' holds both arms
 * raised toward the heading with a slow bob/sway riding the stride clock.
 * The severed/wounded skews apply to both styles — a missing arm gets no
 * offsets either way, a wounded arm swings less or droops in its raise.
 */
export function stepGait(
  state: GaitState, skew: GaitSkew, dt: number,
  armStyle: ArmStyle = GAIT_TUNING.armStyle,
): GaitStep {
  const time = state.time + Math.max(dt, 0);
  const s = state.seed;
  const T = GAIT_TUNING;

  const missingL = !!skew.missing.legL;
  const missingR = !!skew.missing.legR;
  const woundedL = !!skew.wounded.legL;
  const woundedR = !!skew.wounded.legR;
  const missingArmL = !!skew.missing.armL;
  const missingArmR = !!skew.missing.armR;
  const woundedArmL = !!skew.wounded.armL;
  const woundedArmR = !!skew.wounded.armR;
  // Exactly one leg missing ⇒ hop-limp. Both or neither ⇒ regular gait.
  const hop = missingL !== missingR;
  const damage = clamp01(skew.damageMeter);

  // Master clock. Legs alternate π apart; sway/bob/rock derive from the same
  // phase so they never beat against the steps.
  const freq = T.strideFreq * (hop ? T.hopFreqScale : 1);
  const phiL = time * freq * TAU;
  const phiR = phiL + Math.PI;

  // Per-side seeded asymmetry — no two bodies or sides swing identically.
  const aL = 1 + T.asymJitter * asym(s, 'legL');
  const aR = 1 + T.asymJitter * asym(s, 'legR');

  // Root: lateral sway, vertical bob (dips at footfalls), forward rock, and
  // the damage lurch. In hop state the bob beats once per surviving-leg
  // footfall, sways less, and leans toward the missing leg.
  const swayPhase = phiL * T.swayPerStride;
  const swayAmp =
    T.swayAmp *
    (1 + damage * T.damageSwayBoost) *
    (1 + T.asymJitter * asym(s, 'sway')) *
    (hop ? T.hopSwayScale : 1);
  const bobAmp = T.bobAmp * (1 - damage * T.damageBobScale) * (1 + T.asymJitter * asym(s, 'bob'));
  const survivor = missingL ? phiR : phiL;
  const bobCurve = hop ? (1 + Math.cos(survivor)) / 2 : (1 + Math.cos(T.bobPerStride * phiL)) / 2;
  const sway = swayAmp * Math.sin(swayPhase);
  const bob = -bobAmp * (hop ? T.hopBobScale : 1) * bobCurve;
  const rock = T.rockAmp * bobCurve;
  const lurch =
    damage * T.damageLurchAmp * Math.sin(time * T.damageLurchFreq * TAU + asym(s, 'lurch') * Math.PI);
  const hopLean = hop ? (missingL ? -T.hopLean : T.hopLean) : 0;
  const rootOffset: Vec3 = [sway + hopLean, bob, rock + lurch];

  // Per-side stance duty — a wounded leg bears weight for less of the cycle
  // (the healthy side carries the extra). Both wounded ⇒ symmetric again.
  const duty = (side: 'L' | 'R'): number => {
    const w = side === 'L' ? woundedL : woundedR;
    const other = side === 'L' ? woundedR : woundedL;
    if (w && !other) return T.stanceDuty - T.woundedStanceShorten;
    if (!w && other) return T.stanceDuty + T.woundedStanceShorten;
    return T.stanceDuty;
  };
  const isSurvivor = (side: 'L' | 'R'): boolean => (missingL ? side === 'R' : side === 'L');

  // One leg: swing lifts and reaches forward, stance drags back. Missing leg
  // ⇒ no offsets at all (the flesh is gone; the collapsed state owns the body).
  const leg = (phi: number, side: 'L' | 'R'): { foot: Vec3; knee: Vec3; stance: boolean } => {
    const missing = side === 'L' ? missingL : missingR;
    if (missing) return { foot: Z, knee: Z, stance: false };
    const wounded = side === 'L' ? woundedL : woundedR;
    const sideScale =
      (side === 'L' ? aL : aR) *
      (wounded ? T.woundedSwingScale : 1) *
      (hop && isSurvivor(side) ? T.hopSwingScale : 1);
    const { stance: onGround, u, v } = stanceProgress(phi, duty(side));
    const swing = Math.sin(Math.PI * u);
    if (!onGround) {
      const lift = T.footLift * sideScale * (1 - damage * T.damageLiftScale);
      const reach = T.strideLen * sideScale * swing;
      return {
        foot: [0, lift * swing, reach],
        // The knee tracks half the foot's reach PLUS a forward bow, so it
        // stays on the +z (forward) side of the hip→ankle line through the
        // whole swing — a human hinge, never a backward cow knee.
        knee: [0, T.kneeLift * swing, T.kneeTrack * reach + T.kneeBend * sideScale * swing],
        stance: false,
      };
    }
    return { foot: [0, 0, -T.footPush * sideScale * Math.sin(Math.PI * v)], knee: Z, stance: true };
  };

  // One arm. 'swing': the hand swings opposite the ipsilateral leg.
  // 'reach': NO offsets here — the pivot spec (below) drives the arm, so the
  // chain rotates rigidly about the shoulder instead of dragging it out of
  // the torso. Missing arm ⇒ no offsets either way (the shoulder droop below
  // carries the visual); a wounded arm swings less or reaches less high.
  const arm = (legPhi: number, side: 'L' | 'R'): { elbow: Vec3; hand: Vec3 } => {
    const missing = side === 'L' ? missingArmL : missingArmR;
    if (missing) return { elbow: Z, hand: Z };
    const wounded = side === 'L' ? woundedArmL : woundedArmR;
    const aSide = side === 'L' ? aL : aR;
    if (armStyle === 'reach') return { elbow: Z, hand: Z };
    const boost = (side === 'L' ? missingArmR : missingArmL) ? T.missingArmSwingBoost : 1;
    const sideScale = aSide * boost * (wounded ? T.woundedArmSwingScale : 1);
    const swing = Math.sin(Math.PI * stanceProgress(legPhi, duty(side)).u);
    return {
      elbow: [0, T.elbowFlex * 0.4 * sideScale * swing, T.elbowFlex * 0.7 * sideScale * swing],
      hand: [0, 0, -T.armSwing * sideScale * swing],
    };
  };

  const hip = (side: 'L' | 'R'): Vec3 => {
    const missing = side === 'L' ? missingL : missingR;
    const wounded = side === 'L' ? woundedL : woundedR;
    if (missing) return Z;
    return [0.5 * sway * (side === 'L' ? aL : aR), wounded ? -T.woundedHipDrop : 0, 0];
  };

  const shoulder = (side: 'L' | 'R'): Vec3 => {
    const missing = side === 'L' ? missingArmL : missingArmR;
    const droop = missing ? -T.missingArmDrop : 0;
    const armsUp = hop && !missing ? T.hopArmsUp : 0;
    const reachLift = armStyle === 'reach' && !missing ? T.reachShoulderUp : 0;
    return [-sway * T.shoulderSway * (side === 'L' ? aL : aR), droop + armsUp + reachLift, 0];
  };

  // The reach pivot spec: pitch per side (wounded arms reach less, missing
  // arms not at all), a shared forearm droop, and the bob/sway beat as ONE
  // rigid shift for the whole arm.
  let reach: ReachPose | undefined;
  if (armStyle === 'reach') {
    const raiseL = missingArmL ? 0 : (woundedArmL ? T.woundedArmSwingScale : 1) * aL;
    const raiseR = missingArmR ? 0 : (woundedArmR ? T.woundedArmSwingScale : 1) * aR;
    reach = {
      pitchL: T.reachPitch * raiseL,
      pitchR: T.reachPitch * raiseR,
      drop: T.reachElbowDrop,
      shift: [T.reachSwayAmp * Math.sin(swayPhase), -T.reachBobAmp * bobCurve, 0],
    };
  }

  const legA = leg(phiL, 'L');
  const legB = leg(phiR, 'R');
  const armA = arm(phiL, 'L');
  const armB = arm(phiR, 'R');

  const offsets: Record<Exclude<GaitJointName, 'pelvis'>, Vec3> = {
    hips: [sway * 0.9, bob * 0.9, 0],
    chest: [sway * 0.6, bob * 0.6, 0],
    neck: [sway * 0.3, bob * 0.4, 0],
    // The head counter-bobs: it rises as the root dips.
    head: [-sway * 0.2, -bob * T.headBob, 0],
    shoulderL: shoulder('L'),
    shoulderR: shoulder('R'),
    elbowL: armA.elbow,
    elbowR: armB.elbow,
    handL: armA.hand,
    handR: armB.hand,
    hipL: hip('L'),
    hipR: hip('R'),
    kneeL: legA.knee,
    kneeR: legB.knee,
    footL: legA.foot,
    footR: legB.foot,
  };

  let p = (phiL % TAU) / TAU;
  if (p < 0) p += 1;
  return {
    state: { time, seed: s },
    pose: {
      rootOffset,
      offsets,
      reach,
      phase: p,
      stance: { legL: legA.stance, legR: legB.stance },
      hop,
    },
  };
}

// ---------------------------------------------------------------------------
// Body ↔ joint mapping (the wiring contract).
// ---------------------------------------------------------------------------

// Bone-name → joint-name table. Mirrored bones (suffix `.l`/`.r`) map to the
// sided head/tail names; centerline bones stay unsided. Matches body.ts.
// Values use the unsuffixed base names ('shoulder', 'hip', …) that become
// sided once the `.l`/`.r` suffix is applied — see jointForBoneEnd.
const JOINT_AT: Record<string, { head?: string; tail?: string }> = {
  pelvis: { head: 'pelvis', tail: 'hips' },
  spine: { head: 'hips', tail: 'chest' },
  neck: { head: 'chest', tail: 'neck' },
  skull: { head: 'neck', tail: 'head' },
  clavicle: { head: 'chest', tail: 'shoulder' },
  upperArm: { head: 'shoulder', tail: 'elbow' },
  foreArm: { head: 'elbow', tail: 'hand' },
  thigh: { head: 'hip', tail: 'knee' },
  shin: { head: 'knee', tail: 'foot' },
};

/** The joint names that carry a per-side suffix (centerline joints never do). */
const SIDED: ReadonlySet<string> = new Set(['shoulder', 'elbow', 'hand', 'hip', 'knee', 'foot']);

/** Joint name for a resolved bone's head/tail, or null for unknown bones.
 *  e.g. jointForBoneEnd('thigh.l', 'tail') === 'kneeL'. */
export function jointForBoneEnd(bone: string, end: 'head' | 'tail'): GaitJointName | null {
  const dot = bone.lastIndexOf('.');
  const base = dot >= 0 ? bone.slice(0, dot) : bone;
  const side = dot >= 0 ? bone.slice(dot + 1) : '';
  const at = JOINT_AT[base]?.[end];
  if (!at) return null;
  if (side && SIDED.has(at)) return (at + side.toUpperCase()) as GaitJointName;
  return at as GaitJointName;
}

/** Joint names in rig-point order for a built body — the exact zip key for
 *  task-4 wiring: `pose.offsets[names[i]]` (or pose.rootOffset when the name
 *  is 'pelvis') applies to `rig.points[i]`'s rest target. Same iteration and
 *  dedup semantics as bindRig, so the order always matches. */
export function jointNamesForBody(body: BuildResult): GaitJointName[] {
  const names: GaitJointName[] = [];
  const seen = new Set<GaitJointName>();
  for (const [boneName, bone] of body.bones.entries()) {
    for (const end of ['head', 'tail'] as const) {
      const name = jointForBoneEnd(boneName, end);
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

/** Rotates a body-local offset into world space for a given heading (yaw).
 *  heading 0 = facing +z, matching the body authoring (body.ts) and
 *  wander.ts's headingDir. */
export function rotateYaw(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [v[0] * c + v[2] * sin, v[1], -v[0] * sin + v[2] * c];
}
