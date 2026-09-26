// src/lab/sdf-zombie/webgpu/censer-swing.ts
//
// THE CENSER'S SWING (spec docs/superpowers/specs/2026-09-26-censer-flail-design.md §3).
// Pure: button state, dt and the weapon's place in the dead zone in; the phase,
// the charge and the HANDLE's pose (view-space metres, relative to its rest) out.
// No Three.js. The head is not here — censer-head.ts swings it off this handle.
//
//   idle → (press) → pending ─(released before holdSec)→ stroke (tap)
//                        └─(held holdSec)→ windup (spin, charge 0→1) ─(release)→ stroke (heavy)
//   stroke → recover → idle
//
// The stroke runs FROM the weapon's side of the dead zone TOWARD the opposite
// side, read at release, so a charged spin can be steered before it lands.
//
// A swing starts only on a fresh press (the rising edge), never merely because
// the button happens to be down — a button held through a cancel or through a
// recover must not auto-restart the swing (see `wasDown`). A fresh press that
// lands in the last `bufferSec` of a recover is remembered (`buffered`) and
// starts the next swing the moment idle is reached, so a quick next tap is
// never silently lost to timing.
//
// strokeDirection's blend is continuous everywhere but one seam: when the
// weapon sits lower-left of centre, inside centreRadius — near the default
// angle's own resting corner — the shortest-way-round choice is ambiguous and
// the blend can approach from either side as the offset crosses it. That is a
// feel question (which side players expect the stroke to lean), not a bug.
//
// A release just past holdSec enters `stroke` with `heavy: true` but
// `charge` ≈ 0: it runs on heavy timings (heavyStrokeSec/heavyRecoverSec) yet
// lands with a near-tap impact (its arc is the tap's shape — shapeOf blends
// by charge). Hit impact should scale with `charge`, never with the `heavy`
// flag alone.
//
// POWER (tuned in the pure model, censer-swing.test.ts "head speed"): the
// handle swings on an arc about a shoulder pivot and brakes at the end so the
// head whips past it; the wind-up chokes up on the chain, whirls the head in
// the stroke plane and pays the chain out so it orbits; the heavy stroke
// carries that orbit into its arc. The handle never exceeds the pop bound
// (3.5 cm per 240 Hz step); all the extra speed is the chain's.

import type { Vec3 } from '../types';
import { FREE_AIM, type AimPoint } from './free-aim';

