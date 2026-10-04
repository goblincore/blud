// src/lab/sdf-zombie/webgpu/axe-swing.ts
//
// THE AXE'S SWING (spec docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md §3). Pure: a click edge, the
// button state and dt in; the phase, the pose and the strike events out. Modelled on flail-swing.ts (the same combo
// rules: an explicit click starts a swing from idle, a click in the last bufferSec queues the next, a click within
// comboWindowSec after a swing continues the combo, else it restarts), but its own module: the flail's keys carry a
// chain ball the axe has no use for. Three chops, using the flail's side names:
//   H: the overhead (wind up over the right shoulder, straight down through the crosshair) -- the combo's opener
//   R: right to left, diagonal downward
//   L: left to right, diagonal downward
// Poses are VIEW SPACE (x right, y up, -z forward, eye at the origin): `grip` is the fist on the haft, `rot` the
// haft's XYZ Euler (radians; the haft's +Y is its length, the axe head at its top). The keys are a first cut, tuned in
// Task 7's look step. Joined by a cubic Hermite spline whose interior tangents are the central differences against the
// real neighbouring key times, zero at the two rest ends; at the STRIKE key the tangent is the incoming secant, so the
// axe carries its speed through the hit instead of slowing into it (the flail's lesson, flail-swing.ts STRIKE_BIAS).
import type { Vec3 } from '../types';

export type AxeSide = 'H' | 'R' | 'L';

export const AXE_SWING = {
  /** A click this close to the end of a swing queues the next one. */
  bufferSec: 0.18,
  /** A click within this long after a swing ends continues the combo; later, it restarts at H. */
  comboWindowSec: 0.4,
} as const;

/** Heavier than the flail (0.45 s): a chop winds up. */
export const AXE_TIMING: Readonly<Record<AxeSide, { swingSec: number; strikeT: number }>> = {
  H: { swingSec: 0.7, strikeT: 0.32 },
  R: { swingSec: 0.6, strikeT: 0.27 },
  L: { swingSec: 0.6, strikeT: 0.27 },
};

export interface AxePose { grip: Vec3; rot: Vec3 }
interface Key extends AxePose { t: number }

/** Idle: the fist low right, the haft rising up and a little inward, the head in the lower-right of the frame. */
export const AXE_REST: AxePose = { grip: [0.3, -0.34, -0.45], rot: [-0.25, 0, 0.2] };

const KEYS: Readonly<Record<AxeSide, readonly Key[]>> = {
  H: [
    { t: 0, ...AXE_REST },
    { t: 0.2, grip: [0.16, 0.1, -0.28], rot: [0.95, 0, 0.1] },     // wound up: haft back over the shoulder
    { t: 0.32, grip: [0.04, -0.12, -0.55], rot: [-1.25, 0, 0.05] },  // strike: haft forward, head on the crosshair
    { t: 0.46, grip: [0.02, -0.36, -0.45], rot: [-1.75, 0, 0.05] },  // follow-through: buried low
    { t: 0.7, ...AXE_REST },
  ],
  R: [
    { t: 0, ...AXE_REST },
    { t: 0.17, grip: [0.42, 0.08, -0.3], rot: [0.55, 0, -0.85] },
    { t: 0.27, grip: [0.05, -0.1, -0.55], rot: [-1.0, 0, 0.55] },
    { t: 0.4, grip: [-0.26, -0.3, -0.45], rot: [-1.35, 0, 1.0] },
    { t: 0.6, ...AXE_REST },
  ],
  L: [
    { t: 0, ...AXE_REST },
    { t: 0.17, grip: [-0.14, 0.08, -0.3], rot: [0.55, 0, 0.85] },
    { t: 0.27, grip: [0.05, -0.1, -0.55], rot: [-1.0, 0, -0.55] },
    { t: 0.4, grip: [0.38, -0.3, -0.45], rot: [-1.35, 0, -1.0] },
    { t: 0.6, ...AXE_REST },
  ],
};

/** Each side's key times (the tests read these). */
export function axeKeyTimes(side: AxeSide): number[] { return KEYS[side].map(k => k.t); }

/** The blade's path through the strike frame, view space, unit, from its top end: the cut's direction (axe-strike.ts). */
export const AXE_BLADE_DIR: Readonly<Record<AxeSide, Vec3>> = {
  H: [0, -1, 0],
  R: [-Math.SQRT1_2, -Math.SQRT1_2, 0],
  L: [Math.SQRT1_2, -Math.SQRT1_2, 0],
};

