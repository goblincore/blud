// src/lab/sdf-zombie/webgpu/flail-swing.ts
//
// THE SPIKE FLAIL'S SWING (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §5–6).
// Pure: a click edge, the button state and dt in; the phase, the pose and the
// strike events out. No Three.js, no physics — two authored swings:
//
//   R: right → left (the forehand)      L: left → right (the backhand)
//
// A click from idle starts the next side. A click in the last bufferSec of a
// swing queues the next one; holding the button chains them. The STRIKE fires
// exactly once per swing, when t crosses strikeT — whatever the step size.
//
// Poses are VIEW SPACE metres (x right, y up, −z forward, eye at the origin):
// `grip` is the fist on the haft, `rot` the haft's XYZ Euler (radians), `ball`
// the ball's centre. Keys are joined by Catmull-Rom so the ball passes through
// the impact key at full speed instead of stopping on it.

import type { Vec3 } from '../types';

export const FLAIL_SWING = {
  swingSec: 0.45,
  /** The strike frame: the ball is at its impact key. */
  strikeT: 0.18,
  /** A click this close to the end of a swing queues the next one. */
  bufferSec: 0.15,
} as const;

export type FlailSide = 'R' | 'L';

export interface FlailPose { grip: Vec3; rot: Vec3; ball: Vec3 }

interface Key extends FlailPose { t: number }

/** Idle: the fist low right, the haft tipped forward, the ball hanging below its tip. */
export const FLAIL_REST: FlailPose = {
  grip: [0.22, -0.3, -0.4],
  rot: [-1.1, 0, 0],
  ball: [0.24, -0.5, -0.55],
};

/** R: wind back up and right, strike across the front, follow through low left. */
const KEYS_R: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.12, grip: [0.32, -0.02, -0.3], rot: [0.3, 0, -0.6], ball: [0.55, 0.25, -0.3] },
  { t: 0.18, grip: [0.05, -0.2, -0.55], rot: [-1.2, 0.6, 0.3], ball: [-0.05, -0.35, -1.15] },
  { t: 0.3, grip: [-0.2, -0.35, -0.45], rot: [-1.4, 1.0, 0.6], ball: [-0.6, -0.6, -0.7] },
  { t: 0.45, ...FLAIL_REST },
];

/** L: wind back across the chest to the left, strike across the front, follow through low right. */
const KEYS_L: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.12, grip: [-0.05, -0.05, -0.3], rot: [0.3, 0, 0.6], ball: [-0.35, 0.2, -0.35] },
  { t: 0.18, grip: [0.12, -0.2, -0.55], rot: [-1.2, -0.6, -0.3], ball: [0.1, -0.35, -1.15] },
  { t: 0.3, grip: [0.35, -0.35, -0.45], rot: [-1.4, -1.0, -0.6], ball: [0.65, -0.55, -0.7] },
  { t: 0.45, ...FLAIL_REST },
];

const KEYS: Readonly<Record<FlailSide, readonly Key[]>> = { R: KEYS_R, L: KEYS_L };

/** The ball at the strike frame, per side (view space). */
export const FLAIL_IMPACT: Readonly<Record<FlailSide, Vec3>> = {
  R: KEYS_R.find(k => k.t === FLAIL_SWING.strikeT)!.ball,
  L: KEYS_L.find(k => k.t === FLAIL_SWING.strikeT)!.ball,
};

export interface FlailSwing {
  phase: 'idle' | 'swing';
  side: FlailSide;
  /** Seconds into the current swing. */
  t: number;
  /** The strike already fired this swing. */
  struck: boolean;
  /** A click landed in the buffer window. */
  queued: boolean;
  /** The side the next swing takes. */
  nextSide: FlailSide;
  /** Increments at every swing start. */
  swingId: number;
}

export interface FlailInput {
  /** A click edge this step (mousedown). */
  click: boolean;
  /** The button is down. */
  held: boolean;
}

export function makeFlailSwing(): FlailSwing {
  return { phase: 'idle', side: 'R', t: 0, struck: false, queued: false, nextSide: 'R', swingId: 0 };
}

const other = (s: FlailSide): FlailSide => (s === 'R' ? 'L' : 'R');

function start(s: FlailSwing, t: number): FlailSwing {
  return {
    phase: 'swing', side: s.nextSide, t, struck: false, queued: false,
    nextSide: other(s.nextSide), swingId: s.swingId + 1,
  };
}

/** Fire the strike if this swing's t has crossed strikeT and it has not yet. */
function strikeIfDue(s: FlailSwing, strikes: FlailSide[]): FlailSwing {
  if (s.phase !== 'swing' || s.struck || s.t < FLAIL_SWING.strikeT) return s;
  strikes.push(s.side);
  return { ...s, struck: true };
}

export function stepFlailSwing(
  s: FlailSwing, input: FlailInput, dt: number,
): { state: FlailSwing; strikes: FlailSide[] } {
  const strikes: FlailSide[] = [];
  if (!(dt > 0)) return { state: s, strikes };
  const S = FLAIL_SWING;
  if (s.phase === 'idle') {
    if (!input.click) return { state: s, strikes };
    return { state: strikeIfDue(start(s, dt), strikes), strikes };
  }
  const queued = s.queued || (input.click && S.swingSec - s.t <= S.bufferSec);
  let next: FlailSwing = strikeIfDue({ ...s, t: s.t + dt, queued }, strikes);
  if (next.t >= S.swingSec) {
    const leftover = next.t - S.swingSec;
    next = next.queued || input.held
      ? strikeIfDue(start(next, leftover), strikes)
      : { ...next, phase: 'idle', t: 0, queued: false, struck: false };
  }
  return { state: next, strikes };
}

/** Weapon switch or death: back to idle; no strike fires after this. */
export function cancelFlailSwing(s: FlailSwing): FlailSwing {
  return { ...s, phase: 'idle', t: 0, struck: false, queued: false };
}

const cr = (p0: number, p1: number, p2: number, p3: number, u: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);

function sample(keys: readonly Key[], t: number, pick: (k: Key) => Vec3): Vec3 {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1]!.t) i++;
  const k1 = keys[i]!, k2 = keys[i + 1]!;
  const k0 = keys[Math.max(0, i - 1)]!, k3 = keys[Math.min(n - 1, i + 2)]!;
  const u = Math.min(1, Math.max(0, (t - k1.t) / (k2.t - k1.t)));
  const a = pick(k0), b = pick(k1), c = pick(k2), d = pick(k3);
  return [cr(a[0], b[0], c[0], d[0], u), cr(a[1], b[1], c[1], d[1], u), cr(a[2], b[2], c[2], d[2], u)];
}

export function flailPose(s: FlailSwing): FlailPose {
  if (s.phase === 'idle') return FLAIL_REST;
  const keys = KEYS[s.side];
  return {
    grip: sample(keys, s.t, k => k.grip),
    rot: sample(keys, s.t, k => k.rot),
    ball: sample(keys, s.t, k => k.ball),
  };
}