export const CENSER_SWING = {
  /** Held longer than this, a press becomes a wind-up instead of a tap. */
  holdSec: 0.18,
  /** Seconds of spinning to reach full charge. */
  chargeSec: 1.0,
  tapStrokeSec: 0.22,
  tapRecoverSec: 0.35,
  heavyStrokeSec: 0.28,
  heavyRecoverSec: 0.5,
  /** Dead-zone radius (dead-zone units) inside which the default diagonal takes over. */
  centreRadius: 0.25,
  /** THE ARC. A flail's speed comes from rotation, so a stroke swings the
   *  handle on a circle about a SHOULDER PIVOT — offset from the handle's rest,
   *  view metres: level with the eye plane, 20 cm under the eye, off the right
   *  shoulder — in the plane spanned by the stroke direction and forward (−z).
   *  Angle 0 is straight forward of the pivot (≈ the rest grip); negative is
   *  the weapon's side. The handle is capped by the 3.5 cm-per-240 Hz-step pop
   *  bound (≈ 8.4 m/s); the head outruns it by riding a wider circle, then
   *  whipping past when the arc brakes. */
  arcPivot: [0, -0.035, 0.44] as readonly [number, number, number],
  arcRadius: 0.57,
  /** A tap from rest: a 146° arc. The chain stays REELED IN (reelRest) while
   *  the arc gets the head moving with the hand, and pays out through the
   *  cruise so the head flies out onto the wide circle — paying out first
   *  leaves it slack and costs ~2 m/s (measured). */
  tap: {
    /** Start/end angles of the arc, radians. */
    arc: [(-61 * Math.PI) / 180, (85 * Math.PI) / 180] as readonly [number, number],
    /** Angular speed ramps up over [0, accelEnd], cruises, then brakes to a
     *  stop over the last brakeFrac: the head whips past the stopped hand.
     *  INVARIANT: accelEnd + brakeFrac < 1 for tap AND heavy (arcProgress's
     *  ramp and brake must not overlap, or its progress runs backwards) —
     *  checked at module load, see assertStrokeShape. */
    accelEnd: 0.14,
    brakeFrac: 0.12,
    /** Fraction of the stroke spent blending in from the pose it started at. */
    lead: 0.42,
    /** Stroke fractions over which the chain pays out to full. */
    payout: [0.39, 0.77] as readonly [number, number],
    /** Unused by a tap itself (a tap carries no wind-up circle, carryR = 0);
     *  set equal to heavy's so shapeOf's blend keeps it constant. */
    spinFade: 1,
  },
  /** A full-charge heavy: the head is already orbiting, so a shorter 85° arc,
   *  driven while the wind-up circle carries on under it (spinFade). Partial
   *  charges blend tap → heavy by charge^shapeCurve (shapeOf). */
  heavy: {
    arc: [(-35 * Math.PI) / 180, (50 * Math.PI) / 180] as readonly [number, number],
    accelEnd: 0.13,
    brakeFrac: 0.2,
    lead: 0.58,
    payout: [0, 0.65] as readonly [number, number],
    /** Stroke fraction over which the carried wind-up circle fades out. */
    spinFade: 1,
  },
  shapeCurve: 1.2,
  /** Fraction of a recover the hand holds its follow-through (so the whip
   *  plays out in front) before it returns to rest. */
  recoverHold: 0.48,
  /** THE WIND-UP: the handle rises and goes forward (spinLift, spinFwd) and
   *  circles IN THE STROKE PLANE, turning the way the stroke does, so the head
   *  orbits as a windmill and a release at any phase adds to it. */
  spinLift: 0.13,
  spinFwd: 0.17,
  /** Handle circle radius at charge 0 and at full charge (lerped by charge,
   *  like spinHzMin/Max — the ends of the charge ramp, not bounds: Min may
   *  exceed Max, and currently does, a slightly wider circle to start). */
  spinRadiusMin: 0.24,
  spinRadiusMax: 0.23,
  spinLiftSec: 0.15,
  spinHzMin: 1.2,
  spinHzMax: 2.9,
  /** How fast the spin plane follows the weapon's drift, rad/s (no pops). */
  spinSteer: 5,
  /** CHOKE UP. A small hand circle driven open-loop above the pendulum's
   *  natural frequency settles into a small ANTI-phase wobble (measured ~2 m/s),
   *  never an orbit. So the wind-up first shortens the chain (a reel fraction;
   *  negative = shorter than reelRest) so the head is carried round WITH the
   *  hand, then pays it out over [spinPayoutStart, spinPayoutSec] s: the head
   *  flies out onto a wide in-phase orbit already moving the right way. */
  spinChoke: -0.11,
  spinChokeSec: 0.1,
  spinPayoutStart: 0.11,
  spinPayoutSec: 0.46,
  /** Travel angle of the centred stroke: upper right → lower left. */
  defaultAngle: Math.atan2(-1, -1),
  /** A fresh press landing this close to the end of a recover is remembered
   *  and starts the next swing as soon as idle is reached. */
  bufferSec: 0.12,
  /** REELED IN: at rest the hand has the chain wrapped short, so the head
   *  dangles this far (metres) below the knot, in frame. The chain pays out to
   *  full length for the wind-up and the strokes and reels back in during the
   *  recover (ropeLength). */
  reelRest: 0.17,
  /** GRIP (1/s, censer-head.ts `grip`): from the press until the chain starts
   *  paying out, the hand steadies it — the head's motion relative to the hand
   *  is damped at this rate. Without it the wind-up only formed its orbit from
   *  a head hanging still: pressed while the reeled head was still whirling
   *  from the last stroke (4–5 m/s on the short chain at idle entry — the reel
   *  conserves its spin), the windmill drove it into the anti-phase wobble and
   *  a full charge peaked at 2–5 m/s (measured in game, 4 of 13 strokes). */
  gripHold: 14,
  /** THE WRIST. The scripted hand circle is open-loop, and from a head that
   *  is not hanging still (the last stroke's swing: the reel conserves its
   *  spin, so the reeled head whirls at 4–5 m/s at idle entry) it sometimes
   *  never lifts the head into the orbit — the windmill drives the anti-phase
   *  wobble instead and a FULL charge swings at 2–5 m/s. Measured: 4 of 13
   *  in-game presses; pure model 3% (the overhead windmill 14%, it fights
   *  gravity over the top). A person feels a flagging spin and whips it on; so
   *  once the chain is paying out, the head's speed round the knot, in the
   *  stroke plane, is held up to a FLOOR that rises with the charge
   *  (spinFloor: m/s at charge 0 → 1, reached over spinFloorCharge) at up to
   *  spinFloorAccel m/s² (censer-head.ts `drive`). A floor, never a target: it
   *  only adds speed that is missing. Kept well under the orbit a good spin
   *  reaches (~17 m/s): a floor of 13 also sped up the orbit's slow top, which
   *  shifted its phase and cost the heavy up to 2.6 m/s at some release
   *  phases; at 9 the release-phase spread is 15.8–20.9 (was 15.4–21.2) and
   *  none of 1,280 presses after a previous stroke (5 sides × 8 previous
   *  strokes × 16 gaps × 2 holds, .lab-tmp/windup-sweep.ts) failed to form. */
  spinFloor: [2, 9] as readonly [number, number],
  spinFloorCharge: [0.3, 0.85] as readonly [number, number],
  spinFloorGain: 8,
  spinFloorAccel: 40,
} as const;

