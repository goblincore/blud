// src/lab/sdf-zombie/hands.ts
//
// First-person SDF hands — pure DATA + tween math (spec §2,
// docs/superpowers/specs/2026-08-16-sdf-lab-fpv-dynamite-design.md).
//
// The hands are SDF FLESH: the same capsule `Primitive` language the zombie
// body is authored in (body.ts), posed in CAMERA-LOCAL space — x right, y up,
// +z toward the scene, camera/eye at the origin, units metres.
//
// ═══ THE THREE RULES THIS FILE IS BUILT ON ═══════════════════════════════════
//
// 1. THE HANDS ARE ASYMMETRIC. They are two separately authored prim sets, not
//    one table plus a mirror. They do different jobs: the RIGHT hand is a
//    closed fist round the dynamite bundle; the LEFT hand is a relaxed open
//    hand with a lit CIGARETTE pinched between index and middle finger (the
//    ignition source — bring the ember to the fuse). A mirror could never say
//    that, and the earlier mirrored version read as two identical paws.
//
// 2. THE PROP IS AUTHORED FIRST, THE HAND WRAPS IT. Each held prop is a
//    cylinder with a seat (PROP_SEATS: a grip point on its axis, a unit axis,
//    a radius). Every digit that touches it is then placed BY THAT CYLINDER —
//    wrapCapsule(seat, θ, t, …) puts a capsule's ends at an angle round the
//    axis and a distance along it, at a radius that makes the digit's surface
//    sink `sink` metres INTO the prop. So contact is a construction guarantee,
//    not something eyeballed in camera coordinates. The bundle passes THROUGH
//    the fist mass and is occluded where it enters; the thumb tip locks across
//    its front; the cigarette is pinched with 2 mm of overlap into both
//    fingers. Prop and hand are one unit: the prop's runtime anchor offset is
//    DERIVED (see HAND_PROPS / propAnchor) from the authored seat, so the prop
//    cannot drift away from the fingers that hold it.
//
// 3. GEOMETRY CARRIES SILHOUETTE, TEXTURE CARRIES FEATURES. This is face.ts's
//    hard-won lesson (read its header): the zombie's face is 4 prims plus a
//    projected greyscale sheet, because smin scales k by 4 and smears any
//    feature smaller than ~1.5 cm, and because every prim shares one albedo.
//    Hands have the same problem, so they get the same answer. The prim sets
//    are now SEVEN prims each — enough for a grip silhouette and nothing more
//    — and knuckle creases, tendon lines and nail hints come from a small
//    ORIGINAL height sheet (hands-sheet.ts) projected planar from the
//    back-of-hand direction, reusing the march's existing face-projection
//    path with the hands view's own uniforms. HAND_SHEETS below carries the
//    per-hand projection frame that binding needs.
//
// The reference for all of it is the game's own first-person dynamite frames
// (the QAV tile set behind public/assets/animations/weapons/dynamite-*.json —
// tiles 3192 lead fist + bundle, 3225 open hand). REFERENCE ONLY: no pixels
// are copied, no extracted asset is imported or committed.
//
// The verlet jiggle is UNCHANGED in behaviour — HAND_JIGGLE keeps the same
// gravity, damping, iterations and stiffness ladder; only the per-prim table
// is now per-role, because the two hands no longer have the same prims. The
// bounciness is the part that already worked.
//
// Timing comes from fpv.ts's cook state machine — never a second clock:
// handPhaseFromCook maps CookPhase ('idle'|'cooking'|'cooldown') onto the
// five ANIMATION phases (idle / light / cook / throw / recover):
//
//   idle ──press──► light ──0.15s──► cook ──release──► throw ──0.12s──► recover ──0.28s──► idle
//   (fpv idle)      (fpv cooking)    (fpv cooking)     (fpv cooldown)   (fpv cooldown)
//
// The splits (lightSec, throwSec) are authored here; the window totals are
// fpv's: light + cook ≤ DYNAMITE_COOK.fuseMaxSec, throw + recover ==
// FPV_TUNING.throwRecoverSec (see HAND_PHASE_SEC).
//
// Tween model — every phase is a blend from its canonical source (the
// previous phase's fully-blended keyframe) to its own static keyframe, over
// phase-local seconds, with smoothstep easing (zero slope at both ends: no
// velocity pops). The idle bob is a global oscillator added on top, weighted
// per phase (full sway idle, damped while acting, none mid-throw); the
// weight is eased with the same s so boundaries stay continuous. By
// construction each phase's blend finishes within its window, so sampling
// the previous phase at its window end and the next at t=0 yields the SAME
// pose — asserted in hands.test.ts.
//
// The one state-dependent boundary — cook exits at a VARIABLE time (release
// early / overcook) — is handled by the optional `entry` argument: the wiring
// snapshots poseAt at the transition frame and feeds it back; the next phase
// then blends FROM that captured pose (bob stripped and re-added exactly, so
// poseAt(B, 0, c, entry) === entry, asserted in tests). Canonical 3-arg calls
// stay continuous along the full-charge path.
//
// Determinism: pure functions of their arguments — no Date.now, no
// Math.random, no module state mutated after load. Identical inputs produce
// bit-identical output.
import type { Primitive, Vec3 } from './types';
import { FPV_TUNING, type CookState } from './fpv';
import { DYNAMITE_COOK } from '../../game/gibs/tuning';

