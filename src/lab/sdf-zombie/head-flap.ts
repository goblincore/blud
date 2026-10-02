// src/lab/sdf-zombie/head-flap.ts
//
// TORN SCALP FLAPS (slug head burst, spec §6.4). Pure. One flap = a short verlet chain pinned at a hinge on the
// crater rim, sprung toward a REST direction (out of the crater and away from its centre) so it hangs open like a petal
// instead of going limp, with gravity and a kick along the shot. Same scheme as head-eye.ts's stalk. It draws as three
// prims — two flesh segments and a bone-tan underside strip — so the prim COUNT is constant (an attached piece's rows
// are packed once at attach).
import { GORE_COLORS, prim } from './head-pop';
import type { Primitive, Vec3 } from './types';

export const FLAP = {
  nodes: 3,
  /** Chain length, m. */
  len: 0.1,
  stepHz: 120,
  damping: 4,
  gravity: 9.81,
  /** Spring toward the rest pose (1/s²): gravity sags the tip g/stiff ≈ 2.5 cm. */
  stiff: 400,
  iterations: 4,
  /** Flesh capsule radius at the hinge and at the tip, m. */
  r0: 0.014,
  r1: 0.008,
  /** The underside strip's radius share and its offset toward the head (m). */
  under: 0.55,
  underOffset: 0.006,
  kickSpeed: 1.8,
} as const;

/** Torn scalp: raw meat, darker than the thrown flesh bits' MEAT (their bright red read as orange tubes on the head
 *  capture, look loop 2026-10-02). */
const FLAP_FLESH: Vec3 = [0.52, 0.07, 0.05];

export interface FlapState { p: Vec3[]; prev: Vec3[]; acc: number }

const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };

/** Nodes laid along `rest` from `hinge` at the link length; `kick` (a direction) at `speed` m/s is folded into the
 *  verlet history of every node but the pinned first. */
export function makeFlap(hinge: Vec3, rest: Vec3, kick: Vec3, speed: number): FlapState {
  const u = unit(rest), kd = Math.hypot(kick[0], kick[1], kick[2]) > 1e-9 ? unit(kick) : ([0, 0, 0] as Vec3);
  const link = FLAP.len / (FLAP.nodes - 1);
  const p: Vec3[] = [], prev: Vec3[] = [];
  for (let k = 0; k < FLAP.nodes; k++) {
    const q: Vec3 = [hinge[0] + u[0] * link * k, hinge[1] + u[1] * link * k, hinge[2] + u[2] * link * k];
    p.push(q);
    const kick1 = k === 0 ? 0 : speed / FLAP.stepHz;
    prev.push([q[0] - kd[0] * kick1, q[1] - kd[1] * kick1, q[2] - kd[2] * kick1]);
  }
  return { p, prev, acc: 0 };
}

export function stepFlap(s: FlapState, hinge: Vec3, rest: Vec3, dt: number): FlapState {
  const { nodes, len, stepHz, damping, gravity, stiff, iterations } = FLAP;
  const h = 1 / stepHz, link = len / (nodes - 1), damp = Math.exp(-damping * h), u = unit(rest);
  const p = s.p.map(v => [...v] as [number, number, number]);
  const prev = s.prev.map(v => [...v] as [number, number, number]);
  let acc = s.acc + (Number.isFinite(dt) && dt > 0 ? dt : 0);
  while (acc >= h) {
    acc -= h;
    for (let k = 1; k < nodes; k++) {
      const q = p[k]!, o = prev[k]!;
      const tx = hinge[0] + u[0] * link * k, ty = hinge[1] + u[1] * link * k, tz = hinge[2] + u[2] * link * k;
      const nx = q[0] + (q[0] - o[0]) * damp + stiff * (tx - q[0]) * h * h;
      const ny = q[1] + (q[1] - o[1]) * damp + stiff * (ty - q[1]) * h * h - gravity * h * h;
      const nz = q[2] + (q[2] - o[2]) * damp + stiff * (tz - q[2]) * h * h;
      o[0] = q[0]; o[1] = q[1]; o[2] = q[2];
      q[0] = nx; q[1] = ny; q[2] = nz;
    }
    p[0] = [hinge[0], hinge[1], hinge[2]]; prev[0] = [hinge[0], hinge[1], hinge[2]];
    for (let it = 0; it < iterations; it++) {
      for (let k = 0; k < nodes - 1; k++) {
        const a = p[k]!, b = p[k + 1]!;
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const l = Math.hypot(dx, dy, dz) || 1e-9;
        const e = (l - link) / l;
        const wa = k === 0 ? 0 : 0.5, wb = k === 0 ? 1 : 0.5;
        a[0] += dx * e * wa; a[1] += dy * e * wa; a[2] += dz * e * wa;
        b[0] -= dx * e * wb; b[1] -= dy * e * wb; b[2] -= dz * e * wb;
      }
      p[0] = [hinge[0], hinge[1], hinge[2]];
    }
    // Follow-the-leader: makes every link exact.
    for (let k = 1; k < nodes; k++) {
      const a = p[k - 1]!, b = p[k]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const l = Math.hypot(dx, dy, dz) || 1e-9;
      b[0] = a[0] + dx / l * link; b[1] = a[1] + dy / l * link; b[2] = a[2] + dz / l * link;
    }
  }
  p[0] = [hinge[0], hinge[1], hinge[2]];
  return { p, prev, acc };
}

/** The flap as 3 additive prims: two tapered flesh capsules and a bone-tan strip along the first segment, pushed
 *  `underOffset` toward the head (`inward`, world unit) so the torn underside reads as skull. */
export function flapPrims(s: FlapState, inward: Vec3): Primitive[] {
  const n = s.p.length, out: Primitive[] = [];
  for (let k = 0; k < n - 1; k++) {
    const t0 = k / (n - 1), t1 = (k + 1) / (n - 1);
    out.push(prim(s.p[k]!, s.p[k + 1]!, FLAP.r0 + (FLAP.r1 - FLAP.r0) * t0, FLAP_FLESH,
      { radiusB: FLAP.r0 + (FLAP.r1 - FLAP.r0) * t1, gloss: 0.55, blendK: 0.004, op: 'add' }));
  }
  const off: Vec3 = [inward[0] * FLAP.underOffset, inward[1] * FLAP.underOffset, inward[2] * FLAP.underOffset];
  const a = s.p[0]!, b = s.p[1]!;
  out.push(prim([a[0] + off[0], a[1] + off[1], a[2] + off[2]], [b[0] + off[0], b[1] + off[1], b[2] + off[2]],
    FLAP.r0 * FLAP.under, GORE_COLORS.bone, { radiusB: FLAP.r1 * FLAP.under * 1.4, gloss: 0.3, blendK: 0.002, op: 'add' }));
  return out;
}
