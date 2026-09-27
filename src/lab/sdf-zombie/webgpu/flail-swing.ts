// src/lab/sdf-zombie/webgpu/flail-swing.ts
//
// THE SPIKE FLAIL'S SWING (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §5–6).
// Pure: a click edge, the button state and dt in; the phase, the pose and the
// strike events out. No Three.js, no physics — two authored swings:
//
//   R: right → left (the forehand)      L: left → right (the backhand)
//
// A click from idle starts the next side — holding the button with no click
// edge (e.g. right after a weapon switch leaves it physically held down)
// never starts a swing on its own; idle always waits for an explicit click.
// A click in the last bufferSec of a swing queues the next one, checked
// against the POST-STEP time (t + dt) so a step that lands exactly on the
// boundary still counts; holding the button chains swings. The STRIKE fires
// exactly once per swing, when t crosses strikeT — whatever the step size.
//
// Poses are VIEW SPACE metres (x right, y up, −z forward, eye at the origin):
// `grip` is the fist on the haft, `rot` the haft's XYZ Euler (radians), `ball`
// the ball's centre. Keys are joined by a time-aware cubic Hermite spline
// (each interior key's tangent is the central difference against its real
// neighbouring key times; the two rest ends get a zero tangent, since the
// flail is stationary between swings). Uniform Catmull-Rom ignored the keys'
// uneven spacing (0.12/0.06/0.12/0.15s) and let the ball slow into the strike
// key and then pop on the far side; matching each tangent to the key's actual
// time spacing carries the ball through the strike near full speed instead.

import type { Vec3 } from '../types';

export const FLAIL_SWING = {
  swingSec: 0.45,
  /** The strike frame: the ball is at its impact key. */
  strikeT: 0.18,
  /** A click this close to the end of a swing queues the next one. */
  bufferSec: 0.15,
} as const;

/** The chain, as the renderer (game-flail.ts) draws it. The keys below are
 *  authored so every key's ball is within `maxBallBolt()` of the eye bolt —
 *  flail-swing.test.ts checks it; the renderer clamps the drawn ball there. */
export const FLAIL_CHAIN = {
  /** The eye bolt (flail.glb's ChainAnchor), haft-local +Y, metres — fitted
   *  in game from the probes in docs/dev-notes/2026-09-26-flail/NOTES.md. */
  anchorY: 0.448,
  /** The chain's rest length, metres. */
  len: 0.3,
  /** How far the drawn chain may stretch past `len` before the drawn ball is clamped. */
  stretch: 1.15,
  /** Ball centre → its ring, metres (the chain meets the ring, not the centre). */
  ringOffset: 0.07,
} as const;

/** Furthest the drawn ball's centre may sit from the eye bolt (0.415 m). */
export function maxBallBolt(): number {
  return FLAIL_CHAIN.len * FLAIL_CHAIN.stretch + FLAIL_CHAIN.ringOffset;
}

export type FlailSide = 'R' | 'L';

export interface FlailPose { grip: Vec3; rot: Vec3; ball: Vec3 }

interface Key extends FlailPose { t: number }

/** Idle: the fist just below the frame's lower-right corner, the haft rising
 *  from it up and a little inward, the ball hanging ~0.33 m under the eye bolt
 *  in the lower-right third (measured in game through the fisheye: ball screen
 *  NDC (0.54, −0.71); see docs/dev-notes/2026-09-26-flail/NOTES.md). The first cut (grip 0.22, −0.3,
 *  −0.4; haft tipped −1.1 rad; ball 0.5 m down) hung the ball below the frame. */
export const FLAIL_REST: FlailPose = {
  grip: [0.4, -0.33, -0.5],
  rot: [-0.6, 0, 0.1],
  ball: [0.355, -0.29, -0.75],
};

// Every key keeps the ball within chain reach of the eye bolt (the haft's
// ChainAnchor, 0.448 m up the haft; game-flail.ts clamps the DRAWN ball to
// 0.415 m of it), so the drawn motion follows the authored arc instead of a
// clamped one (between keys the spline can still overrun it briefly: R's
// follow-through reaches 0.49 m near t 0.23 and is clamped for ~4 frames). The
// follow-through ball sits deeper than the strike's (−1.33 vs −1.15) because
// the strike tangent carries the ball forward: a shallower follow-through key
// overshoots the overshoot test's 3 cm. At the strike the haft points at the ball, the chain straight
// out past its tip: the ball leads the hand into the hit. The haft's `rot`
// here is (pitch, 0, lean): the lean tips it inward/outward, the pitch
// forward/back (XYZ Euler of the haft's +Y).

/** R: wind back up and right, strike across the front, follow through low left. */
const KEYS_R: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.1, grip: [0.34, -0.05, -0.35], rot: [0.1, 0, -0.41], ball: [0.7, 0.15, -0.6] },
  { t: 0.18, grip: [0.12, -0.22, -0.46], rot: [-1.76, 0, 0.24], ball: [-0.05, -0.35, -1.15] },
  { t: 0.3, grip: [-0.1, -0.34, -0.61], rot: [-1.89, 0, 0.49], ball: [-0.5, -0.58, -1.33] },
  { t: 0.45, ...FLAIL_REST },
];