// ——— Small vector helpers (local: vec.ts is world-space body maths) ————————

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
/** Component of `v` perpendicular to unit `axis`, normalised. */
function perp(v: Vec3, axis: Vec3): Vec3 {
  const d = dot(v, axis);
  return norm3([v[0] - d * axis[0], v[1] - d * axis[1], v[2] - d * axis[2]]);
}

// ——— 1. The props, authored FIRST ————————————————————————————————————————

/**
 * A held prop, as the geometry the hand has to close around: `grip` is the
 * point ON its axis where the hand closes, `axis` points along the prop
 * (normalised on use), `radius` is its outer radius in metres. Everything the
 * hand does to hold it is expressed against this.
 */
export interface PropSeat {
  grip: Vec3;
  axis: Vec3;
  radius: number;
}

/**
 * The bundle stands in the lower-RIGHT of the view, tilted up and in toward
 * screen centre (the frames tilt it about 30° off vertical); the cigarette
 * rides the lower-LEFT, angled up-inward so its ember leads toward where the
 * fuse will be. Radii match the meshes fpv-view builds: the bundle is four
 * 13 mm sticks fanned on a 14 mm offset (≈30 mm outer), the cigarette 4.5 mm.
 */
export const PROP_SEATS = {
  stick: { grip: [0.215, -0.240, 0.415], axis: [-0.50, 0.84, 0.20], radius: 0.030 },
  cig: { grip: [-0.150, -0.196, 0.395], axis: [0.40, 0.86, -0.30], radius: 0.0045 },
} as const satisfies Record<string, PropSeat>;

/** Mesh lengths the view needs, in metres along each prop's axis from `grip`. */
export const PROP_MESH = {
  /** Bundle: how far it pokes below the grip, and its total length. */
  stick: { below: 0.030, above: 0.120 },
  /** Cigarette: butt below the pinch, paper above it, ember beyond that. */
  cig: { below: 0.026, above: 0.076, emberM: 0.007 },
} as const;

/** A prop's cylindrical frame: axis plus two perpendiculars, E1 toward the eye
 *  (so θ = 0 is the face of the prop the camera sees). */
export interface PropFrame {
  a: Vec3;
  e1: Vec3;
  e2: Vec3;
}

export function propFrame(seat: PropSeat): PropFrame {
  const a = norm3(seat.axis);
  // The eye is at the origin, so −grip points from the prop back at the camera.
  const e1 = perp(mul3(norm3(seat.grip), -1), a);
  return { a, e1, e2: norm3(cross(a, e1)) };
}

/** Point at angle θ (degrees, 0 = facing the eye), `t` along the axis from
 *  `grip`, at distance `r` from the axis. */