export type CenserPhase = 'idle' | 'pending' | 'windup' | 'stroke' | 'recover';

/** A screen-space direction or offset: x right, y up. */
export interface Dir2 { x: number; y: number }

export interface CenserSwing {
  phase: CenserPhase;
  /** Seconds in the current phase. */
  t: number;
  /** 0..1; kept through a heavy stroke, 0 for a tap. */
  charge: number;
  heavy: boolean;
  /** Unit direction of travel of the current (or last) stroke. */
  dir: Dir2;
  /** Wind-up spin angle, radians, in the stroke plane (0 = forward, −π/2 = the weapon's side). */
  spin: number;
  /** The wind-up's plane: a stroke direction that follows strokeDirection(offset) at spinSteer rad/s. */
  spinDir: Dir2;
  /** Increments at every stroke start — the hit ledger's key. */
  strokeId: number;
  /** Handle pose when the stroke started; blended out over the stroke's
   *  shapeOf(s).lead (tap.lead, blending to heavy.lead with charge). */
  from: Vec3;
  /** Rope pay-out (0 = reelRest, 1 = full; negative if released mid choke-up)
   *  when the stroke started; blended out over the stroke's shapeOf(s).payout
   *  window (tap.payout, blending to heavy.payout with charge). */
  fromReel: number;
  /** The wind-up circle carried into a heavy stroke: its radius and rate at
   *  release (0 for a tap). The handle keeps circling, fading out over
   *  shapeOf(s).spinFade, so the head's orbit is not stopped dead by the release. */
  carryR: number;
  carryHz: number;
  /** The button state as of the last step. idle→pending needs the RISING
   *  EDGE (down && !wasDown), not just "down" — otherwise a button held
   *  through a cancel, or held from before a recover finishes, would
   *  auto-restart the swing without an actual new press. */
  wasDown: boolean;
  /** A fresh press landed in the last `bufferSec` of a recover; consumed the
   *  moment idle is reached (see `stepCenserSwing`'s `'recover'` case). */
  buffered: boolean;
}

