// src/lab/sdf-zombie/webgpu/flail-chain.ts
//
// THE FLAIL'S CHAIN, SIMULATED FOR LOOKS (spec §10.1). Pure. Position-based
// rope in VIEW (rig-local) space, pinned at the eye bolt; the ball is its heavy
// last node. The swing's authored ball position is a TARGET the ball is guided
// toward — PD-like: its position is pulled toward the target AND its velocity
// toward the target's velocity, by the same weight — so it arrives MOVING with
// the key instead of being yanked onto it. The guide is loose through the
// wind-up (the ball trails the haft — the whip), 1 at strikeT, loose again
// through the follow-through, and a light hold at rest. On the strike frame
// the caller pins the ball on FLAIL_IMPACT on the LAST substep only, leaving
// it the key's velocity, so a miss flies on through the arc. Hits never read
// this module.
//
// Nodes: 0 = the bolt (pinned) … n−2 = the ball's ring … n−1 = the ball centre.

import type { Vec3 } from '../types';
import { FLAIL_CHAIN, FLAIL_SWING, type FlailSwing } from './flail-swing';

export const FLAIL_CHAIN_SIM = {
  nodes: 9,
  stepHz: 240,
  maxSubsteps: 24,
  /** Gauss-Seidel sweeps per substep; a follow-the-leader pass after them
   *  makes every link exact, so these only shape how corrections spread. */
  iterations: 20,
  /** Air drag, 1/s. */
  damping: 2.5,
  gravity: 9.81,
  /** Inverse mass of the ball node (the links are 1): a heavy ball the chain barely
   *  drags. 20x a link — at 5x the seven links together outweighed the ball and a
   *  released ball lost most of its speed to the resting chain. */
  ballInvMass: 0.05,
  /** Guide rate at guide 1, 1/s: the per-substep blend is 1 − exp(−rate·guide·h). */
  guideRate: 140,
  restGuide: 0.12,
  /** The guide's floor through a swing. With the rate, it sets the wind-up
   *  trail (~13 cm behind the key at 60 Hz) against the no-catapult rule (no
   *  frame moves over 1.6x the key's move + 2 cm) — swept, flail-chain.test.ts gates both. */
  swingFloor: 0.3,
  /** Seconds before strikeT over which the guide ramps up to 1. */
  guideWindow: 0.1,
  /** Seconds after strikeT over which it lets go. */
  releaseWindow: 0.1,
  /** Seconds before the swing ends over which it returns to the rest hold. */
  settleWindow: 0.12,
  /** An anchor faster than this, m/s, is a teleport (re-make the chain), not
   *  motion: the swing moves the bolt up to ~19 m/s; a cancelled swing snaps it
   *  up to 0.87 m in one frame. */
  teleportMps: 30,
} as const;

type M3 = [number, number, number];

export interface ChainState {
  p: M3[];
  prev: M3[];
  /** The anchor the last substep used. */
  anchor: M3;
  /** The target the last substep used. */
  target: M3;
  /** Unsimulated time carried to the next call, seconds. */
  acc: number;
}

export interface ChainStepOpts {
  /** Pin the ball exactly on `target` at the end of this call (the strike frame). */
  pin?: boolean;
  /** The target's velocity, m/s. Default: its displacement over this call. */
  targetVel?: Vec3;
}

const N = FLAIL_CHAIN_SIM.nodes;
const REST: readonly number[] = Array.from({ length: N - 1 }, (_, k) => (k === N - 2 ? FLAIL_CHAIN.ringOffset : FLAIL_CHAIN.len / (N - 2)));