export function wrapPoint(seat: PropSeat, thetaDeg: number, t: number, r: number): Vec3 {
  const f = propFrame(seat);
  const th = (thetaDeg * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  return [
    seat.grip[0] + f.a[0] * t + (c * f.e1[0] + s * f.e2[0]) * r,
    seat.grip[1] + f.a[1] * t + (c * f.e1[1] + s * f.e2[1]) * r,
    seat.grip[2] + f.a[2] * t + (c * f.e1[2] + s * f.e2[2]) * r,
  ];
}

/**
 * A capsule wrapped ON the prop: both ends sit at the radius that makes a
 * prim of radius `primR` sink `sink` metres into the prop's surface. This is
 * the whole point of rule 2 — a digit authored this way is in contact by
 * construction, and `sink` is the visual overlap (a few mm reads as flesh
 * pressing into the paper; 0 would read as floating alongside).
 */
export function wrapCapsule(
  seat: PropSeat,
  th1: number, t1: number,
  th2: number, t2: number,
  primR: number, sink: number,
): { a: Vec3; b: Vec3 } {
  const r = seat.radius + primR - sink;
  return { a: wrapPoint(seat, th1, t1, r), b: wrapPoint(seat, th2, t2, r) };
}

/** Distance from a point to a prop's axis (the tangency test's workhorse). */
export function axisDistance(seat: PropSeat, p: Vec3): number {
  const f = propFrame(seat);
  const d = sub3(p, seat.grip);
  const along = dot(d, f.a);
  return Math.hypot(...(sub3(d, mul3(f.a, along)) as [number, number, number]));
}

// ——— 2. Hand frames (anatomy, for poses and for the texture projection) ——

/** An orthonormal hand frame in camera-local axes. */
export interface HandAxes {
  /** Wrist → knuckles: the hand's long axis. */
  u: Vec3;
  /** Across the hand, pinky → thumb. */
  w: Vec3;
  /** Out of the BACK of the hand — the face the eye sees. */
  b: Vec3;
}

function seatAxes(up: Vec3, backHint: Vec3): HandAxes {
  const u = norm3(up);
  const b = perp(backHint, u);
  return { u, w: norm3(cross(u, b)), b };
}

export type HandRole = 'lead' | 'support';
export const HAND_ROLE_OF_SIDE = { left: 'support', right: 'lead' } as const;
export const HAND_SIDE_OF_ROLE: Record<HandRole, 'left' | 'right'> = {
  lead: 'right', support: 'left',
};

/** Each hand's anatomical frame — separately authored, NOT a mirror pair. The
 *  lead fist tips up-inward with its back to the eye; the support hand is
 *  flatter and turned a little further in, presenting the cigarette. */
export const HAND_AXES: Record<HandRole, HandAxes> = {
  lead: seatAxes([-0.30, 0.86, 0.32], [0.40, 0.26, -0.88]),
  support: seatAxes([0.30, 0.86, 0.36], [-0.40, 0.26, -0.88]),
};

// ——— 3. The prim sets ————————————————————————————————————————————————————

/** Prim order is interface: poses, jiggle, prop anchors and sheet framing all
 *  index it. SEVEN prims per hand — silhouette only (rule 3). */
export const LEAD_PRIM_NAMES = [
  'forearm', 'wrist', 'fist', 'knuckles', 'fingerTips', 'thumbBase', 'thumbTip',
] as const;
export const SUPPORT_PRIM_NAMES = [
  'forearm', 'wrist', 'palm', 'index', 'middle', 'ringPinky', 'thumb',
] as const;

export const HAND_PRIM_NAMES: Record<HandRole, readonly string[]> = {
  lead: LEAD_PRIM_NAMES,
  support: SUPPORT_PRIM_NAMES,
};
export const HAND_PRIM_COUNTS: Record<HandRole, number> = {
  lead: LEAD_PRIM_NAMES.length,
  support: SUPPORT_PRIM_NAMES.length,
};

/** Index groups a gesture acts on, per role. */
export const HAND_PRIM_GROUPS: Record<HandRole, {
  forearm: readonly number[]; wrist: readonly number[]; mass: readonly number[];
  digits: readonly number[]; thumb: readonly number[];
}> = {
  lead: { forearm: [0], wrist: [1], mass: [2], digits: [3, 4], thumb: [5, 6] },
  support: { forearm: [0], wrist: [1], mass: [2], digits: [3, 4, 5], thumb: [6] },
};

/** Which prims define each hand's grip on its prop — the anchor rides these,
 *  so the prop follows the pose AND the verlet jiggle. */
export const HAND_GRIP_PRIMS: Record<HandRole, readonly number[]> = {
  lead: [2, 3, 6],      // fist, knuckles, thumb tip
  support: [3, 4],      // index + middle: the pinch itself
};

const cap = (
  a: Vec3, b: Vec3, radius: number, scale: Vec3, blendK: number,
  limb: 'armL' | 'armR', cluster: number,
): Primitive => ({ a, b, radius, scale, blendK, limb, cluster });

/**
 * The LEAD hand: a fist the bundle passes THROUGH.
 *
 * `fist` is one big flattened mass centred ON the bundle axis just under the
 * grip point, so the bundle enters its underside and leaves its top and is
 * occluded in between — that is the fix for "the grip doesn't make any sense".
 * The other four prims exist only to break the fist's outline where the eye
 * reads a hand: a knuckle ridge proud of the near-outer face, a curled
 * fingertip bump on the far-inner face, the thenar ball, and the thumb tip
 * LOCKED ACROSS THE FRONT of the bundle (9 mm of sink — it visibly presses
 * into the paper). Creases, tendons and nails are the sheet's job.
 */
function buildLeadHand(): Primitive[] {
  const S = PROP_SEATS.stick;
  const f = propFrame(S);
  const p = (v: Primitive['a']) => v;
  // Fist centre: on the axis, a touch below the grip point.
  const core = sub3(S.grip, mul3(f.a, 0.014));
  const wrist = wrapPoint(S, -100, -0.052, 0.036);
  const armDir = norm3([0.30, -0.86, -0.18]);
  const armEnd = add3(wrist, mul3(armDir, 0.430));
  const k = wrapCapsule(S, -88, 0.006, -24, 0.024, 0.027, 0.006);
  const tips = wrapCapsule(S, 144, -0.032, 106, 0.008, 0.023, 0.001);
  const tb = wrapCapsule(S, 64, -0.058, 40, -0.020, 0.028, 0.002);
  const tt = wrapCapsule(S, 34, -0.014, -8, 0.022, 0.019, 0.009);
  return [
    cap(add3(wrist, mul3(armDir, 0.010)), armEnd, 0.052, [1, 1, 1], 0.006, 'armR', 1),
    cap(add3(core, mul3(sub3(wrist, core), 0.55)), wrist, 0.038, [1, 1, 0.92], 0.006, 'armR', 1),
    cap(sub3(core, mul3(f.a, 0.014)), add3(core, mul3(f.a, 0.012)), 0.053, [1.02, 1, 0.80], 0.006, 'armR', 1),
    cap(p(k.a), p(k.b), 0.027, [1, 1, 1], 0.0025, 'armR', 1),
    cap(p(tips.a), p(tips.b), 0.023, [1, 1, 1], 0.0025, 'armR', 1),
    cap(p(tb.a), p(tb.b), 0.028, [1, 1, 1], 0.004, 'armR', 1),
    cap(p(tt.a), p(tt.b), 0.019, [1, 1, 1], 0.002, 'armR', 1),
  ];
}

/**
 * The SUPPORT hand: a relaxed OPEN hand, cigarette pinched between index and
 * middle. Nothing here clenches — that is the whole silhouette difference
 * from the fist, and why a mirror could never have served. Index and middle
 * are placed tangent to the cigarette from OPPOSITE sides (θ ≈ ∓85°) each
 * sinking 2 mm in, so the paper seats into both. The ember leads up-inward,
 * ready to meet the fuse on the light beat.
 */
function buildSupportHand(): Primitive[] {
  const C = PROP_SEATS.cig;
  const ax = HAND_AXES.support;
  const G = C.grip;
  const L = (du: number, dw: number, db: number): Vec3 => [
    G[0] + ax.u[0] * du + ax.w[0] * dw + ax.b[0] * db,
    G[1] + ax.u[1] * du + ax.w[1] * dw + ax.b[1] * db,
    G[2] + ax.u[2] * du + ax.w[2] * dw + ax.b[2] * db,
  ];
  const wrist = L(-0.128, 0.010, -0.006);
  const armDir = norm3([-0.28, -0.88, -0.16]);
  const armEnd = add3(wrist, mul3(armDir, 0.430));
  const idx = wrapCapsule(C, -86, -0.026, -74, 0.020, 0.020, 0.002);
  const mid = wrapCapsule(C, 94, -0.026, 106, 0.018, 0.019, 0.002);
  return [
    cap(add3(wrist, mul3(armDir, 0.010)), armEnd, 0.050, [1, 1, 1], 0.006, 'armL', 0),
    cap(L(-0.096, 0.014, -0.002), wrist, 0.036, [1, 1, 0.90], 0.006, 'armL', 0),
    cap(L(-0.086, 0.020, 0.000), L(-0.030, -0.036, 0.004), 0.042, [1, 1, 0.80], 0.006, 'armL', 0),
    cap(idx.a, idx.b, 0.020, [1, 1, 1], 0.0025, 'armL', 0),
    cap(mid.a, mid.b, 0.019, [1, 1, 1], 0.0025, 'armL', 0),
    cap(L(-0.014, -0.050, 0.004), L(0.026, -0.056, -0.032), 0.021, [1, 1, 1], 0.0025, 'armL', 0),
    cap(L(-0.070, 0.044, 0.012), L(-0.006, 0.066, 0.014), 0.027, [1, 1, 1], 0.004, 'armL', 0),
  ];
}

// ——— Tuning ——————————————————————————————————————————————————————————————————

export const HANDS_TUNING = {
  /** Global framing nudge applied by buildHandPrims (pos shift + uniform size
   *  scale) so the wiring can reseat the hands without editing the tables. */
  anchor: { pos: [0, 0, 0] as Vec3, uniform: 1 },
  /** Idle sway: figure-eight bob, x at 1 cycle / period, y at 2 (weapon sway). */
  bob: { periodSec: 0.9, lateralAmpM: 0.014, verticalAmpM: 0.011, forwardAmpM: 0.006 },
  /** Authored splits of fpv's windows: light+cook ≤ fuseMaxSec,
   *  throw+recover == throwRecoverSec (asserted in tests). */
  phaseSec: { light: 0.15, throw: 0.12 },
  /** Per-phase blend-in durations; each must fit inside its phase window. */
  blendSec: { idle: 0.3, light: 0.1, cook: 0.55, throw: 0.08 },
  /** Idle-bob weight per phase — damped while the hands act, zero mid-throw. */
  bobWeight: { idle: 1, light: 0.35, cook: 0.15, throw: 0, recover: 1 },
} as const;

/** Phase windows in seconds, derived from fpv's constants (never duplicated). */
export const HAND_PHASE_SEC = {
  light: HANDS_TUNING.phaseSec.light,
  cookMax: DYNAMITE_COOK.fuseMaxSec - HANDS_TUNING.phaseSec.light,
  throw: HANDS_TUNING.phaseSec.throw,
  recover: FPV_TUNING.throwRecoverSec - HANDS_TUNING.phaseSec.throw,
} as const;

/** Both hands' rest prims. left = support (cigarette), right = lead (bundle) —
 *  separately authored; there is deliberately no mirror step. */
export function buildHandPrims(): { left: Primitive[]; right: Primitive[] } {
  const { pos, uniform: uni } = HANDS_TUNING.anchor;
  const seat = (p: Primitive): Primitive => ({
    ...p,
    a: [p.a[0] * uni + pos[0], p.a[1] * uni + pos[1], p.a[2] * uni + pos[2]],
    b: [p.b[0] * uni + pos[0], p.b[1] * uni + pos[1], p.b[2] * uni + pos[2]],
    radius: p.radius * uni,
  });
  return { right: buildLeadHand().map(seat), left: buildSupportHand().map(seat) };
}

/** Convenience const baked at module load (buildHandPrims() for live tuning). */
export const HAND_PRIMS = buildHandPrims();

// ——— 4. Pose keyframes ————————————————————————————————————————————————————

export type HandPhase = 'idle' | 'light' | 'cook' | 'throw' | 'recover';

/** Sparse per-prim keyframe entry; absent pos = rest, absent scale = ×1. */
export interface PrimPose {
  pos?: Vec3;
  scale?: Vec3;
}

/** One hand's keyframe — sparse array in that role's prim order. */
export type HandKeyframe = readonly (PrimPose | undefined)[];

/**
 * A pose authored as ANATOMY: where the arm carries the hand (camera-local
 * `shift`) and what the hand itself does (hand-local flex / curl / press,
 * plus swell). The prop rides the grip prims, so a gesture moves the hand and
 * its prop as ONE unit — which is the only way "bring the ember to the fuse"
 * can be authored as a single number.
 */
export interface HandGesture {
  shift?: Vec3;
  /** Fraction of `shift` the forearm stub follows (it lags; 0..1). */
  drag?: number;
  /** Wrist flex — hand-local (u,w,b) offset past the wrist. */
  flex?: Vec3;
  /** Digit curl — hand-local offset on the finger prims. */
  curl?: Vec3;
  /** Thumb press — hand-local offset on the thumb prims. */
  press?: Vec3;
  /** Uniform ellipsoid swell on digits + thumb. */
  swell?: number;
  /** Uniform ellipsoid swell on the palm/fist mass. */
  palmSwell?: number;
}

/**
 * Role-keyed gestures, authored off the frames:
 *
 *   idle    lead fist low with the bundle standing in it; support hand low
 *           and relaxed, cigarette burning.
 *   light   the CIGARETTE COMES TO THE FUSE — the support hand makes the big
 *           inward-upward move (its ember has to touch the bundle's tip),
 *           while the lead hand lifts the bundle a little to meet it.
 *   cook    the fuse-burn frames hold the lead hand LOWER and further OUT
 *           than idle — a cocked, white-knuckle hold; the fist swells and
 *           the jiggle shakes it. The support hand draws back off the fuse.
 *   throw   lead whips up-forward with the fingers opening; travel is capped
 *           so the forearm's cut end never rises into view. Support drops
 *           down and outward, clear of the throw.
 *   recover target IS idle — the motion is the blend home.
 */
export const HAND_GESTURES: Record<HandRole, Record<HandPhase, HandGesture>> = {
  lead: {
    idle: {},
    light: {
      shift: [-0.082, 0.052, 0.010], drag: 0.5,
      flex: [0.004, 0.006, 0.000], curl: [0.002, 0.000, 0.002],
      press: [0.005, 0.004, 0.002], swell: 1.03,
    },
    cook: {
      shift: [0.016, -0.034, -0.014], drag: 0.6,
      flex: [-0.004, 0.000, 0.006], curl: [0.005, 0.004, 0.004],
      press: [0.007, 0.006, 0.003], swell: 1.10, palmSwell: 1.05,
    },
    throw: {
      shift: [-0.020, 0.240, 0.130], drag: 0.90,
      flex: [0.010, 0.000, -0.006], curl: [-0.010, 0.006, -0.020],
      press: [-0.008, 0.010, -0.006], swell: 0.94,
    },
    recover: {},
  },
  support: {
    idle: {},
    light: {
      shift: [0.150, 0.030, 0.052], drag: 0.55,
      flex: [0.008, 0.004, 0.000], curl: [0.006, 0.002, 0.002],
      press: [0.004, 0.002, 0.002], swell: 1.02,
    },
    cook: {
      shift: [0.086, 0.006, 0.014], drag: 0.5,
      flex: [0.002, 0.002, 0.002], curl: [0.003, 0.002, 0.002],
      press: [0.002, 0.002, 0.002], swell: 1.02,
    },
    throw: {
      shift: [-0.055, -0.055, -0.025], drag: 0.6,
      curl: [-0.004, 0.000, -0.004], press: [-0.004, 0.002, -0.003],
      swell: 0.97,
    },
    recover: {},
  },
};

const ZERO: Vec3 = [0, 0, 0];
const uniformV = (s: number): Vec3 => [s, s, s];

/** Hand-local (u,w,b) offset → camera-local metres. */
function localToCam(ax: HandAxes, o: Vec3): Vec3 {
  return [
    ax.u[0] * o[0] + ax.w[0] * o[1] + ax.b[0] * o[2],
    ax.u[1] * o[0] + ax.w[1] * o[1] + ax.b[1] * o[2],
    ax.u[2] * o[0] + ax.w[2] * o[1] + ax.b[2] * o[2],
  ];
}

/** Expand one gesture into a dense per-prim keyframe for `role`. */
export function expandGesture(role: HandRole, g: HandGesture): HandKeyframe {
  const ax = HAND_AXES[role];
  const G = HAND_PRIM_GROUPS[role];
  const shift = g.shift ?? ZERO;
  const drag = g.drag ?? 1;
  const flex = g.flex ? localToCam(ax, g.flex) : ZERO;
  const curl = g.curl ? localToCam(ax, g.curl) : ZERO;
  const press = g.press ? localToCam(ax, g.press) : ZERO;
  const grip = uniformV(g.swell ?? 1);
  const palm = uniformV(g.palmSwell ?? 1);
  const has = (grp: readonly number[], i: number): boolean => grp.includes(i);

  const out: PrimPose[] = [];
  for (let i = 0; i < HAND_PRIM_COUNTS[role]; i++) {
    let pos = has(G.forearm, i) ? mul3(shift, drag) : shift;
    if (!has(G.forearm, i) && !has(G.wrist, i)) pos = add3(pos, flex);
    if (has(G.digits, i)) pos = add3(pos, curl);
    if (has(G.thumb, i)) pos = add3(pos, press);
    const scale = has(G.digits, i) || has(G.thumb, i)
      ? grip
      : has(G.mass, i) ? palm : uniformV(1);
    out.push({ pos, scale });
  }
  return out;
}

/** The expanded pose tables the tween samples, generated from HAND_GESTURES. */
export const HAND_POSES: Record<HandRole, Record<HandPhase, HandKeyframe>> = {
  lead: {
    idle: expandGesture('lead', HAND_GESTURES.lead.idle),
    light: expandGesture('lead', HAND_GESTURES.lead.light),
    cook: expandGesture('lead', HAND_GESTURES.lead.cook),
    throw: expandGesture('lead', HAND_GESTURES.lead.throw),
    recover: expandGesture('lead', HAND_GESTURES.lead.recover),
  },
  support: {
    idle: expandGesture('support', HAND_GESTURES.support.idle),
    light: expandGesture('support', HAND_GESTURES.support.light),
    cook: expandGesture('support', HAND_GESTURES.support.cook),
    throw: expandGesture('support', HAND_GESTURES.support.throw),
    recover: expandGesture('support', HAND_GESTURES.support.recover),
  },
};

// ——— 5. Prop anchors: derived from the authored seat ————————————————————

/**
 * How a prop rides its hand. `prims` are the grip prims whose posed midpoints
 * the anchor follows; `offset` is NOT authored — it is DERIVED at load as the
 * vector from those prims' REST mean to the authored seat's grip point. That
 * derivation is rule 2 made mechanical: move a finger and the prop moves with
 * it; there is no second set of numbers to keep in sync.
 */
export interface PropAnchorSpec {
  role: HandRole;
  prims: readonly number[];
  /** Derived: rest-mean → the seat's grip point, camera-local metres. */
  offset: Vec3;
  /** The prop's axis, camera-local unit. */
  axis: Vec3;
  /** The prop's radius (for the tangency tests). */
  radius: number;
}

/** Mean of the given prims' capsule midpoints. */
function primMean(prims: readonly Primitive[], idx: readonly number[]): Vec3 {
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const i of idx) {
    const p = prims[i];
    if (!p) continue;
    cx += (p.a[0] + p.b[0]) / 2;
    cy += (p.a[1] + p.b[1]) / 2;
    cz += (p.a[2] + p.b[2]) / 2;
    n++;
  }
  const k = n > 0 ? 1 / n : 0;
  return [cx * k, cy * k, cz * k];
}