export interface SwingInput { down: boolean; offset: Dir2 }

const ZERO: Vec3 = [0, 0, 0];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function makeCenserSwing(): CenserSwing {
  const a = CENSER_SWING.defaultAngle;
  return {
    phase: 'idle', t: 0, charge: 0, heavy: false,
    dir: { x: Math.cos(a), y: Math.sin(a) }, spin: 0, spinDir: { x: Math.cos(a), y: Math.sin(a) }, strokeId: 0, from: ZERO, fromReel: 0, carryR: 0, carryHz: 0,
    wasDown: false, buffered: false,
  };
}

/** The weapon's place in the dead zone, ±1 at its edge (the reticle is the weapon's target). */
export function deadzoneOffset(aim: AimPoint): Dir2 {
  const c = (v: number) => Math.min(1, Math.max(-1, v));
  return { x: c(aim.x / FREE_AIM.deadzoneX), y: c(aim.y / FREE_AIM.deadzoneY) };
}

/** Unit travel direction for a stroke released with the weapon at `offset`. */
export function strokeDirection(offset: Dir2): Dir2 {
  const S = CENSER_SWING;
  const m = Math.hypot(offset.x, offset.y);
  let a: number = S.defaultAngle;
  if (m > 1e-9) {
    const away = Math.atan2(-offset.y, -offset.x);
    let d = away - S.defaultAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d));   // shortest way round
    a = S.defaultAngle + d * smooth(0, S.centreRadius, m);
  }
  return { x: Math.cos(a), y: Math.sin(a) };
}

export const strokeSec = (heavy: boolean): number =>
  heavy ? CENSER_SWING.heavyStrokeSec : CENSER_SWING.tapStrokeSec;
export const recoverSec = (heavy: boolean): number =>
  heavy ? CENSER_SWING.heavyRecoverSec : CENSER_SWING.tapRecoverSec;

/** A point `r` out from the origin at `ang` in the plane of `dir` and forward (−z). */
const inPlane = (dir: Dir2, ang: number, r: number): Vec3 =>
  [r * Math.sin(ang) * dir.x, r * Math.sin(ang) * dir.y, -r * Math.cos(ang)];

/** ∫₀ˣ smoothstep = x³ − x⁴/2. */
const smoothInt = (x: number) => x * x * x - (x * x * x * x) / 2;

interface StrokeShape {
  arc: readonly [number, number]; accelEnd: number; brakeFrac: number; lead: number;
  payout: readonly [number, number]; spinFade: number;
}

/** arcProgress needs its ramp [0, accelEnd] and brake [1 - brakeFrac, 1] not
 *  to overlap (and both non-empty); otherwise the cruise length goes negative
 *  and the arc runs backwards. Throws naming the offending shape. Blends of
 *  two valid shapes are valid (the sum is linear in the blend). */
export function assertStrokeShape(name: string, K: StrokeShape): void {
  if (!(K.accelEnd > 0 && K.brakeFrac > 0 && K.accelEnd + K.brakeFrac < 1)) {
    throw new Error(
      `CENSER_SWING.${name}: needs accelEnd > 0, brakeFrac > 0 and accelEnd + brakeFrac < 1 ` +
      `(got accelEnd ${K.accelEnd}, brakeFrac ${K.brakeFrac}) — arcProgress would run backwards`,
    );
  }
}
assertStrokeShape('tap', CENSER_SWING.tap);
assertStrokeShape('heavy', CENSER_SWING.heavy);

/** A stroke's shape: the tap's, blending into the heavy's with charge (a
 *  release just past holdSec swings like a tap; a full charge like a heavy). */