/** Rest length of link k (node k → k+1). */
export function linkRest(k: number): number {
  return REST[k]!;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

export function guideWeight(s: FlailSwing): number {
  const C = FLAIL_CHAIN_SIM, S = FLAIL_SWING;
  if (s.phase === 'idle') return C.restGuide;
  const t = s.t;
  if (t <= S.strikeT) return Math.max(C.swingFloor, smooth(S.strikeT - C.guideWindow, S.strikeT, t));
  const letGo = 1 - smooth(S.strikeT, S.strikeT + C.releaseWindow, t);
  const settle = smooth(S.swingSec - C.settleWindow, S.swingSec, t) * C.restGuide;
  return Math.max(C.swingFloor, letGo, settle);
}

export function makeChain(anchor: Vec3, toward: Vec3): ChainState {
  const d: M3 = [toward[0] - anchor[0], toward[1] - anchor[1], toward[2] - anchor[2]];
  const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  const u: M3 = l > 1e-9 ? [d[0] / l, d[1] / l, d[2] / l] : [0, -1, 0];
  const p: M3[] = [];
  let r = 0;
  for (let i = 0; i < N; i++) {
    p.push([anchor[0] + u[0] * r, anchor[1] + u[1] * r, anchor[2] + u[2] * r]);
    if (i < N - 1) r += REST[i]!;
  }
  return {
    p, prev: p.map(q => [q[0], q[1], q[2]] as M3),
    anchor: [anchor[0], anchor[1], anchor[2]], target: [toward[0], toward[1], toward[2]], acc: 0,
  };
}

/** FABRIK passes on a pinned substep (16 left 0.2% on the L ring link once the
 *  0.15 s key reshaped the approach; 32 is exact to < 0.1%, once per strike). */
const PIN_FABRIK = 32;

/** Move `q` to `rest` from `from`, along from → q. */
function place(from: M3, q: M3, rest: number): void {
  const dx = q[0] - from[0], dy = q[1] - from[1], dz = q[2] - from[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-12) return;
  const k = rest / d;
  q[0] = from[0] + dx * k; q[1] = from[1] + dy * k; q[2] = from[2] + dz * k;
}

function cloneChain(s: ChainState): ChainState {
  return {
    p: s.p.map(q => [q[0], q[1], q[2]] as M3), prev: s.prev.map(q => [q[0], q[1], q[2]] as M3),
    anchor: [s.anchor[0], s.anchor[1], s.anchor[2]], target: [s.target[0], s.target[1], s.target[2]], acc: s.acc,
  };
}

/** Pure: a new state, the input untouched (tests, replays). */
export function stepChain(
  s: ChainState, anchor: Vec3, target: Vec3, guide: number, down: Vec3, dt: number, opts?: ChainStepOpts,
): ChainState {
  if (!(dt > 0)) return s;
  return stepChainInPlace(cloneChain(s), anchor, target, guide, down, dt, opts);
}

/** The same step, mutating and returning `s` (the per-frame game path: no allocations). */
export function stepChainInPlace(
  s: ChainState, anchor: Vec3, target: Vec3, guide: number, down: Vec3, dt: number, opts?: ChainStepOpts,
): ChainState {
  if (!(dt > 0)) return s;
  const C = FLAIL_CHAIN_SIM;
  const h = 1 / C.stepHz;
  const span = s.acc + dt;
  let steps = Math.floor(span / h + 1e-9);
  let acc = Math.max(0, span - steps * h);
  let capped = false;
  if (steps > C.maxSubsteps) { steps = C.maxSubsteps; acc = 0; capped = true; }
  const pinCall = opts?.pin === true;
  if (steps === 0) {
    s.acc = acc;
    if (!pinCall) return s;
    steps = 1;   // a pin must land this call: take one substep now
  }
  const p = s.p, prev = s.prev, last = N - 1;
  const a0x = s.anchor[0], a0y = s.anchor[1], a0z = s.anchor[2];
  const t0x = s.target[0], t0y = s.target[1], t0z = s.target[2];
  // The target's velocity: given (the key's own tangent), or its secant over this call.
  const tv = opts?.targetVel;
  const tvx = tv ? tv[0] : (target[0] - t0x) / span;
  const tvy = tv ? tv[1] : (target[1] - t0y) / span;
  const tvz = tv ? tv[2] : (target[2] - t0z) / span;
  const decay = Math.exp(-C.damping * h);
  const gx = down[0] * C.gravity * h * h, gy = down[1] * C.gravity * h * h, gz = down[2] * C.gravity * h * h;
  const pull = 1 - Math.exp(-C.guideRate * clamp01(guide) * h);
  const b = p[last]!, bp = prev[last]!;
  let ax = a0x, ay = a0y, az = a0z;
  // WHOLE-MOVE calls spread the full anchor/target move over the substeps they
  // take, so the last one ends ON both, and carry no time: a capped call, a
  // forced single substep, and a PIN call — whose last substep must land the
  // ball on the FULL target (FLAIL_IMPACT), not on the fraction a carried
  // `acc` would leave it (3–5 cm short at 144 Hz or with jittered frames).
  const whole = capped || pinCall || steps * h > span;
  for (let step = 0; step < steps; step++) {
    const f = whole ? (step + 1) / steps : Math.min(1, ((step + 1) * h) / span);
    ax = a0x + (anchor[0] - a0x) * f; ay = a0y + (anchor[1] - a0y) * f; az = a0z + (anchor[2] - a0z) * f;
    const tx = t0x + (target[0] - t0x) * f, ty = t0y + (target[1] - t0y) * f, tz = t0z + (target[2] - t0z) * f;
    const pinHere = pinCall && step === steps - 1;
    // Verlet for the free nodes.
    for (let i = 1; i < N; i++) {
      const q = p[i]!, o = prev[i]!;
      const vx = (q[0] - o[0]) * decay, vy = (q[1] - o[1]) * decay, vz = (q[2] - o[2]) * decay;
      o[0] = q[0]; o[1] = q[1]; o[2] = q[2];
      q[0] += vx + gx; q[1] += vy + gy; q[2] += vz + gz;
    }
    const n0 = p[0]!;
    n0[0] = ax; n0[1] = ay; n0[2] = az;
    // THE GUIDE (PD): move the ball toward the target without that move
    // becoming velocity, and blend its velocity toward the target's.
    if (pinHere) {
      b[0] = tx; b[1] = ty; b[2] = tz;
    } else if (pull > 0) {
      const dx = b[0] - bp[0], dy = b[1] - bp[1], dz = b[2] - bp[2];
      b[0] += (tx - b[0]) * pull; b[1] += (ty - b[1]) * pull; b[2] += (tz - b[2]) * pull;
      bp[0] = b[0] - (dx + (tvx * h - dx) * pull);
      bp[1] = b[1] - (dy + (tvy * h - dy) * pull);
      bp[2] = b[2] - (dz + (tvz * h - dz) * pull);
    }
    // Link constraints (Gauss-Seidel).
    const wBall = pinHere ? 0 : C.ballInvMass;
    for (let it = 0; it < C.iterations; it++) {
      for (let i = 0; i < last; i++) {
        const q0 = p[i]!, q1 = p[i + 1]!;
        const w0 = i === 0 ? 0 : 1;
        const w1 = i + 1 === last ? wBall : 1;
        const wsum = w0 + w1;
        if (wsum === 0) continue;
        const dx = q1[0] - q0[0], dy = q1[1] - q0[1], dz = q1[2] - q0[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const c = (d - REST[i]!) / d / wsum;
        q0[0] += dx * c * w0; q0[1] += dy * c * w0; q0[2] += dz * c * w0;
        q1[0] -= dx * c * w1; q1[1] -= dy * c * w1; q1[2] -= dz * c * w1;
      }
    }
    if (pinHere) {
      // The ball stays ON the target and keeps the key's velocity through the hit.
      b[0] = tx; b[1] = ty; b[2] = tz;
      bp[0] = tx - tvx * h; bp[1] = ty - tvy * h; bp[2] = tz - tvz * h;
      // Both ends fixed: FABRIK (backward from the ball, forward from the bolt)
      // for the links the sweeps left long or short.
      for (let it = 0; it < PIN_FABRIK; it++) {
        for (let i = last; i > 0; i--) place(p[i]!, p[i - 1]!, REST[i - 1]!);
        n0[0] = ax; n0[1] = ay; n0[2] = az;   // re-root on the bolt
        for (let i = 0; i < last - 1; i++) place(p[i]!, p[i + 1]!, REST[i]!);
      }
    } else {
      // Follow-the-leader: walk out from the bolt, each node at its rest length
      // along its current direction — every link exact after the sweeps.
      for (let i = 0; i < last; i++) place(p[i]!, p[i + 1]!, REST[i]!);
    }
  }
  // The anchor and target the last substep used (the full ones on a whole-move call).
  if (whole) { s.anchor[0] = anchor[0]; s.anchor[1] = anchor[1]; s.anchor[2] = anchor[2]; } else { s.anchor[0] = ax; s.anchor[1] = ay; s.anchor[2] = az; }
  const fEnd = whole ? 1 : Math.min(1, (steps * h) / span);
  s.target[0] = t0x + (target[0] - t0x) * fEnd; s.target[1] = t0y + (target[1] - t0y) * fEnd; s.target[2] = t0z + (target[2] - t0z) * fEnd;
  s.acc = whole ? 0 : acc;
  return s;
}

/** True when `anchor` has jumped from where the chain's last substep put it
 *  faster than FLAIL_CHAIN_SIM.teleportMps. The chain's anchor lags the caller's
 *  by the carried time `acc`, so the jump spans dt + acc, not dt. */
export function chainTeleported(s: ChainState, anchor: Vec3, dt: number): boolean {
  const dx = anchor[0] - s.anchor[0], dy = anchor[1] - s.anchor[1], dz = anchor[2] - s.anchor[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) > FLAIL_CHAIN_SIM.teleportMps * (Math.max(0, dt) + s.acc);
}

/**
 * The chain AS DRAWN this frame, into `out` (n nodes; the sim state is not
 * touched, so the sim stays frame-rate independent). The sim ends up to one
 * substep behind the frame (it carries `acc` of unsimulated time): each free
 * node is extrapolated by its Verlet velocity over `acc`, node 0 is put ON the
 * true bolt, and a follow-the-leader pass from it makes every drawn link exact.
 */
export function drawChain(s: ChainState, bolt: Vec3, out: [number, number, number][]): void {
  const k = s.acc * FLAIL_CHAIN_SIM.stepHz;
  const p = s.p, prev = s.prev, last = N - 1;
  const o0 = out[0]!;
  o0[0] = bolt[0]; o0[1] = bolt[1]; o0[2] = bolt[2];
  for (let i = 1; i < N; i++) {
    const q = p[i]!, o = prev[i]!, d = out[i]!;
    d[0] = q[0] + (q[0] - o[0]) * k; d[1] = q[1] + (q[1] - o[1]) * k; d[2] = q[2] + (q[2] - o[2]) * k;
  }
  // Nothing carried and node 0 already on the bolt (a pin frame, an exact step):
  // the sim IS the frame — keep it exactly (the pinned ball stays ON the target).
  const q0 = p[0]!;
  if (k === 0 && q0[0] === bolt[0] && q0[1] === bolt[1] && q0[2] === bolt[2]) return;
  for (let i = 0; i < last; i++) place(out[i]!, out[i + 1]!, REST[i]!);
}
