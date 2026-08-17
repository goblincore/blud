// src/lab/sdf-zombie/hands.ts
//
// First-person SDF hands — pure DATA + tween math (spec §2,
// docs/superpowers/specs/2026-08-16-sdf-lab-fpv-dynamite-design.md).
//
// The hands are SDF FLESH: the same capsule `Primitive` language the zombie
// body is authored in (body.ts), posed in CAMERA-LOCAL space — x right, y up,
// +z toward the scene, camera/eye at the origin, units metres.
//
// ——— What the shapes are modelled on ————————————————————————————————————————
// The game's own first-person dynamite frames (the QAV tile set behind
// public/assets/animations/weapons/dynamite-*.json — tiles 3192 lead hand,
// 3211/3212/3214 lighter hand, 3225 open hand, 3194 bundle) are the authoring
// reference. REFERENCE ONLY: nothing here copies pixels, and no extracted
// asset is imported, shipped, or committed. What those frames show, and what
// this prim set therefore models:
//
//   * A closed FIST, not a mitten. The silhouette that says "hand" is (a) a
//     row of three knuckle-topped finger tubes with visible grooves between
//     them, curling over the grip and down the far side; (b) a fat opposable
//     THUMB laid up and across the grip in three segments, breaking the
//     outline on the inner-near side; (c) a broad flat back-of-hand slab with
//     a heel pad at its base; (d) a clear WRIST taper into (e) a thick
//     forearm running off the bottom of the frame — in the frames the forearm
//     is roughly half the whole silhouette.
//   * The bundle is gripped from below, emerging from the TOP of the fist
//     between the index knuckle and the thumb, tilted in toward screen
//     centre. The lighter rides the same spot on the other fist.
//   * Idle sits high and relaxed; the fuse-burn frames hold the lead hand
//     LOWER and further OUT than idle (a cocked, wound-up hold); the throw
//     whips the hand up-forward until it leaves the frame entirely, fingers
//     opening as it goes (tile 3225 is the open hand on the way back).
//
// Everything is authored in a HAND-LOCAL frame (u along the wrist→knuckle
// axis, w across from pinky to thumb, b out of the back of the hand) so the
// numbers read as anatomy instead of camera coordinates; buildHandPrims maps
// that frame into camera space once, at load.
//
// No rendering here. The wiring marches these as a small camera-anchored
// field: take HAND_PRIMS, add the per-prim transform poseAt returns, fold,
// and run the existing Verlet jiggle (rig.ts) with HAND_JIGGLE. Held props
// (bundle, lighter) ride the pose via HAND_PROPS + propAnchor — see below.
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

// ——— Prim set ——————————————————————————————————————————————————————————————

/** Prim order is part of the interface: poses, jiggle and prop anchors index
 *  it. Eleven prims per hand — the frames' five readable masses (forearm,
 *  wrist, palm+heel, finger row, thumb) split just far enough that the finger
 *  grooves and the thumb's opposition survive at bottom-of-frame scale. */
export const HAND_PRIM_NAMES = [
  'forearm', 'wrist', 'heel', 'palm', 'fingerRoot',
  'finger0', 'finger1', 'finger2',
  'thumbBase', 'thumbMid', 'thumbTip',
] as const;
export type HandPrimName = (typeof HAND_PRIM_NAMES)[number];
export const HAND_PRIM_COUNT = HAND_PRIM_NAMES.length;

/** Index groups the poses act on (a gesture moves masses, not prims). */
export const HAND_PRIM_GROUPS = {
  /** The frame-exiting stub — pinned in the jiggle, lags the hand in a pose. */
  forearm: [0],
  wrist: [1],
  /** Heel + back-of-hand slab + the fused proximal finger mass. */
  mass: [2, 3, 4],
  /** The three curled finger tubes (index → ring/pinky). */
  fingers: [5, 6, 7],
  /** Thenar ball + the two opposable segments. */
  thumb: [8, 9, 10],
} as const satisfies Record<string, readonly number[]>;

// ——— The hand-local frame ————————————————————————————————————————————————