function shapeOf(s: CenserSwing): StrokeShape {
  const T = CENSER_SWING.tap, H = CENSER_SWING.heavy;
  if (!s.heavy) return T;
  const k = Math.pow(s.charge, CENSER_SWING.shapeCurve);
  return {
    arc: [lerp(T.arc[0], H.arc[0], k), lerp(T.arc[1], H.arc[1], k)],
    accelEnd: lerp(T.accelEnd, H.accelEnd, k),
    brakeFrac: lerp(T.brakeFrac, H.brakeFrac, k),
    lead: lerp(T.lead, H.lead, k),
    payout: [lerp(T.payout[0], H.payout[0], k), lerp(T.payout[1], H.payout[1], k)],
    spinFade: lerp(T.spinFade, H.spinFade, k),
  };
}

/** The arc's progress 0..1 at stroke time u: angular speed smoothly ramps up
 *  over [0, accelEnd], cruises, then brakes to zero over the last brakeFrac
 *  (the velocity profile is smoothstepped at both ends, so the pose is C²). */
function arcProgress(u: number, K: StrokeShape): number {
  const a = K.accelEnd, br = K.brakeFrac, b = 1 - br;
  const total = 0.5 * a + (b - a) + 0.5 * br;
  const x = clamp01(u);
  let w: number;
  if (x < a) w = a * smoothInt(x / a);
  else if (x <= b) w = 0.5 * a + (x - a);
  else { const y = (x - b) / br; w = 0.5 * a + (b - a) + br * (y - smoothInt(y)); }
  return w / total;
}

function strokePath(dir: Dir2, K: StrokeShape, u: number): Vec3 {
  const S = CENSER_SWING;
  const [a0, a1] = K.arc;
  const p = inPlane(dir, lerp(a0, a1, arcProgress(u, K)), S.arcRadius);
  return [S.arcPivot[0] + p[0], S.arcPivot[1] + p[1], S.arcPivot[2] + p[2]];
}

const spinRadiusAt = (t: number, charge: number): number =>
  lerp(CENSER_SWING.spinRadiusMin, CENSER_SWING.spinRadiusMax, charge) * smooth(0, CENSER_SWING.spinLiftSec, t);
const spinHzAt = (charge: number): number => lerp(CENSER_SWING.spinHzMin, CENSER_SWING.spinHzMax, charge);

function spinPose(t: number, spin: number, dir: Dir2, charge: number): Vec3 {
  const S = CENSER_SWING;
  const k = smooth(0, S.spinLiftSec, t);
  const p = inPlane(dir, spin, spinRadiusAt(t, charge));
  return [p[0], S.spinLift * k + p[1], -S.spinFwd * k + p[2]];
}

/** The handle's offset from its rest, view-space metres. Continuous across every transition. */
export function handlePose(s: CenserSwing): Vec3 {
  switch (s.phase) {
    case 'idle':
    case 'pending':
      return ZERO;
    case 'windup':
      return spinPose(s.t, s.spin, s.spinDir, s.charge);
    case 'stroke': {
      const u = clamp01(s.t / strokeSec(s.heavy));
      const K = shapeOf(s);
      // The pose the stroke started from, minus the wind-up circle it was on;
      // the arc blends in from there while that circle keeps turning at the
      // release rate and fades out (carryR = 0 for a tap), so a release never
      // stops the orbit dead — whatever its phase, the head keeps its speed and
      // the arc adds to it.
      const c0 = inPlane(s.spinDir, s.spin, s.carryR);
      const centre: Vec3 = [s.from[0] - c0[0], s.from[1] - c0[1], s.from[2] - c0[2]];
      const base = lerp3(centre, strokePath(s.dir, K, u), smooth(0, K.lead, u));
      const c = inPlane(s.spinDir, s.spin + 2 * Math.PI * s.carryHz * s.t,
        s.carryR * (1 - smooth(0, K.spinFade, u)));
      return [base[0] + c[0], base[1] + c[1], base[2] + c[2]];
    }
    case 'recover':
      return lerp3(strokePath(s.dir, shapeOf(s), 1), ZERO, smooth(CENSER_SWING.recoverHold, 1, s.t / recoverSec(s.heavy)));
  }
}

