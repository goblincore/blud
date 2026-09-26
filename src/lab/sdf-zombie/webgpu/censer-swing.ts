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
// lands with a near-tap impact. Hit impact should scale with `charge`, never
// with the `heavy` flag alone.

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
  /** The stroke sweeps from −halfSpan to +halfSpan along its direction, metres. */
  strokeHalfSpan: 0.32,
  /** Forward (−z) bulge at the middle of the stroke, metres. */
  strokeReach: 0.18,
  /** Fraction of the stroke spent blending in from the pose it started at. */
  leadFrac: 0.3,
  /** The wind-up: the handle rises this far and circles at this radius. */
  spinLift: 0.22,
  spinRadius: 0.1,
  spinLiftSec: 0.15,
  spinHzMin: 1.2,
  spinHzMax: 2.6,
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
  /** Fraction of a stroke over which the chain pays out to full length when
   *  the stroke starts reeled in (a tap). Longer than leadFrac: at leadFrac a
   *  tap's 0.38 m pay-out runs just over the 3.5 cm-per-240 Hz-step pop bound. */
  payoutFrac: 0.4,
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
  /** Wind-up spin angle, radians. */
  spin: number;
  /** Increments at every stroke start — the hit ledger's key. */
  strokeId: number;
  /** Handle pose when the stroke started; blended out over leadFrac. */
  from: Vec3;
  /** Rope pay-out (0 = reelRest, 1 = full) when the stroke started; blended out over leadFrac. */
  fromReel: number;
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
    dir: { x: Math.cos(a), y: Math.sin(a) }, spin: 0, strokeId: 0, from: ZERO, fromReel: 0,
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

function strokePath(dir: Dir2, u: number): Vec3 {
  const S = CENSER_SWING;
  const along = lerp(-S.strokeHalfSpan, S.strokeHalfSpan, u);
  return [dir.x * along, dir.y * along, -S.strokeReach * Math.sin(Math.PI * u)];
}

function spinPose(t: number, spin: number): Vec3 {
  const S = CENSER_SWING;
  const k = smooth(0, S.spinLiftSec, t);
  return [S.spinRadius * k * Math.cos(spin), S.spinLift * k, -S.spinRadius * k * Math.sin(spin)];
}

/** The handle's offset from its rest, view-space metres. Continuous across every transition. */
export function handlePose(s: CenserSwing): Vec3 {
  switch (s.phase) {
    case 'idle':
    case 'pending':
      return ZERO;
    case 'windup':
      return spinPose(s.t, s.spin);
    case 'stroke': {
      const u = clamp01(s.t / strokeSec(s.heavy));
      return lerp3(s.from, strokePath(s.dir, smooth(0, 1, u)), smooth(0, CENSER_SWING.leadFrac, u));
    }
    case 'recover':
      return lerp3(strokePath(s.dir, 1), ZERO, smooth(0, 1, s.t / recoverSec(s.heavy)));
  }
}

/** How far the chain is paid out: 0 = reeled in (reelRest), 1 = full length.
 *  Continuous across every transition, like handlePose. */
function reelFrac(s: CenserSwing): number {
  const S = CENSER_SWING;
  switch (s.phase) {
    case 'idle':
    case 'pending':
      return 0;
    case 'windup':
      return smooth(0, S.spinLiftSec, s.t);
    case 'stroke':
      return lerp(s.fromReel, 1, smooth(0, S.payoutFrac, clamp01(s.t / strokeSec(s.heavy))));
    case 'recover':
      return 1 - smooth(0.5, 1, s.t / recoverSec(s.heavy));
  }
}

/** The rope's current length, metres: reelRest at rest, `full` for the wind-up and strokes. */
export function ropeLength(s: CenserSwing, full: number): number {
  return lerp(CENSER_SWING.reelRest, full, reelFrac(s));
}

function beginStroke(s: CenserSwing, heavy: boolean, offset: Dir2, t: number): CenserSwing {
  return {
    ...s, phase: 'stroke', t, heavy, charge: heavy ? s.charge : 0,
    dir: strokeDirection(offset), strokeId: s.strokeId + 1, from: handlePose(s), fromReel: reelFrac(s), buffered: false,
  };
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
        ? (t >= S.holdSec ? { ...s, phase: 'windup', t: t - S.holdSec, spin: 0 } : { ...s, t })
        // Release treated as landing at the start of this step: the stroke
        // starts already `d` seconds in, so tiny steps don't lose time.
        : beginStroke(s, false, input.offset, d);
      break;
    case 'windup': {
      const charge = Math.min(1, t / S.chargeSec);
      const hz = lerp(S.spinHzMin, S.spinHzMax, charge);
      const spun: CenserSwing = { ...s, t, charge, spin: s.spin + 2 * Math.PI * hz * d };
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