function anchorFor(seat: PropSeat, role: HandRole): PropAnchorSpec {
  const side = HAND_SIDE_OF_ROLE[role];
  const prims = HAND_GRIP_PRIMS[role];
  const mean = primMean(HAND_PRIMS[side], prims);
  return {
    role, prims,
    offset: sub3(seat.grip, mean),
    axis: norm3(seat.axis),
    radius: seat.radius,
  };
}

export const HAND_PROPS: Record<'stick' | 'cig', PropAnchorSpec> = {
  stick: anchorFor(PROP_SEATS.stick, 'lead'),
  cig: anchorFor(PROP_SEATS.cig, 'support'),
};

/** A prop's camera-local seat this frame. */
export interface PropAnchor {
  /** Camera-local position of the prop's GRIP point (its mesh origin). */
  pos: Vec3;
  /** Camera-local unit axis. */
  axis: Vec3;
}

/**
 * Seat a prop on one hand's POSED prims (camera-local, jiggle included — pass
 * what posedHandPrims returned for that side). Pure: no state, no clock. At
 * rest this returns exactly the authored seat, because `offset` was derived
 * from the same rest prims.
 */
export function propAnchor(
  posedSide: readonly Primitive[],
  spec: PropAnchorSpec,
): PropAnchor {
  const mean = primMean(posedSide, spec.prims);
  return { pos: add3(mean, spec.offset), axis: spec.axis };
}