/** How far the chain is paid out: 0 = reeled in (reelRest), 1 = full length.
 *  Goes NEGATIVE (down to spinChoke, −0.11) early in the wind-up, while the
 *  hand chokes up on the chain shorter than reelRest; a release then carries
 *  that negative value into the stroke as fromReel. Continuous across every
 *  transition, like handlePose. */
function reelFrac(s: CenserSwing): number {
  const S = CENSER_SWING;
  switch (s.phase) {
    case 'idle':
    case 'pending':
      return 0;
    case 'windup':
      return S.spinChoke * smooth(0, S.spinChokeSec, s.t)
        + (1 - S.spinChoke) * smooth(S.spinPayoutStart, S.spinPayoutSec, s.t);
    case 'stroke': {
      const [p0, p1] = shapeOf(s).payout;
      return lerp(s.fromReel, 1, smooth(p0, p1, clamp01(s.t / strokeSec(s.heavy))));
    }
    case 'recover':
      // Reeling in during the recover's second half can drag the head back
      // through a body while the hit hook is still live (hitWindow covers the
      // recover). Accepted: the ledger allows one contact per body per stroke,
      // and a head being hauled in is a plausible second scrape.
      return 1 - smooth(0.5, 1, s.t / recoverSec(s.heavy));
  }
}

/** What the hand does to the chain this frame (censer-head.ts HandHold):
 *  GRIP, 1/s — full while the button is down before the swing (pending) and
 *  through the wind-up's choke-up, released as the chain starts paying out;
 *  THE WRIST — during the wind-up, once paying out, a speed floor round the
 *  knot in the stroke plane (CENSER_SWING.spinFloor). Both off otherwise, so a
 *  stroke, its recover and the dangle at rest swing free. `normal` is the
 *  stroke plane's normal in handlePose's frame; the caller turns it into the
 *  world. The spin runs round it right-handed. */
export function handHold(s: CenserSwing): { grip: number; drive: { normal: Vec3; speed: number; gain: number; maxAccel: number } | null } {
  const S = CENSER_SWING;
  switch (s.phase) {
    case 'pending':
      return { grip: S.gripHold, drive: null };
    case 'windup': {
      const grip = S.gripHold * (1 - smooth(S.spinChokeSec, S.spinPayoutStart + 0.04, s.t));
      const speed = lerp(S.spinFloor[0], S.spinFloor[1], smooth(S.spinFloorCharge[0], S.spinFloorCharge[1], s.charge))
        * smooth(S.spinPayoutStart, S.spinPayoutSec, s.t);
      // The plane of spinDir and forward (−z); inPlane() turns from forward
      // toward spinDir, which is right-handed about forward × spinDir.
      const normal: Vec3 = [s.spinDir.y, -s.spinDir.x, 0];
      return { grip, drive: speed > 0 ? { normal, speed, gain: S.spinFloorGain, maxAccel: S.spinFloorAccel } : null };
    }
    default:
      return { grip: 0, drive: null };
  }
}

/** The rope's current length, metres: reelRest at rest, `full` for the wind-up
 *  and strokes. Intentionally EXTRAPOLATES below reelRest when reelFrac is
 *  negative (the wind-up choke-up: ≈ 0.13 m with a 0.55 m chain). */
export function ropeLength(s: CenserSwing, full: number): number {
  return lerp(CENSER_SWING.reelRest, full, reelFrac(s));
}

function beginStroke(s: CenserSwing, heavy: boolean, offset: Dir2, t: number): CenserSwing {
  return {
    ...s, phase: 'stroke', t, heavy, charge: heavy ? s.charge : 0,
    dir: strokeDirection(offset), strokeId: s.strokeId + 1, from: handlePose(s), fromReel: reelFrac(s), buffered: false,
    carryR: s.phase === 'windup' ? spinRadiusAt(s.t, s.charge) : 0,
    carryHz: s.phase === 'windup' ? spinHzAt(s.charge) : 0,
  };
}