/** L: wind back across the chest to the left, strike across the front, follow through low right. */
const KEYS_L: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.1, grip: [-0.02, -0.08, -0.35], rot: [0.1, 0, 0.52], ball: [-0.45, 0.1, -0.6] },
  { t: 0.18, grip: [0.22, -0.22, -0.46], rot: [-1.76, 0, 0.17], ball: [0.1, -0.35, -1.15] },
  { t: 0.3, grip: [0.45, -0.34, -0.61], rot: [-1.89, 0, -0.43], ball: [0.8, -0.58, -1.33] },
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

  let cur: FlailSwing;
  if (s.phase === 'idle') {
    // Idle never advances on a held button alone — only an explicit click starts a swing.
    if (!input.click) return { state: s, strikes };
    cur = strikeIfDue(start(s, dt), strikes);
  } else {
    const tNext = s.t + dt;
    // Buffer check uses the POST-step time, so a step that lands exactly on the boundary counts.
    const queued = s.queued || (input.click && S.swingSec - tNext <= S.bufferSec);
    cur = strikeIfDue({ ...s, t: tNext, queued }, strikes);
  }

  if (cur.phase === 'swing' && cur.t >= S.swingSec) {
    const leftover = cur.t - S.swingSec;
    cur = cur.queued || input.held
      ? strikeIfDue(start(cur, leftover), strikes)
      : { ...cur, phase: 'idle', t: 0, queued: false, struck: false };
  }
  return { state: cur, strikes };
}

/** Weapon switch or death: back to idle; no strike fires after this. */
export function cancelFlailSwing(s: FlailSwing): FlailSwing {
  return { ...s, phase: 'idle', t: 0, struck: false, queued: false };
}

/** How far the strike key's tangent leans past the plain incoming secant (see below). */
const STRIKE_BIAS = 1.25;

/**
 * The tangent (rate of change per second) at key `i`: the central difference
 * against its real neighbouring key times, so unevenly spaced keys don't
 * distort speed. The two rest ends get a zero tangent — the flail is at a
 * dead stop there between swings.
 *
 * The raw central difference is then limited per axis (Fritsch–Carlson): our
 * keys are unevenly spaced (0.1/0.08/0.12/0.15s) with a short middle segment
 * sandwiched between two much longer ones, and a plain central difference
 * there whips the curve — the two neighbouring secants can have very
 * different magnitudes, and an unclipped tangent overshoots position past
 * the key and spikes the ball's speed far above either neighbouring secant.
 * Clamping each axis's tangent to at most 3x the smaller of its two secants
 * keeps the spline from overshooting while still passing through every key
 * at the key's own value.
 *
 * The STRIKE key is the one exception: a plain (even clamped) central
 * difference there averages the fast incoming swing against the slower
 * follow-through and the ball visibly slows into the hit — the exact "ball
 * slows at the strike" bug this rework exists to fix. So at the strike key
 * only, the tangent instead leans on (and, at STRIKE_BIAS > 1, slightly past)
 * the incoming secant `dPrev` — the ball carries the swing's momentum
 * through the impact; the follow-through afterwards is free to bend away
 * from it. This key's own two neighbouring key positions (the windup and the
 * follow-through) were chosen so this lean doesn't reintroduce overshoot
 * (verified by the overshoot test below, not just asserted). The lean only
 * applies to the BALL — the grip and haft rotation don't need to "carry
 * momentum" the way the ball does, and biasing them the same way overshoots
 * the grip's own, much smaller, range of motion.
 */
function hermiteTangent(keys: readonly Key[], i: number, pick: (k: Key) => Vec3, biasStrike: boolean): Vec3 {
  const n = keys.length;
  if (i === 0 || i === n - 1) return [0, 0, 0];
  const prev = pick(keys[i - 1]!), cur = pick(keys[i]!), next = pick(keys[i + 1]!);
  const dtPrev = keys[i]!.t - keys[i - 1]!.t, dtNext = keys[i + 1]!.t - keys[i]!.t;
  const isStrike = biasStrike && keys[i]!.t === FLAIL_SWING.strikeT;
  const out: [number, number, number] = [0, 0, 0];
  for (const c of [0, 1, 2] as const) {
    const dPrev = (cur[c] - prev[c]) / dtPrev;
    const dNext = (next[c] - cur[c]) / dtNext;
    const central = (next[c] - prev[c]) / (keys[i + 1]!.t - keys[i - 1]!.t);
    if (isStrike) {
      out[c] = central * (1 - STRIKE_BIAS) + dPrev * STRIKE_BIAS;
      continue;
    }
    if (dPrev === 0 || dNext === 0 || Math.sign(dPrev) !== Math.sign(dNext)) continue;
    const cap = 3 * Math.min(Math.abs(dPrev), Math.abs(dNext));
    out[c] = Math.abs(central) > cap ? Math.sign(central) * cap : central;
  }
  return out;
}

function sample(keys: readonly Key[], t: number, pick: (k: Key) => Vec3, biasStrike: boolean): Vec3 {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1]!.t) i++;
  const k0 = keys[i]!, k1 = keys[i + 1]!;
  const h = k1.t - k0.t;
  const u = Math.min(1, Math.max(0, (t - k0.t) / h));
  const p0 = pick(k0), p1 = pick(k1);
  const m0 = hermiteTangent(keys, i, pick, biasStrike), m1 = hermiteTangent(keys, i + 1, pick, biasStrike);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const at = (j: 0 | 1 | 2) => h00 * p0[j] + h10 * h * m0[j] + h01 * p1[j] + h11 * h * m1[j];
  return [at(0), at(1), at(2)];
}

export function flailPose(s: FlailSwing): FlailPose {
  if (s.phase === 'idle') return FLAIL_REST;
  const keys = KEYS[s.side];
  return {
    grip: sample(keys, s.t, k => k.grip, false),
    rot: sample(keys, s.t, k => k.rot, false),
    ball: sample(keys, s.t, k => k.ball, true),
  };
}