export interface AxeSwing {
  phase: 'idle' | 'swing';
  side: AxeSide;
  /** Seconds into the current swing. */
  t: number;
  struck: boolean;
  queued: boolean;
  nextSide: AxeSide;
  /** Increments at every swing start. */
  swingId: number;
  /** Seconds idle since the last swing ended. */
  idleT: number;
}

export interface AxeInput { click: boolean; held: boolean }

export function makeAxeSwing(): AxeSwing {
  return { phase: 'idle', side: 'H', t: 0, struck: false, queued: false, nextSide: 'H', swingId: 0, idleT: Infinity };
}

const COMBO_NEXT: Readonly<Record<AxeSide, AxeSide>> = { H: 'R', R: 'L', L: 'H' };

function comboSide(s: AxeSwing): AxeSide {
  return s.phase === 'swing' || s.idleT <= AXE_SWING.comboWindowSec ? s.nextSide : 'H';
}

function start(s: AxeSwing, t: number): AxeSwing {
  const side = comboSide(s);
  return { phase: 'swing', side, t, struck: false, queued: false, nextSide: COMBO_NEXT[side], swingId: s.swingId + 1, idleT: 0 };
}

function strikeIfDue(s: AxeSwing, strikes: AxeSide[]): AxeSwing {
  if (s.phase !== 'swing' || s.struck || s.t < AXE_TIMING[s.side].strikeT) return s;
  strikes.push(s.side);
  return { ...s, struck: true };
}

export function stepAxeSwing(s: AxeSwing, input: AxeInput, dt: number): { state: AxeSwing; strikes: AxeSide[] } {
  const strikes: AxeSide[] = [];
  if (!(dt > 0)) return { state: s, strikes };
  let cur: AxeSwing;
  if (s.phase === 'idle') {
    if (!input.click) return { state: { ...s, idleT: s.idleT + dt }, strikes };
    cur = strikeIfDue(start(s, dt), strikes);
  } else {
    const tNext = s.t + dt;
    const queued = s.queued || (input.click && AXE_TIMING[s.side].swingSec - tNext <= AXE_SWING.bufferSec);
    cur = strikeIfDue({ ...s, t: tNext, queued }, strikes);
  }
  if (cur.phase === 'swing' && cur.t >= AXE_TIMING[cur.side].swingSec) {
    const leftover = cur.t - AXE_TIMING[cur.side].swingSec;
    cur = cur.queued || input.held
      ? strikeIfDue(start(cur, leftover), strikes)
      : { ...cur, phase: 'idle', t: 0, queued: false, struck: false, idleT: leftover };
  }
  return { state: cur, strikes };
}

/** Weapon switch, death, blur: back to idle; no strike fires after this. */
export function cancelAxeSwing(s: AxeSwing): AxeSwing {
  return { ...s, phase: 'idle', t: 0, struck: false, queued: false, idleT: Infinity };
}

function tangent(keys: readonly Key[], i: number, pick: (k: Key) => Vec3, strikeT: number): Vec3 {
  if (i === 0 || i === keys.length - 1) return [0, 0, 0];
  const prev = pick(keys[i - 1]!), cur = pick(keys[i]!), next = pick(keys[i + 1]!);
  const dtPrev = keys[i]!.t - keys[i - 1]!.t, span = keys[i + 1]!.t - keys[i - 1]!.t;
  const isStrike = keys[i]!.t === strikeT;
  const at = (c: 0 | 1 | 2): number => isStrike ? (cur[c] - prev[c]) / dtPrev : (next[c] - prev[c]) / span;
  return [at(0), at(1), at(2)];
}

function sample(keys: readonly Key[], t: number, pick: (k: Key) => Vec3, strikeT: number): Vec3 {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1]!.t) i++;
  const k0 = keys[i]!, k1 = keys[i + 1]!;
  const h = k1.t - k0.t;
  const u = Math.min(1, Math.max(0, (t - k0.t) / h));
  const p0 = pick(k0), p1 = pick(k1), m0 = tangent(keys, i, pick, strikeT), m1 = tangent(keys, i + 1, pick, strikeT);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const at = (j: 0 | 1 | 2): number => h00 * p0[j] + h10 * h * m0[j] + h01 * p1[j] + h11 * h * m1[j];
  return [at(0), at(1), at(2)];
}

export function axePose(s: AxeSwing): AxePose {
  if (s.phase === 'idle') return AXE_REST;
  const keys = KEYS[s.side], st = AXE_TIMING[s.side].strikeT;
  if (s.t <= 0 || s.t >= AXE_TIMING[s.side].swingSec) return AXE_REST;
  return { grip: sample(keys, s.t, k => k.grip, st), rot: sample(keys, s.t, k => k.rot, st) };
}