/** Rotate unit `from` toward unit `to` by at most `maxRad`. */
function steerToward(from: Dir2, to: Dir2, maxRad: number): Dir2 {
  const a = Math.atan2(from.y, from.x);
  const diff = Math.atan2(to.y, to.x) - a;
  const d = Math.atan2(Math.sin(diff), Math.cos(diff));
  const b = a + Math.max(-maxRad, Math.min(maxRad, d));
  return { x: Math.cos(b), y: Math.sin(b) };
}

/** dt must be > 0 — a non-positive dt (paused, or a bad frame) leaves the state untouched. */
export function stepCenserSwing(s: CenserSwing, input: SwingInput, dt: number): CenserSwing {
  if (dt <= 0) return s;
  const S = CENSER_SWING;
  const d = dt;
  const t = s.t + d;
  let next: CenserSwing;
  switch (s.phase) {
    case 'idle': {
      const pressed = input.down && !s.wasDown;
      // The release that starts this press is treated as landing at the START of
      // this step (not at its end), so the stroke it eventually leads to isn't
      // short-changed by a step's worth of time — see `pending` below.
      next = pressed ? { ...s, phase: 'pending', t: d, charge: 0 } : s;
      break;
    }
    case 'pending':
      next = input.down
        ? (t >= S.holdSec
          ? { ...s, phase: 'windup', t: t - S.holdSec, spin: 0, spinDir: strokeDirection(input.offset) }
          : { ...s, t })
        // Release treated as landing at the start of this step: the stroke
        // starts already `d` seconds in, so tiny steps don't lose time.
        : beginStroke(s, false, input.offset, d);
      break;
    case 'windup': {
      const charge = Math.min(1, t / S.chargeSec);
      const hz = spinHzAt(charge);
      const spun: CenserSwing = {
        ...s, t, charge, spin: s.spin + 2 * Math.PI * hz * d,
        spinDir: steerToward(s.spinDir, strokeDirection(input.offset), S.spinSteer * d),
      };
      next = input.down ? spun : beginStroke(spun, true, input.offset, 0);
      break;
    }
    case 'stroke':
      next = t >= strokeSec(s.heavy) ? { ...s, phase: 'recover', t: t - strokeSec(s.heavy) } : { ...s, t };
      break;
    case 'recover': {
      const dur = recoverSec(s.heavy);
      const pressedNow = input.down && !s.wasDown;
      const buffered = s.buffered || (pressedNow && dur - s.t <= S.bufferSec);
      if (t < dur) {
        next = { ...s, t, buffered };
      } else {
        const leftover = t - dur;
        if (buffered && input.down) {
          // Still held when idle is reached: queue a fresh press, same as idle→pending.
          next = { ...s, phase: 'pending', t: leftover, charge: 0, buffered: false };
        } else if (buffered) {
          // Already released: it was a tap, so go straight to the next stroke.
          next = beginStroke(s, false, input.offset, leftover);
        } else {
          next = { ...s, phase: 'idle', t: 0, charge: 0, heavy: false, buffered: false };
        }
      }
      break;
    }
  }
  return { ...next, wasDown: input.down };
}

/** Hits count during the stroke AND its recover: the head lags the handle, so its
 *  fastest moment often comes after the handle has stopped. */
export function hitWindow(s: CenserSwing): boolean {
  return s.phase === 'stroke' || s.phase === 'recover';
}

/** Weapon switch or death: back to idle; the stroke counter survives so a stale hit ledger never
 *  matches. `wasDown` also survives — a button already held when the censer is cancelled must not
 *  auto-restart a swing the instant it's drawn again; the player has to actually press it. */
export function cancelCenserSwing(s: CenserSwing): CenserSwing {
  return { ...makeCenserSwing(), strokeId: s.strokeId, wasDown: s.wasDown };
}