// ——— 6. The hand-detail sheet's projection frame ————————————————————————

/**
 * What the march's face-projection path needs to paint a hands sheet instead
 * of a face (rule 3). The hands view has its OWN uniform set, so binding a
 * different sheet plus a different head-space frame needs no shader change:
 *
 *   headCentre ← the live mean of `prims` (this hand, posed + jiggled)
 *   headQuat   ← the rotation whose columns are (w, u, b) in WORLD axes
 *   headAxes   ← `halfExtent`, so head-space lands in −1..1 over the hand
 *   faceProj   ← 0.5 scale / 0.5 centre, mapping that to uv 0..1
 *
 * The sheet is therefore authored in the hand's own frame: image +x along w
 * (toward the thumb), +y along u (toward the knuckles), viewed down −b.
 */
export interface HandSheetFrame {
  /** Prims whose posed midpoints centre the projection (the hand, not the arm —
   *  including the forearm would drag the centre out of the frame). */
  prims: readonly number[];
  /** Half-extents along (w, u, b) — head-space normaliser. */
  halfExtent: Vec3;
  /** Which sheet in the hands-sheet manifest this hand uses. */
  sheet: 'grip' | 'pinch';
}

export const HAND_SHEETS: Record<HandRole, HandSheetFrame> = {
  // The fist: centred on the fist mass and its digits, a touch generous so the
  // knuckle ridge and thumb stay inside the projection's fade.
  lead: { prims: [2, 3, 4, 5, 6], halfExtent: [0.095, 0.095, 0.075], sheet: 'grip' },
  // The open hand spreads further along its length than the fist does.
  support: { prims: [2, 3, 4, 5, 6], halfExtent: [0.105, 0.105, 0.070], sheet: 'pinch' },
};

