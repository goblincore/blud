// src/lab/sdf-zombie/webgpu/flail-chain.ts
//
// THE FLAIL'S CHAIN, SIMULATED FOR LOOKS (spec §10.1). Pure. Position-based
// rope in VIEW space, pinned at the eye bolt; the ball is its heavy last node.
// The swing's authored ball position is a TARGET the ball is pulled toward by
// a guide weight: loose through the wind-up (the ball lags the haft — the
// whip), exactly 1 at strikeT (the drawn ball sits on FLAIL_IMPACT, where the
// strike window puts the crater), loose again through the follow-through, and
// a light hold at rest. Hits never read this module.
//
// Nodes: 0 = the bolt (pinned) … n−2 = the ball's ring … n−1 = the ball centre.

import type { Vec3 } from '../types';
import { FLAIL_CHAIN, FLAIL_SWING, type FlailSwing } from './flail-swing';

export const FLAIL_CHAIN_SIM = {
  nodes: 9,
  stepHz: 240,
  maxSubsteps: 24,
  iterations: 100,
  /** Air drag, 1/s. */
  damping: 2.5,
  gravity: 9.81,
  /** Inverse mass of the ball node (the links are 1): a heavy ball the chain barely drags. */
  ballInvMass: 0.2,
  /** Pull toward the target at guide 1, 1/s (below `pinAt`). */
  guideRate: 80,
  /** At or above this guide the ball is pinned exactly on the target. */
  pinAt: 0.98,
  restGuide: 0.12,
  swingFloor: 0.03,
  /** Seconds before strikeT over which the guide ramps up to 1. */
  guideWindow: 0.07,
  /** Seconds after strikeT over which it lets go. */
  releaseWindow: 0.05,
  /** Seconds before the swing ends over which it returns to the rest hold. */
  settleWindow: 0.12,
} as const;

type M3 = [number, number, number];

export interface ChainState {
  p: Vec3[];
  prev: Vec3[];
  /** The anchor the last substep used. */
  anchor: Vec3;
  /** Unsimulated time carried to the next call, seconds. */
  acc: number;
}

const N = FLAIL_CHAIN_SIM.nodes;

/** Rest length of link k (node k → k+1). */
export function linkRest(k: number): number {
  return k === N - 2 ? FLAIL_CHAIN.ringOffset : FLAIL_CHAIN.len / (N - 2);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

export function guideWeight(s: FlailSwing): number {
  const C = FLAIL_CHAIN_SIM, S = FLAIL_SWING;
  if (s.phase === 'idle') return C.restGuide;
  const t = s.t;
  if (t <= S.strikeT) return t >= S.strikeT ? 1 : Math.max(C.swingFloor, smooth(S.strikeT - C.guideWindow, S.strikeT, t));
  const letGo = 1 - smooth(S.strikeT, S.strikeT + C.releaseWindow, t);
  const settle = smooth(S.swingSec - C.settleWindow, S.swingSec, t) * C.restGuide;
  return Math.max(C.swingFloor, letGo, settle);
}

export function makeChain(anchor: Vec3, toward: Vec3): ChainState {
  const d: M3 = [toward[0] - anchor[0], toward[1] - anchor[1], toward[2] - anchor[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  const u: M3 = l > 1e-9 ? [d[0] / l, d[1] / l, d[2] / l] : [0, -1, 0];
  const p: Vec3[] = [];
  let r = 0;
  for (let i = 0; i < N; i++) {
    p.push([anchor[0] + u[0] * r, anchor[1] + u[1] * r, anchor[2] + u[2] * r]);
    if (i < N - 1) r += linkRest(i);
  }
  return { p, prev: p.map(q => [q[0], q[1], q[2]] as Vec3), anchor: [anchor[0], anchor[1], anchor[2]], acc: 0 };
}

export function stepChain(
  s: ChainState, anchor: Vec3, target: Vec3, guide: number, down: Vec3, dt: number,
): ChainState {
  if (!(dt > 0)) return s;
  const C = FLAIL_CHAIN_SIM;
  const h = 1 / C.stepHz;
  const span = s.acc + dt;
  let steps = Math.floor(span / h + 1e-9);
  let acc = Math.max(0, span - steps * h);
  let capped = false;
  if (steps > C.maxSubsteps) { steps = C.maxSubsteps; acc = 0; capped = true; }
  if (steps === 0) return { ...s, acc };
  const p: M3[] = s.p.map(q => [q[0], q[1], q[2]]);
  const prev: M3[] = s.prev.map(q => [q[0], q[1], q[2]]);
  const a0 = s.anchor;
  const decay = Math.exp(-C.damping * h);
  const g: M3 = [down[0] * C.gravity * h * h, down[1] * C.gravity * h * h, down[2] * C.gravity * h * h];
  const pin = guide >= C.pinAt;
  const pull = pin ? 1 : 1 - Math.exp(-C.guideRate * clamp01(guide) * h);
  const last = N - 1;
  let lastA: M3 = [a0[0], a0[1], a0[2]];
  for (let step = 0; step < steps; step++) {
    const f = Math.min(1, ((step + 1) * h) / span);
    const a: M3 = [a0[0] + (anchor[0] - a0[0]) * f, a0[1] + (anchor[1] - a0[1]) * f, a0[2] + (anchor[2] - a0[2]) * f];
    lastA = a;
    // Verlet for the free nodes.
    for (let i = 1; i < N; i++) {
      const q = p[i]!, o = prev[i]!;
      for (let k = 0; k < 3; k++) {
        const v = (q[k]! - o[k]!) * decay;
        o[k] = q[k]!;
        q[k] = q[k]! + v + g[k]!;
      }
    }
    p[0] = [a[0], a[1], a[2]];
    // The guide: pull (or pin) the ball toward its authored place.
    const b = p[last]!;
    for (let k = 0; k < 3; k++) b[k] = b[k]! + (target[k]! - b[k]!) * pull;
    // Link constraints.
    for (let it = 0; it < C.iterations; it++) {
      for (let i = 0; i < last; i++) {
        const q0 = p[i]!, q1 = p[i + 1]!;
        const w0 = i === 0 ? 0 : 1;
        const w1 = i + 1 === last ? (pin ? 0 : C.ballInvMass) : 1;
        const wsum = w0 + w1;
        if (wsum === 0) continue;
        const dx = q1[0] - q0[0], dy = q1[1] - q0[1], dz = q1[2] - q0[2];
        const d = Math.hypot(dx, dy, dz) || 1e-9;
        const c = (d - linkRest(i)) / d / wsum;
        q0[0] += dx * c * w0; q0[1] += dy * c * w0; q0[2] += dz * c * w0;
        q1[0] -= dx * c * w1; q1[1] -= dy * c * w1; q1[2] -= dz * c * w1;
      }
    }
    if (pin) { b[0] = target[0]; b[1] = target[1]; b[2] = target[2]; }
  }
  const anchorOut: Vec3 = capped ? [anchor[0], anchor[1], anchor[2]] : lastA;
  return { p, prev, anchor: anchorOut, acc };
}
