// src/lab/sdf-zombie/webgpu/flail-swing.ts
//
// THE SPIKE FLAIL'S SWING (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §5–6).
// Pure: a click edge, the button state and dt in; the phase, the pose and the
// strike events out. No Three.js, no physics — three authored swings:
//
//   R: the overhand (high right, down onto the crosshair, low left)
//   L: the cross (back across the chest to the left, across the front, low right)
//   H: the sweep (wide right at shoulder height, flat through the crosshair,
//      far left) — the combo's finisher, longer than R and L (FLAIL_TIMING)
//
// A click from idle starts the combo's next side — holding the button with no
// click edge (e.g. right after a weapon switch leaves it physically held down)
// never starts a swing on its own; idle always waits for an explicit click.
//
// THE COMBO (spec §12.1): chained clicks advance R → L → H → R; an
// unchained click always starts R. A click is chained if it lands in the
// last bufferSec of the previous swing (queued, or a held button), or within
// comboWindowSec after the previous swing ends; otherwise the combo resets.
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
// uneven spacing and let the ball slow into the strike
// key and then pop on the far side; matching each tangent to the key's actual
// time spacing carries the ball through the strike near full speed instead.

import type { Vec3 } from '../types';

export const FLAIL_SWING = {
  swingSec: 0.45,
  /** The strike frame: the ball is at its impact key. */
  strikeT: 0.18,
  /** A click this close to the end of a swing queues the next one. */
  bufferSec: 0.15,
  /** A click within this long after a swing ends continues the combo; later, it restarts at R. */
  comboWindowSec: 0.35,
} as const;

/** The chain (flail-chain.ts simulates it, game-flail.ts draws it). The keys
 *  below are authored so every key's ball is within `chainReach()` of the eye
 *  bolt — flail-swing.test.ts checks it — so the simulated ball can reach every key. */
export const FLAIL_CHAIN = {
  /** The eye bolt (flail.glb's ChainAnchor), haft-local +Y, metres — fitted
   *  in game from the probes in docs/dev-notes/2026-09-26-flail/NOTES.md. */
  anchorY: 0.448,
  /** The chain's rest length, metres. */
  len: 0.3,
  /** Ball centre → its ring, metres (the chain meets the ring, not the centre). */
  ringOffset: 0.07,
} as const;

/** Furthest the ball's centre can sit from the eye bolt: the chain taut (0.37 m). */
export function chainReach(): number {
  return FLAIL_CHAIN.len + FLAIL_CHAIN.ringOffset;
}

export type FlailSide = 'R' | 'L' | 'H';

/** Per-side swing timing. R and L are FLAIL_SWING's; H, the combo's finisher, is longer. */
export const FLAIL_TIMING: Readonly<Record<FlailSide, { swingSec: number; strikeT: number }>> = {
  R: { swingSec: FLAIL_SWING.swingSec, strikeT: FLAIL_SWING.strikeT },
  L: { swingSec: FLAIL_SWING.swingSec, strikeT: FLAIL_SWING.strikeT },
  H: { swingSec: 0.55, strikeT: 0.2 },
};

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