// NOTE the w and u half-extents are deliberately EQUAL per hand. The sheets are
// baked through a SQUARE orthographic camera (scripts/bake_hand_detail.py), so
// their content keeps the hand's own aspect with margins around it; projecting
// through unequal extents would stretch the creases off the knuckles they
// belong to. The b extent is free — nothing is projected along it.

/** The live projection frame for one hand: centre + basis, camera-local. */
export interface HandSheetPose {
  centre: Vec3;
  /** Basis columns, camera-local: x = across (w), y = along (u), z = back (b). */
  basis: { x: Vec3; y: Vec3; z: Vec3 };
  halfExtent: Vec3;
}

/** Centre the sheet projection on this hand's posed prims. */
export function handSheetPose(
  posedSide: readonly Primitive[],
  role: HandRole,
): HandSheetPose {
  const f = HAND_SHEETS[role];
  const ax = HAND_AXES[role];
  return {
    centre: primMean(posedSide, f.prims),
    basis: { x: ax.w, y: ax.u, z: ax.b },
    halfExtent: f.halfExtent,
  };
}

// ——— 7. Tween ————————————————————————————————————————————————————————————

/** A posed prim: rest-space offset (bob included) + ellipsoid scale multiplier. */
export interface HandTransform {
  pos: Vec3;
  scale: Vec3;
}