/** An orthonormal hand frame in camera-local axes. */
export interface HandAxes {
  /** Wrist → knuckles (the hand's long axis): up and in toward screen centre. */
  u: Vec3;
  /** Pinky → thumb, across the hand: in, down and toward the camera. */
  w: Vec3;
  /** Out of the BACK of the hand — the face we see, so it points at the eye. */
  b: Vec3;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Seat of the RIGHT (lead) hand, authored against the frames: the grip centre
 * sits in the lower-right of the view about 0.4 m out, the hand tips up and
 * in toward screen centre, and its back faces the eye (we see knuckles and
 * the thumb side, exactly as tile 3192 does).
 */
export const HAND_SEAT = {
  /** Camera-local grip centre — where the bundle passes through the fist. */
  grip: [0.215, -0.205, 0.405] as Vec3,
  /** Wrist → knuckle direction (normalised on use). */
  up: [-0.32, 0.90, 0.29] as Vec3,
  /** Back-of-hand hint (orthogonalised against `up`): toward the eye, tipped
   *  out and up so the knuckle row catches the key light. */
  back: [0.35, 0.28, -0.90] as Vec3,
} as const;

/** Gram-Schmidt the authored hints into an orthonormal frame. */
function seatAxes(up: Vec3, back: Vec3): HandAxes {
  const u = norm(up);
  const d = dot(back, u);
  const b = norm([back[0] - d * u[0], back[1] - d * u[1], back[2] - d * u[2]]);
  return { u, w: norm(cross(u, b)), b };
}

const mirrorAxis = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

/** Per-side hand frames. The left hand is the right hand's x-mirror, so its
 *  axes are the mirrored axes — hand-local pose offsets then read the same
 *  on both sides ("curl the fingers", not "move −x"). */
export const HAND_AXES: Record<'left' | 'right', HandAxes> = (() => {
  const r = seatAxes(HAND_SEAT.up, HAND_SEAT.back);
  return {
    right: r,
    left: { u: mirrorAxis(r.u), w: mirrorAxis(r.w), b: mirrorAxis(r.b) },
  };
})();

/** One authored capsule, in hand-local metres: [alongU, alongW, alongB]. */
interface ShapePrim {
  name: HandPrimName;
  a: Vec3;
  b: Vec3;
  radius: number;
  scale?: Vec3;
  blendK: number;
}

/**
 * The lead hand's masses, authored in the hand frame (see the module header
 * for what each one is doing in the reference frames). Offsets are multiplied
 * by HANDS_TUNING.shape.spread and radii by .girth so the whole hand can be
 * resized without re-authoring anatomy.
 *
 * blendK is the readability lever: the palm masses fuse (0.004–0.005 → a 1.6–2
 * cm smin skirt) while the fingers and thumb tips stay nearly hard
 * (0.0015–0.003) so the grooves between digits survive. The old mitten fused
 * everything at 0.006–0.008 and read as one lump.
 */
const LEAD_SHAPE: readonly ShapePrim[] = [
  // Runs off the bottom of the frame — about half the silhouette, as in 3192.
  { name: 'forearm', a: [-0.150, 0.006, -0.012], b: [-0.400, 0.028, -0.055], radius: 0.047, blendK: 0.005 },
  // The taper. Without it the fist and forearm read as one club.
  { name: 'wrist', a: [-0.142, 0.002, -0.006], b: [-0.098, 0.000, 0.000], radius: 0.034, scale: [1, 1, 0.9], blendK: 0.005 },
  // Hypothenar pad at the base of the palm, pinky side.
  { name: 'heel', a: [-0.082, 0.010, -0.002], b: [-0.076, -0.042, -0.006], radius: 0.032, blendK: 0.004 },
  // Broad flat back-of-hand slab, spanning the hand's width.
  { name: 'palm', a: [-0.030, 0.030, 0.004], b: [-0.040, -0.050, 0.000], radius: 0.040, scale: [1, 1, 0.86], blendK: 0.004 },
  // The fused proximal mass the three finger tubes rise from.
  { name: 'fingerRoot', a: [0.040, 0.046, 0.006], b: [0.026, -0.056, 0.000], radius: 0.031, scale: [1, 1, 0.94], blendK: 0.004 },
  // Curled fingers: knuckle proud of the back, over the top, down the far
  // side. Index is thumb-most (+w) and thickest; the last tube carries
  // ring+pinky together.
  { name: 'finger0', a: [0.064, 0.046, 0.022], b: [0.012, 0.042, -0.042], radius: 0.023, blendK: 0.0015 },
  { name: 'finger1', a: [0.060, 0.008, 0.021], b: [0.008, 0.006, -0.044], radius: 0.022, blendK: 0.0015 },
  { name: 'finger2', a: [0.050, -0.030, 0.017], b: [0.000, -0.030, -0.044], radius: 0.021, blendK: 0.0015 },
  // Thumb: thenar ball, then two segments laid up and across the grip so the
  // pad ends against the index knuckle — the frames' pinch on the bundle.
  { name: 'thumbBase', a: [-0.070, 0.028, 0.010], b: [-0.018, 0.060, 0.018], radius: 0.030, blendK: 0.003 },
  { name: 'thumbMid', a: [-0.012, 0.062, 0.019], b: [0.030, 0.062, 0.016], radius: 0.023, blendK: 0.002 },
  { name: 'thumbTip', a: [0.034, 0.060, 0.015], b: [0.064, 0.042, 0.010], radius: 0.019, blendK: 0.0015 },
];

// ——— Tuning ——————————————————————————————————————————————————————————————————

export const HANDS_TUNING = {
  /** Global framing nudge applied by buildHandPrims (pos shift + uniform size
   *  scale) so the wiring can reseat the hands without editing the tables.
   *  HAND_PRIMS below is baked at these defaults — call buildHandPrims() after
   *  changing them. */
  anchor: { pos: [0, 0, 0] as Vec3, uniform: 1 },
  /** Hand size: `spread` scales the authored hand-local offsets (how big the
   *  hand is), `girth` scales the radii (how chunky the clay is). Tuned so
   *  the fist reads at bottom-of-frame scale without eating the view. */
  shape: { spread: 1.14, girth: 1.10 },
  /** Idle sway: figure-eight bob, x at 1 cycle / period, y at 2 (weapon sway). */
  bob: { periodSec: 0.9, lateralAmpM: 0.014, verticalAmpM: 0.011, forwardAmpM: 0.006 },
  /** Authored splits of fpv's windows: light+cook ≤ fuseMaxSec,
   *  throw+recover == throwRecoverSec (asserted in tests). */
  phaseSec: { light: 0.15, throw: 0.12 },
  /** Per-phase blend-in durations; each must fit inside its phase window
   *  (recover blends across its whole window, derived — see blendSecFor). */
  blendSec: { idle: 0.3, light: 0.1, cook: 0.55, throw: 0.08 },
  /** Idle-bob weight per phase — damped while the hands act, zero mid-throw,
   *  fading back in through recover. Eased with the phase blend. */
  bobWeight: { idle: 1, light: 0.35, cook: 0.15, throw: 0, recover: 1 },
} as const;

/** Phase windows in seconds, derived from fpv's constants (never duplicated). */
export const HAND_PHASE_SEC = {
  light: HANDS_TUNING.phaseSec.light,
  /** Max cook duration = the fuse window minus the light beat. */
  cookMax: DYNAMITE_COOK.fuseMaxSec - HANDS_TUNING.phaseSec.light,
  throw: HANDS_TUNING.phaseSec.throw,
  /** Recover = fpv's cooldown minus the throw beat. */
  recover: FPV_TUNING.throwRecoverSec - HANDS_TUNING.phaseSec.throw,
} as const;

/** Hand-local (u,w,b) offset → camera-local metres, at the shape scale. */
function localToCam(axes: HandAxes, o: Vec3, spread: number = HANDS_TUNING.shape.spread): Vec3 {
  return [
    (axes.u[0] * o[0] + axes.w[0] * o[1] + axes.b[0] * o[2]) * spread,
    (axes.u[1] * o[0] + axes.w[1] * o[1] + axes.b[1] * o[2]) * spread,
    (axes.u[2] * o[0] + axes.w[2] * o[1] + axes.b[2] * o[2]) * spread,
  ];
}

/** x-mirror into the left hand: negate x of both capsule ends, swap cluster. */
function mirrorPrimX(p: Primitive): Primitive {
  return { ...p, a: [-p.a[0], p.a[1], p.a[2]], b: [-p.b[0], p.b[1], p.b[2]], limb: 'armL', cluster: 0 };
}

/** The RIGHT (lead) hand: LEAD_SHAPE mapped out of the hand frame into camera
 *  space around HAND_SEAT.grip. Rest pose == the idle pose. */
function buildLeadHand(): Primitive[] {
  const axes = HAND_AXES.right;
  const g = HAND_SEAT.grip;
  const place = (o: Vec3): Vec3 => {
    const c = localToCam(axes, o);
    return [g[0] + c[0], g[1] + c[1], g[2] + c[2]];
  };
  return LEAD_SHAPE.map(s => ({
    a: place(s.a),
    b: place(s.b),
    radius: s.radius * HANDS_TUNING.shape.girth,
    scale: s.scale ?? [1, 1, 1],
    blendK: s.blendK,
    limb: 'armR' as const,
    cluster: 1,
  }));
}

/** Both hands' rest prims (anchor defaults). left = x-mirror of right. */
export function buildHandPrims(): { left: Primitive[]; right: Primitive[] } {
  const { pos, uniform } = HANDS_TUNING.anchor;
  const seat = (p: Primitive): Primitive => ({
    ...p,
    a: [p.a[0] * uniform + pos[0], p.a[1] * uniform + pos[1], p.a[2] * uniform + pos[2]],
    b: [p.b[0] * uniform + pos[0], p.b[1] * uniform + pos[1], p.b[2] * uniform + pos[2]],
    radius: p.radius * uniform,
  });
  const lead = buildLeadHand();
  return {
    right: lead.map(seat),
    left: lead.map(p => seat(mirrorPrimX(p))),
  };
}

/** Convenience const baked at module load (buildHandPrims() for live tuning). */
export const HAND_PRIMS = buildHandPrims();

// ——— Pose keyframes ————————————————————————————————————————————————————————

export type HandPhase = 'idle' | 'light' | 'cook' | 'throw' | 'recover';

/** Sparse per-prim keyframe entry; absent pos = rest, absent scale = ×1. */
export interface PrimPose {
  /** Camera-local offset from the prim's rest position (m). */
  pos?: Vec3;
  /** Multiplier on the prim's ellipsoid scale (grip swell / extend thin). */
  scale?: Vec3;
}

/** One hand's keyframe — sparse array indexed by HAND_PRIM_NAMES order. */
export type HandKeyframe = readonly (PrimPose | undefined)[];

/** Which pose table each side plays. */
export const HAND_ROLE_OF_SIDE = { left: 'support', right: 'lead' } as const;
export type HandRole = 'lead' | 'support';
/** The side each role is played by (the inverse of HAND_ROLE_OF_SIDE). */
export const HAND_SIDE_OF_ROLE: Record<HandRole, 'left' | 'right'> = {
  lead: 'right', support: 'left',
};

/**
 * A pose authored as ANATOMY rather than as eleven offset vectors: where the
 * arm carries the hand (camera-local `shift`), and what the hand itself does
 * (hand-local flex / curl / press, plus grip swell). expandGesture turns one
 * of these into the dense keyframe the tween consumes, so re-posing is a
 * four-number edit and both roles stay describable in the same words.
 */
export interface HandGesture {
  /** Whole-hand travel in CAMERA-local metres — the arm's contribution. */
  shift?: Vec3;
  /** Fraction of `shift` the forearm stub follows (it lags; 0..1). */
  drag?: number;
  /** Wrist flex — hand-local (u,w,b) offset on everything past the wrist. */
  flex?: Vec3;
  /** Finger curl — hand-local offset on the three finger tubes. */
  curl?: Vec3;
  /** Thumb press — hand-local offset on the three thumb segments. */
  press?: Vec3;
  /** Uniform ellipsoid swell on fingers + thumb (tension / release). */
  swell?: number;
  /** Uniform ellipsoid swell on the palm masses. */
  palmSwell?: number;
}

/**
 * Role-keyed gestures (camera space is NOT mirrored — the hands act
 * differently), authored straight off the game's frames:
 *
 *   idle    both hands low and relaxed; the bundle stands in the LEAD fist.
 *   light   lead lifts the fuse toward the flame; the SUPPORT thumb flicks
 *           the lighter's wheel (tile 3211 vs 3212 is a thumb move, not an
 *           arm move) and the hand rises higher than the lead's.
 *   cook    the fuse-burn frames hold the lead hand LOWER and further OUT
 *           than idle — a cocked, white-knuckle hold. The support hand
 *           stations at the fuse. Grip swells; the verlet jiggle shakes it.
 *   throw   lead whips up-forward-inward past the aim point with the fingers
 *           flying open (tile 3225) — travel is capped by `drag` and by the
 *           forearm's cut end, which must never rise into view. Support
 *           drops down and outward, clear of the throw.
 *   recover target IS idle — the motion is the blend home.
 */
export const HAND_GESTURES: Record<HandRole, Record<HandPhase, HandGesture>> = {
  lead: {
    idle: {},
    light: {
      shift: [-0.045, 0.032, 0.006], drag: 0.5,
      flex: [0.004, 0.006, 0.000], curl: [0.002, 0.000, 0.002],
      press: [0.006, 0.004, 0.002], swell: 1.03,
    },
    cook: {
      shift: [0.012, -0.034, -0.014], drag: 0.6,
      flex: [-0.004, 0.000, 0.006], curl: [0.006, 0.004, 0.004],
      press: [0.008, 0.006, 0.003], swell: 1.10, palmSwell: 1.05,
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
      shift: [0.150, 0.048, 0.030], drag: 0.55,
      flex: [0.006, 0.004, 0.000], curl: [0.003, 0.000, 0.002],
      press: [0.020, 0.010, 0.006], swell: 1.02,
    },
    cook: {
      shift: [0.115, 0.010, 0.020], drag: 0.5,
      flex: [0.002, 0.002, 0.002], curl: [0.004, 0.002, 0.003],
      press: [0.010, 0.006, 0.004], swell: 1.06, palmSwell: 1.02,
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
const addV = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaleV = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const uniform = (s: number): Vec3 => [s, s, s];

/** Expand one gesture into a dense per-prim keyframe for `role`. */
export function expandGesture(role: HandRole, g: HandGesture): HandKeyframe {
  const axes = HAND_AXES[HAND_SIDE_OF_ROLE[role]];
  const shift = g.shift ?? ZERO;
  const drag = g.drag ?? 1;
  const flex = g.flex ? localToCam(axes, g.flex) : ZERO;
  const curl = g.curl ? localToCam(axes, g.curl) : ZERO;
  const press = g.press ? localToCam(axes, g.press) : ZERO;
  const grip = uniform(g.swell ?? 1);
  const palm = uniform(g.palmSwell ?? 1);

  const G = HAND_PRIM_GROUPS;
  const out: PrimPose[] = [];
  for (let i = 0; i < HAND_PRIM_COUNT; i++) {
    // The forearm lags the hand; everything past the wrist also flexes.
    let pos = (G.forearm as readonly number[]).includes(i)
      ? scaleV(shift, drag)
      : shift;
    if (!(G.forearm as readonly number[]).includes(i)
      && !(G.wrist as readonly number[]).includes(i)) pos = addV(pos, flex);
    if ((G.fingers as readonly number[]).includes(i)) pos = addV(pos, curl);
    if ((G.thumb as readonly number[]).includes(i)) pos = addV(pos, press);
    const scale = (G.fingers as readonly number[]).includes(i)
      || (G.thumb as readonly number[]).includes(i)
      ? grip
      : (G.mass as readonly number[]).includes(i) ? palm : uniform(1);
    out.push({ pos, scale });
  }
  return out;
}

/**
 * The expanded pose tables the tween samples — same shape as before (sparse
 * per-prim arrays keyed by role then phase), now GENERATED from HAND_GESTURES
 * so the anatomy stays the single source of truth.
 */
export const HAND_POSES: {
  lead: Record<HandPhase, HandKeyframe>;
  support: Record<HandPhase, HandKeyframe>;
} = {
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

// ——— Held props ———————————————————————————————————————————————————————————

/**
 * Where a held prop rides on a posed hand. The anchor is the mean midpoint of
 * `prims` (so it follows the pose AND the verlet jiggle for free), plus a
 * hand-local offset; `axis` is the prop's up-direction in hand-local terms.
 * Both come back in CAMERA-local space from propAnchor.
 */
export interface PropAnchorSpec {
  role: HandRole;
  /** Prim indices whose capsule midpoints average to the anchor origin. */
  prims: readonly number[];
  /** Offset from that origin, hand-local (u,w,b) metres. */
  offset: Vec3;
  /** The prop's up-axis, hand-local — normalised by propAnchor. */
  axis: Vec3;
}

/**
 * The two props the frames put in the hands.
 *
 * `stick` — the dynamite bundle, gripped in the LEAD fist: it passes through
 * the grip channel between the finger roots and the thumb, standing up and
 * tilted in toward screen centre (the frames tilt it noticeably further in
 * than the hand's own axis, hence the −w lean on `axis`). The offset lifts
 * the bundle's CENTRE clear of the fist so roughly its lower third is
 * swallowed by the grip.
 *
 * `lighter` — the zippo in the SUPPORT fist, standing on top of the index
 * knuckle with the thumb against it, exactly as tiles 3211/3214 hold it.
 * `flameOffset` (below) puts the flame just above its lid.
 */
export const HAND_PROPS = {
  stick: {
    role: 'lead',
    prims: [3, 4, 9],                  // palm, fingerRoot, thumbMid
    offset: [0.0527, 0.0206, -0.0205],
    axis: [0.964, 0.250, -0.087],
  },
  lighter: {
    role: 'support',
    prims: [4, 5, 10],                 // fingerRoot, index finger, thumbTip
    offset: [0.0580, 0.0000, 0.0202],
    axis: [0.900, 0.420, 0.100],
  },
} as const satisfies Record<string, PropAnchorSpec>;

/** Extra tuning the view needs for the props (metres along the prop axis). */
export const HAND_PROP_TUNING = {
  /** Lighter body half-height — the flame sits this far above its origin. */
  flameOffsetM: 0.038,
} as const;

/** A prop's camera-local seat this frame. */
export interface PropAnchor {
  /** Camera-local position of the prop's origin. */
  pos: Vec3;
  /** Camera-local unit up-axis of the prop. */
  axis: Vec3;
}

/**
 * Seat a prop on one hand's POSED prims (camera-local, jiggle included — pass
 * what posedHandPrims returned for that side). Pure: no state, no clock.
 */
export function propAnchor(
  posedSide: readonly Primitive[],
  spec: PropAnchorSpec,
): PropAnchor {
  const axes = HAND_AXES[HAND_SIDE_OF_ROLE[spec.role]];
  let cx = 0, cy = 0, cz = 0, n = 0;
  for (const i of spec.prims) {
    const p = posedSide[i];
    if (!p) continue;
    cx += (p.a[0] + p.b[0]) / 2;
    cy += (p.a[1] + p.b[1]) / 2;
    cz += (p.a[2] + p.b[2]) / 2;
    n++;
  }
  const k = n > 0 ? 1 / n : 0;
  const off = localToCam(axes, spec.offset);
  return {
    pos: [cx * k + off[0], cy * k + off[1], cz * k + off[2]],
    // The axis is a direction, so it takes the frame but NOT the spread scale.
    axis: norm(localToCam(axes, spec.axis, 1)),
  };
}

// ——— Tween ———————————————————————————————————————————————————————————————————

/** A posed prim: rest-space offset (bob included) + ellipsoid scale multiplier. */
export interface HandTransform {
  pos: Vec3;
  scale: Vec3;
}

/** poseAt's result — per-hand per-prim transforms, prim order as authored. */
export interface HandPoseSample {
  left: readonly HandTransform[];
  right: readonly HandTransform[];
  /** Bob weight baked into pos — pass the sample back as `entry` to continue
   *  seamlessly across a variable-exit boundary (early release / overcook). */
  bobWeight: number;
}

/** Canonical blend source of each phase (the previous phase's keyframe).
 *  idle's canonical source is recover (the normal loop); the overcook path
 *  cook → idle is variable-exit — use the `entry` argument there. */
const PREV_PHASE: Record<HandPhase, HandPhase> = {
  idle: 'recover', light: 'idle', cook: 'light', throw: 'cook', recover: 'throw',
};

/** Blend duration of a phase; recover blends across its whole window. */
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
function denseKeyframe(kf: HandKeyframe): HandTransform[] {
  const out: HandTransform[] = [];
  for (let i = 0; i < HAND_PRIM_COUNT; i++) {
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

  const sampleHand = (role: HandRole, entryHand: readonly HandTransform[], entryW: number): HandTransform[] => {
    const tgt = denseKeyframe(HAND_POSES[role][phase]);
    // Source: the captured entry — with its baked-in bob (offset · entryW)
    // stripped back out, so the bob is re-added through the eased weight and
    // poseAt(B, 0, c, entry) === entry exactly — or the canonical previous
    // keyframe.
    const src: readonly HandTransform[] = entry
      ? entryHand.map(tr => ({
          pos: [tr.pos[0] - bob[0] * entryW, tr.pos[1] - bob[1] * entryW, tr.pos[2] - bob[2] * entryW] as Vec3,
          scale: tr.scale,
        }))
      : denseKeyframe(HAND_POSES[role][PREV_PHASE[phase]]);
    const srcW = entry ? entryW : HANDS_TUNING.bobWeight[PREV_PHASE[phase]];
    const w = lerpN(srcW, tgtW, s);

    const out: HandTransform[] = [];
    for (let i = 0; i < HAND_PRIM_COUNT; i++) {
      const pos = lerpV(src[i]!.pos, tgt[i]!.pos, s);
      out.push({
        pos: [pos[0] + bob[0] * w, pos[1] + bob[1] * w, pos[2] + bob[2] * w],
        scale: lerpV(src[i]!.scale, tgt[i]!.scale, s),
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

// ——— fpv cook-state → hand-phase mapping ————————————————————————————————————

/** A hand animation phase plus its phase-local seconds. */
export interface HandPhaseRef {
  phase: HandPhase;
  phaseT: number;
}

/**
 * Map fpv.ts's cook state onto the hand animation phases — the ONLY place
 * the two clocks meet. `now` is fpv's cook clock (the same `now` passed to
 * stepCook); phaseT is seconds since the hand phase began.
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

/** Phases where the bundle is still IN the lead hand (the view parks the
 *  prop at throw — from then on the flight owns it). */
export const STICK_IN_HAND: readonly HandPhase[] = ['idle', 'light', 'cook'];
/** Phases where the lighter's flame is burning (light and the fuse burn). */
export const LIGHTER_LIT: readonly HandPhase[] = ['light', 'cook'];

// ——— Verlet jiggle spec (data for the wiring; rig.ts runs it) ————————————

/** Per-prim jiggle behaviour, ordered like HAND_PRIM_NAMES. */
export interface PrimJiggle {
  /** Rest-pull stiffness for this prim's jiggle point (rig restStiffness share). */
  stiffness: number;
  /** Velocity bleed for this prim (rig damping share), 0..1. */
  damping: number;
  /** Pinned prims never leave the posed rest (the frame-exiting forearm). */
  pinned: boolean;
}

/**
 * The jiggle recipe the wiring feeds into rig.ts: one Verlet point per prim
 * (its capsule midpoint), distance constraints between adjacent prims at
 * linkStiffness, per-prim rest-pull/damping from perPrim, gravity in
 * CAMERA-LOCAL space (softened — hands are near the eye, flesh sags more
 * than it falls). Stiffness falls off outward along the authored order, so
 * the distal flesh (finger tubes, thumb tip) carries the cook-hold wobble
 * while the forearm stub is pinned as the frame anchor.
 */
export const HAND_JIGGLE = {
  gravity: [0, -1.6, 0] as Vec3,
  damping: 0.12,
  iterations: 3,
  restStiffness: 0.18,
  linkStiffness: 0.55,
  perPrim: [
    { stiffness: 1.0, damping: 0.4, pinned: true },     // forearm — frame anchor
    { stiffness: 0.85, damping: 0.35, pinned: false },  // wrist
    { stiffness: 0.7, damping: 0.32, pinned: false },   // heel
    { stiffness: 0.65, damping: 0.3, pinned: false },   // palm
    { stiffness: 0.6, damping: 0.28, pinned: false },   // fingerRoot
    { stiffness: 0.45, damping: 0.22, pinned: false },  // finger0
    { stiffness: 0.44, damping: 0.22, pinned: false },  // finger1
    { stiffness: 0.42, damping: 0.21, pinned: false },  // finger2
    { stiffness: 0.5, damping: 0.26, pinned: false },   // thumbBase
    { stiffness: 0.42, damping: 0.21, pinned: false },  // thumbMid
    { stiffness: 0.4, damping: 0.2, pinned: false },    // thumbTip
  ] as readonly PrimJiggle[],
} as const;