// Every key keeps the ball within chain reach (0.37 m) of the eye bolt (the
// haft's ChainAnchor, 0.448 m up the haft). The keyed ball is only a TARGET:
// flail-chain.ts pulls the simulated ball toward it (hard only around the
// strike), so between keys, where the spline can overrun the reach, the chain
// simply holds the ball at full stretch. The wind-up and follow-through keys
// sit at 0.35–0.36 m, the strike's at ~0.35 m (taut — the chain straight out
// past the haft's tip, the ball leading the hand into the hit). The strike is
// made taut by drawing the GRIP back (z −0.37, was −0.46), not by pushing the
// ball deeper: a deeper strike ball steepens the strike tangent and the ball
// overshoots the follow-through key by more than the overshoot test's 3 cm
// (searched; no deeper-ball set passed for R). The follow-through ball sits
// deeper than the strike's (−1.30 vs −1.12) for the same reason. The haft's `rot`
// here is (pitch, 0, lean): the lean tips it inward/outward, the pitch
// forward/back (XYZ Euler of the haft's +Y).
//
// The 0.15 s and 0.37 s keys (v1.1 look pass) keep the chain from going slack.
// The haft sweeps ~107° between the wind-up and the strike, so the bolt runs
// along an ARC while the ball's spline cuts the CHORD. With only the wind-up →
// strike keys the keyed ball passed 0.19 m from the bolt at t ≈ 0.16, and the
// chain bunched into a loop above the haft tip on the frames just before the
// hit. The return to rest had the same problem (0.24 m at t ≈ 0.36). Each extra
// key takes the grip and rot the old curve had at that time, and puts the ball
// out on the arc, 0.34–0.36 m from the bolt. The minimum over the swing is now
// 0.31 m (R) and 0.32 m (L); flail-swing.test.ts holds it at ≥ 0.28 m. The ball
// offsets were found by a constrained search that kept every other swing test
// passing (overshoot, speed jump, strike speed, reach), then rounded to the cm.
//
// v1.2 (spec §11): the strike lands ON THE CROSSHAIR, and R is a big overhand
// swipe. v1.1's strike balls sat ~0.35 m below the view axis (R (−0.05, −0.36,
// −1.12)), ~18° under the crosshair, so aiming at a head hit the upper chest
// and cut the neck. Both strike balls are now at y −0.08, z −1.09…−1.1 (4° under
// the crosshair, x within 6 cm of it). The chain is still taut there (0.344 R,
// 0.348 L), so the bolt had to come UP with the ball: R's haft is pitched only
// −0.89 (was −1.76), the eye bolt above-right of the ball at (0.06, 0.12,
// −0.83), and the chain comes DOWN onto the target; the fist stays low right
// (0.19, −0.15, −0.5), out of the crosshair. R's wind-up (t 0.1) is now the
// fist raised over the right shoulder (y 0.25) with the haft tipped back and
// the ball up and behind the frame's top-right corner (0.64, 0.6, −0.22); at
// 0.15 the haft comes over and the ball crests high in front (y 0.43), so the
// strike's ball velocity is mostly DOWN (a diagonal, not a jab); it follows
// through low left (−0.4, −0.65, −0.94). (The v1.1 numbers in the paragraph
// above are history.) L keeps its v1.1 wind-up, its 0.37 key, and its 0.3 key to
// within 2 cm; its strike (and the fist, up with it) and its 0.15 key moved. As in v1.1, a scratch constrained search (not committed) varied the
// non-rest keys from a hand-authored overhand start and kept the sets where every
// flailPose test predicate passed with a margin, plus flail-chain's replay gates
// (the strike pin at every frame rate, the 60 Hz no-catapult and wind-up trail);
// then rounded to the cm (0.01 rad) and re-polished on that grid.

/** R: an overhand swipe — wind up high over the right shoulder, come down diagonally onto the crosshair, follow through low left. */
const KEYS_R: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.1, grip: [0.28, 0.25, -0.3], rot: [0.34, 0, -0.08], ball: [0.64, 0.6, -0.22] },
  { t: 0.15, grip: [0.21, 0.01, -0.4], rot: [-0.66, 0, -0.1], ball: [0.21, 0.43, -1.03] },
  { t: 0.18, grip: [0.19, -0.15, -0.5], rot: [-0.89, 0, 0.29], ball: [-0.05, -0.08, -1.09] },
  { t: 0.3, grip: [-0.05, -0.4, -0.55], rot: [-1.4, 0, 0.5], ball: [-0.4, -0.65, -0.94] },
  { t: 0.37, grip: [0.2, -0.38, -0.55], rot: [-1, 0, 0.2], ball: [0, -0.47, -1] },
  { t: 0.45, ...FLAIL_REST },
];

/** L: wind back across the chest to the left, strike across the front, follow through low right. */
const KEYS_L: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.1, grip: [-0.02, -0.08, -0.35], rot: [0.1, 0, 0.52], ball: [-0.42, 0.13, -0.56] },
  { t: 0.15, grip: [0.14, -0.07, -0.38], rot: [-0.92, 0, 0.34], ball: [-0.2, 0.01, -0.96] },
  { t: 0.18, grip: [0.25, -0.12, -0.38], rot: [-1.2, 0, 0.2], ball: [0.06, -0.08, -1.1] },
  { t: 0.3, grip: [0.45, -0.34, -0.59], rot: [-1.89, 0, -0.43], ball: [0.77, -0.56, -1.3] },
  { t: 0.37, grip: [0.43, -0.34, -0.56], rot: [-1.31, 0, -0.19], ball: [0.38, -0.45, -1.23] },
  { t: 0.45, ...FLAIL_REST },
];