export interface HandPoseSample {
  left: readonly HandTransform[];
  right: readonly HandTransform[];
  /** Bob weight baked into pos — pass the sample back as `entry` to continue
   *  seamlessly across a variable-exit boundary (early release / overcook). */
  bobWeight: number;
}

const PREV_PHASE: Record<HandPhase, HandPhase> = {
  idle: 'recover', light: 'idle', cook: 'light', throw: 'cook', recover: 'throw',
};

function blendSecFor(phase: HandPhase): number {
  if (phase === 'recover') return Math.max(HAND_PHASE_SEC.recover, 1e-3);
  const b = HANDS_TUNING.blendSec[phase];
  return b > 0 ? b : 1;
}

/** Smoothstep ease on [0,1] — zero slope at both ends (no velocity pop). */
export function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Idle bob offset at `bobClock` seconds — figure-eight weapon sway. */
export function bobOffset(bobClock: number): Vec3 {
  const b = HANDS_TUNING.bob;
  const th = (Math.PI * 2 * bobClock) / b.periodSec;
  return [
    b.lateralAmpM * Math.sin(th),
    b.verticalAmpM * Math.sin(2 * th),
    b.forwardAmpM * Math.cos(th),
  ];
}

/** Resolve a sparse keyframe into dense per-prim pos/scale transforms. */
function denseKeyframe(kf: HandKeyframe, count: number): HandTransform[] {
  const out: HandTransform[] = [];
  for (let i = 0; i < count; i++) {
    const e = kf[i];
    out.push({ pos: e?.pos ?? [0, 0, 0], scale: e?.scale ?? [1, 1, 1] });
  }
  return out;
}

const lerpN = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerpN(a[0], b[0], t), lerpN(a[1], b[1], t), lerpN(a[2], b[2], t),
];

/**
 * The hand pose at `phase`-local time `phaseT` seconds (from
 * handPhaseFromCook), with the idle bob evaluated at `bobClock` seconds.
 *
 * `entry` (optional): a previously captured sample — the wiring snapshots
 * poseAt at a transition frame (early release, overcook) and passes it here
 * so the next phase blends FROM the actual pose instead of the canonical
 * exit. The bob baked into `entry` is stripped with the CURRENT bobClock, so
 * capture and resume on the same frame for exactness.
 */
export function poseAt(
  phase: HandPhase,
  phaseT: number,
  bobClock: number,
  entry?: HandPoseSample,
): HandPoseSample {
  const t = Number.isFinite(phaseT) && phaseT > 0 ? phaseT : 0;
  const s = smooth01(t / blendSecFor(phase));
  const bob = bobOffset(bobClock);
  const tgtW = HANDS_TUNING.bobWeight[phase];

  const sampleHand = (
    role: HandRole, entryHand: readonly HandTransform[], entryW: number,
  ): HandTransform[] => {
    const count = HAND_PRIM_COUNTS[role];
    const tgt = denseKeyframe(HAND_POSES[role][phase], count);
    const src: readonly HandTransform[] = entry
      ? entryHand.map(tr => ({
          pos: [tr.pos[0] - bob[0] * entryW, tr.pos[1] - bob[1] * entryW, tr.pos[2] - bob[2] * entryW] as Vec3,
          scale: tr.scale,
        }))
      : denseKeyframe(HAND_POSES[role][PREV_PHASE[phase]], count);
    const srcW = entry ? entryW : HANDS_TUNING.bobWeight[PREV_PHASE[phase]];
    const w = lerpN(srcW, tgtW, s);

    const out: HandTransform[] = [];
    for (let i = 0; i < count; i++) {
      const from = src[i] ?? { pos: ZERO, scale: uniformV(1) };
      const pos = lerpV(from.pos, tgt[i]!.pos, s);
      out.push({
        pos: [pos[0] + bob[0] * w, pos[1] + bob[1] * w, pos[2] + bob[2] * w],
        scale: lerpV(from.scale, tgt[i]!.scale, s),
      });
    }
    return out;
  };

  const entryW = entry?.bobWeight ?? 0;
  return {
    left: sampleHand('support', entry?.left ?? [], entryW),
    right: sampleHand('lead', entry?.right ?? [], entryW),
    bobWeight: entry
      ? lerpN(entryW, tgtW, s)
      : lerpN(HANDS_TUNING.bobWeight[PREV_PHASE[phase]], tgtW, s),
  };
}