// v1.3 (spec §12.1): H, the combo's finisher, is a FLAT right-to-left SWEEP at
// crosshair height, read against R's vertical overhand and L's diagonal cross.
// It is longer (FLAIL_TIMING.H: 0.55 s, the strike at 0.2 s). The wind-up (0.12)
// has the fist at shoulder height out right (0.43, 0.1, −0.31) with the haft
// laid over to the right (lean −1.22), the ball wide right at eye level
// (0.69, −0.03, −0.49). At 0.17 the haft comes round forward and the ball is out in
// front, still right and level (0.47, −0.03, −1.04), so the strike's ball velocity is
// almost all sideways: (−17.8, −1.8, −2.9) m/s, |vx| ≈ 10·|vy|. The strike
// is on the crosshair (0, −0.08, −1.1), with the haft pitched nearly level
// forward (−1.33) and the chain taut (0.344 m). The bolt stays within
// 0.344 m of the impact for a 30 Hz frame after it: the chain sim's strike pin
// needs that. The follow-through (0.33) is far left and a little low
// (−0.64, −0.19, −0.8); the 0.43 key swings it back, low and a little left
// (−0.22, −0.27, −0.88), on the way to rest. As for R and L, a scratch constrained search (not
// committed) found the numbers. It started from a hand-authored sweep, varied
// every non-rest key (the strike ball fixed), and kept the sets where every
// flailPose test predicate passed with a margin: taut 0.343–0.357 at the strike,
// ≥ 0.30 m from the bolt all swing, reach, ≤ 2.5 cm overshoot, jump < 1.8×,
// strike ≥ 0.85 of peak, no pops, and the sweep's shape. It also kept the
// bolt ≤ 0.35 m from the impact through the frame after the strike, which
// holds the pin's links exact. The winner was rounded to the cm (0.01 rad) and
// re-polished on that grid against flail-chain's replay gates at every frame
// rate: the pin < 1e-6, exact links, no catapult, the wind-up trail. Min
// ball–bolt 0.307 m; strike speed 0.98 of peak.

/** H: a flat right-to-left sweep — wind up wide right at shoulder height, sweep through the crosshair, follow through far left. */
const KEYS_H: readonly Key[] = [
  { t: 0, ...FLAIL_REST },
  { t: 0.12, grip: [0.43, 0.1, -0.31], rot: [-0.2, 0, -1.22], ball: [0.69, -0.03, -0.49] },
  { t: 0.17, grip: [0.15, -0.19, -0.41], rot: [-0.92, 0, -0.31], ball: [0.47, -0.03, -1.04] },
  { t: 0.2, grip: [0.13, 0.04, -0.42], rot: [-1.33, 0, 0.13], ball: [0, -0.08, -1.1] },
  { t: 0.33, grip: [0.04, -0.04, -0.56], rot: [-1.29, 0, 1.15], ball: [-0.64, -0.19, -0.8] },
  { t: 0.43, grip: [0.16, -0.23, -0.43], rot: [-0.81, 0, 0.67], ball: [-0.22, -0.27, -0.88] },
  { t: 0.55, ...FLAIL_REST },
];

const KEYS: Readonly<Record<FlailSide, readonly Key[]>> = { R: KEYS_R, L: KEYS_L, H: KEYS_H };

/** Each side's key times (the tests iterate these). */
export function flailKeyTimes(side: FlailSide): number[] { return KEYS[side].map(k => k.t); }

/** The ball at the strike frame, per side (view space). */
export const FLAIL_IMPACT: Readonly<Record<FlailSide, Vec3>> = {
  R: KEYS_R.find(k => k.t === FLAIL_TIMING.R.strikeT)!.ball,
  L: KEYS_L.find(k => k.t === FLAIL_TIMING.L.strikeT)!.ball,
  H: KEYS_H.find(k => k.t === FLAIL_TIMING.H.strikeT)!.ball,
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
  /** Seconds idle since the last swing ended (0 on a fresh flail). */
  idleT: number;
}

export interface FlailInput {
  /** A click edge this step (mousedown). */
  click: boolean;
  /** The button is down. */
  held: boolean;
}

export function makeFlailSwing(): FlailSwing {
  return { phase: 'idle', side: 'R', t: 0, struck: false, queued: false, nextSide: 'R', swingId: 0, idleT: 0 };
}

/** The combo: R (overhand) → L (cross) → H (sweep) → R. */
const COMBO_NEXT: Readonly<Record<FlailSide, FlailSide>> = { R: 'L', L: 'H', H: 'R' };

/** The side the next swing takes: the combo's next while chained or inside the window, else R. */
export function comboSide(s: FlailSwing): FlailSide {
  return s.phase === 'swing' || s.idleT <= FLAIL_SWING.comboWindowSec ? s.nextSide : 'R';
}

function start(s: FlailSwing, t: number): FlailSwing {
  const side = comboSide(s);
  return {
    phase: 'swing', side, t, struck: false, queued: false,
    nextSide: COMBO_NEXT[side], swingId: s.swingId + 1, idleT: 0,
  };
}

/** Fire the strike if this swing's t has crossed strikeT and it has not yet. */
function strikeIfDue(s: FlailSwing, strikes: FlailSide[]): FlailSwing {
  if (s.phase !== 'swing' || s.struck || s.t < FLAIL_TIMING[s.side].strikeT) return s;
  strikes.push(s.side);
  return { ...s, struck: true };
}

export function stepFlailSwing(
  s: FlailSwing, input: FlailInput, dt: number,
): { state: FlailSwing; strikes: FlailSide[] } {
  const strikes: FlailSide[] = [];
  if (!(dt > 0)) return { state: s, strikes };
  const { bufferSec } = FLAIL_SWING;

  let cur: FlailSwing;
  if (s.phase === 'idle') {
    // Idle never advances on a held button alone — only an explicit click starts a swing.
    // comboSide (inside start()) reads the PRE-step idleT, before it ages below.
    if (!input.click) return { state: { ...s, idleT: s.idleT + dt }, strikes };
    cur = strikeIfDue(start(s, dt), strikes);
  } else {
    const tNext = s.t + dt;
    // Buffer check uses the POST-step time, so a step that lands exactly on the boundary counts.
    const queued = s.queued || (input.click && FLAIL_TIMING[s.side].swingSec - tNext <= bufferSec);
    cur = strikeIfDue({ ...s, t: tNext, queued }, strikes);
  }

  if (cur.phase === 'swing' && cur.t >= FLAIL_TIMING[cur.side].swingSec) {
    const leftover = cur.t - FLAIL_TIMING[cur.side].swingSec;
    cur = cur.queued || input.held
      ? strikeIfDue(start(cur, leftover), strikes)
      : { ...cur, phase: 'idle', t: 0, queued: false, struck: false, idleT: leftover };
  }
  return { state: cur, strikes };
}

/** Weapon switch or death: back to idle; no strike fires after this. */
export function cancelFlailSwing(s: FlailSwing): FlailSwing {
  return { ...s, phase: 'idle', t: 0, struck: false, queued: false, idleT: Infinity };
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
 * keys are unevenly spaced (0.1/0.05/0.03/0.12/0.07/0.08s), with short segments
 * next to much longer ones, and a plain central difference
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
 * from it. This key's own two neighbouring key positions (the 0.15 s key and the
 * follow-through) were chosen so this lean doesn't reintroduce overshoot
 * (verified by the overshoot test below, not just asserted). The lean only
 * applies to the BALL — the grip and haft rotation don't need to "carry
 * momentum" the way the ball does, and biasing them the same way overshoots
 * the grip's own, much smaller, range of motion.
 */
function hermiteTangent(keys: readonly Key[], i: number, pick: (k: Key) => Vec3, strikeT: number | null): Vec3 {
  const n = keys.length;
  if (i === 0 || i === n - 1) return [0, 0, 0];
  const prev = pick(keys[i - 1]!), cur = pick(keys[i]!), next = pick(keys[i + 1]!);
  const dtPrev = keys[i]!.t - keys[i - 1]!.t, dtNext = keys[i + 1]!.t - keys[i]!.t;
  const isStrike = strikeT !== null && keys[i]!.t === strikeT;
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

/** `strikeT`: the side's strike key time, whose ball tangent leans on the incoming
 *  secant (null for the grip and haft rotation, which don't lean). */
function sample(keys: readonly Key[], t: number, pick: (k: Key) => Vec3, strikeT: number | null): Vec3 {
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1]!.t) i++;
  const k0 = keys[i]!, k1 = keys[i + 1]!;
  const h = k1.t - k0.t;
  const u = Math.min(1, Math.max(0, (t - k0.t) / h));
  const p0 = pick(k0), p1 = pick(k1);
  const m0 = hermiteTangent(keys, i, pick, strikeT), m1 = hermiteTangent(keys, i + 1, pick, strikeT);
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
    grip: sample(keys, s.t, k => k.grip, null),
    rot: sample(keys, s.t, k => k.rot, null),
    ball: sample(keys, s.t, k => k.ball, FLAIL_TIMING[s.side].strikeT),
  };
}

/** The eye bolt (the chain's anchor) for a pose, view space: grip + R·(0, anchorY, 0),
 *  R the haft's XYZ Euler (three's order: R = Rx·Ry·Rz). game-flail.ts gets the
 *  same point from the haft's matrix. */
export function flailBolt(p: FlailPose): Vec3 {
  let x = 0, y: number = FLAIL_CHAIN.anchorY, z = 0;
  const [ax, ay, az] = p.rot;
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  return [p.grip[0] + x, p.grip[1] + y, p.grip[2] + z];
}

/** The keyed ball's velocity (m/s, view space): a central difference of the
 *  swing's ball curve at the swing's t (one-sided at the ends); zero at idle. */
export function flailBallVel(s: FlailSwing, eps = 1e-4): Vec3 {
  if (s.phase === 'idle') return [0, 0, 0];
  const lo = Math.max(0, s.t - eps), hi = Math.min(FLAIL_TIMING[s.side].swingSec, s.t + eps);
  if (hi <= lo) return [0, 0, 0];
  const a = flailPose({ ...s, t: lo }).ball, b = flailPose({ ...s, t: hi }).ball;
  const k = 1 / (hi - lo);
  return [(b[0] - a[0]) * k, (b[1] - a[1]) * k, (b[2] - a[2]) * k];
}