// ——— 8. fpv cook-state → hand-phase mapping ——————————————————————————————

export interface HandPhaseRef {
  phase: HandPhase;
  phaseT: number;
}

/**
 * Map fpv.ts's cook state onto the hand animation phases — the ONLY place
 * the two clocks meet.
 *
 *   fpv 'idle'    → idle
 *   fpv 'cooking' → light (first lightSec) → cook (rest, ≤ fuseMaxSec)
 *   fpv 'cooldown'→ throw (first throwSec) → recover (rest, == throwRecoverSec)
 */
export function handPhaseFromCook(cook: CookState, now: number): HandPhaseRef {
  const t = now - cook.phaseAt;
  switch (cook.phase) {
    case 'idle':
      return { phase: 'idle', phaseT: t };
    case 'cooking':
      return t < HAND_PHASE_SEC.light
        ? { phase: 'light', phaseT: t }
        : { phase: 'cook', phaseT: t - HAND_PHASE_SEC.light };
    case 'cooldown':
      return t < HAND_PHASE_SEC.throw
        ? { phase: 'throw', phaseT: t }
        : { phase: 'recover', phaseT: t - HAND_PHASE_SEC.throw };
  }
}

/** Phases where the bundle is still IN the lead hand (the view parks the prop
 *  at throw — from then on the flight owns it). */
export const STICK_IN_HAND: readonly HandPhase[] = ['idle', 'light', 'cook'];
/** Phases where the cigarette's ember flares hot — it is ALWAYS lit (that is
 *  what a lit cigarette is), but it brightens as it meets the fuse and while
 *  the fuse burns. */
export const CIG_EMBER_HOT: readonly HandPhase[] = ['light', 'cook'];

// ——— 9. Verlet jiggle spec (data for the wiring; rig.ts runs it) ————————

/** Per-prim jiggle behaviour, in that role's prim order. */
export interface PrimJiggle {
  stiffness: number;
  damping: number;
  /** Pinned prims never leave the posed rest (the frame-exiting forearm). */
  pinned: boolean;
}

/**
 * The jiggle recipe the wiring feeds into rig.ts — behaviourally IDENTICAL to
 * before (same gravity, damping, iterations, restStiffness, linkStiffness and
 * the same stiffness ladder falling off outward from a pinned forearm). Only
 * the table is now per-role, because the hands no longer share a prim list.
 * The bounciness is the part that already worked; nothing here is retuned.
 */
export const HAND_JIGGLE = {
  gravity: [0, -1.6, 0] as Vec3,
  damping: 0.12,
  iterations: 3,
  restStiffness: 0.18,
  linkStiffness: 0.55,
  perPrim: {
    lead: [
      { stiffness: 1.0, damping: 0.4, pinned: true },     // forearm — anchor
      { stiffness: 0.85, damping: 0.35, pinned: false },  // wrist
      { stiffness: 0.65, damping: 0.3, pinned: false },   // fist
      { stiffness: 0.45, damping: 0.22, pinned: false },  // knuckles
      { stiffness: 0.44, damping: 0.22, pinned: false },  // fingerTips
      { stiffness: 0.5, damping: 0.26, pinned: false },   // thumbBase
      { stiffness: 0.4, damping: 0.2, pinned: false },    // thumbTip
    ] as readonly PrimJiggle[],
    support: [
      { stiffness: 1.0, damping: 0.4, pinned: true },     // forearm — anchor
      { stiffness: 0.85, damping: 0.35, pinned: false },  // wrist
      { stiffness: 0.65, damping: 0.3, pinned: false },   // palm
      { stiffness: 0.45, damping: 0.22, pinned: false },  // index
      { stiffness: 0.44, damping: 0.22, pinned: false },  // middle
      { stiffness: 0.42, damping: 0.21, pinned: false },  // ringPinky
      { stiffness: 0.5, damping: 0.26, pinned: false },   // thumb
    ] as readonly PrimJiggle[],
  },
} as const;

/** The jiggle table for a SIDE (the wiring works in sides, not roles). */
export const HAND_JIGGLE_OF_SIDE: Record<'left' | 'right', readonly PrimJiggle[]> = {
  left: HAND_JIGGLE.perPrim.support,
  right: HAND_JIGGLE.perPrim.lead,
};
