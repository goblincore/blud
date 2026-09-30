// src/lab/sdf-zombie/webgpu/flail-blur.ts
//
// FLAIL SWING SHUTTER BLUR — THE PURE HALF (spike-flail plan Task 28, spec §14.1 item 6).
//
// The ball and chain are smeared by the SAME layer that smears flying gibs
// (gib-shutter-layer.ts): selected meshes leave the clean base pass, are drawn
// alone, and a rotation-aware motion seed (gib-motion-blur.ts) is resolved over
// the frame. That layer reads a gib's physics `Chunk`, and of it only
// pos/vel/quat/angVel/radius/squash/support. The flail has no Chunk: the ball
// and the chain are DRAWN from the chain sim (flail-chain.ts). This module
// turns two consecutive drawn frames into Chunk-shaped motion states (ported
// from the scrapped censer's censer-blur.ts, commit df387f9fb^):
//
//   vel    = (pos − prevPos) / dt
//   angVel = SWING-ONLY (cross(axisPrev, axisCur)): the ball is drawn by
//            pointing its ring at the chain, a link along the chain's tangent;
//            the drawn twist about that axis is arbitrary, so it carries no
//            motion (setFromUnitVectors(Y, d) is singular at d = −Y, exactly
//            how a chain hangs).
//
// THE CHAIN is one InstancedMesh; it is offered once PER SIM SEGMENT (node k →
// k+1), each with that segment's own motion, because a floppy chain's knot end
// moves at hand speed and its ring end at ball speed, and the segments between
// bend and whip independently: a single state would under- or over-streak most
// of it.
//
// `dt` here is the UNSCALED frame step (the time the viewer saw pass), while
// the positions come from the sim stepped on the SCALED step: during the
// hit-stop freeze the chain barely moves, so its speed — and the smear — falls
// to nothing by itself; in the slow tail it is slowed, exactly as seen.
//
// No three import. Plain data in, plain data out.

import type { Chunk, SupportSphere } from '../gib-chunks';
import type { Vec3 } from '../types';
import type { Quat } from '../vec';

export const FLAIL_BLUR = {
  /** The blur engages only while a swing is live AND the drawn ball moves at
   *  least this fast (camera-relative, m/s, over the unscaled step). The rest
   *  sway is ~0.07 m/s; a swing's approach and follow-through run 8–20 m/s. */
  minBallSpeedMps: 4,
  /** The BALL's motion gain. The layer's exposure is a fixed 44 ms (shutter-game-layer.ts), and the ball
   *  sweeps 150–600 px per 60 Hz frame mid-swing: at 1.0 (the physical smear) the ball dissolved into a
   *  faint speckled band and vanished (look pass, 2026-09-29: 0.3 and 0.12 the same), at 0.06 it keeps a
   *  readable core with a clear trail back along its path. The fastest on-screen frame (the strike approach)
   *  is still a translucent slab: that is the motion. */
  ballGain: 0.06,
  /** The CHAIN's motion gain: the links are ~1.5 cm, a few px wide, so any real smear dilutes them to
   *  nothing (0.3 was a faint band). At 0.08 they soften along the swing and stay a chain. */
  chainGain: 0.08,
  /** Carry the ball's spin (its ring axis swinging) into the smear. Off: the ring axis's swing is mostly the
   *  ball ORBITING, which its translation already carries, and the rotating probe set (9 small probes)
   *  broke the smear into blocks where one full-radius probe gives a clean streak. */
  ballSpin: false,
  /** A chain segment's probe radius never drops below a link's size. */
  linkMinRadius: 0.01,
} as const;

/** Stream ids for flail subjects: far above any gib/sprite id (the old censer's range). */
export const FLAIL_BLUR_ID_BASE = 1_000_000;
export const FLAIL_BLUR_IDS = {
  ball: FLAIL_BLUR_ID_BASE,
  /** + segment index. */
  chain: FLAIL_BLUR_ID_BASE + 16,
} as const;

/** Blur only while a swing is live and the ball is really moving. */
export function flailBlurActive(phase: string, ballSpeedMps: number, min: number = FLAIL_BLUR.minBallSpeedMps): boolean {
  return phase === 'swing' && Number.isFinite(ballSpeedMps) && ballSpeedMps >= min;
}

function axisPerp(y: Vec3): Vec3 {
  // A reference that is never near-parallel to y: world Z unless y is close to it.
  const ref: Vec3 = Math.abs(y[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x: Vec3 = [y[1] * ref[2] - y[2] * ref[1], y[2] * ref[0] - y[0] * ref[2], y[0] * ref[1] - y[1] * ref[0]];
  const n = Math.hypot(x[0], x[1], x[2]) || 1;
  return [x[0] / n, x[1] / n, x[2] / n];
}

/**
 * SWING-ONLY angular velocity of an axis turning from `a` to `b` over `dt`:
 * normalize(a × b) · angle(a, b) / dt. No twist about the axis. Parallel axes
 * (or dt <= 0) give zero; an exact reversal picks a stable perpendicular.
 */
export function swingAngularVelocity(a: Vec3, b: Vec3, dt: number): Vec3 {
  if (!(dt > 0) || !Number.isFinite(dt)) return [0, 0, 0];
  const na = Math.hypot(a[0], a[1], a[2]), nb = Math.hypot(b[0], b[1], b[2]);
  if (!(na > 1e-12) || !(nb > 1e-12)) return [0, 0, 0];
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const sinN = Math.hypot(cx, cy, cz);
  const cosN = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const angle = Math.atan2(sinN, cosN);
  if (!(angle > 1e-12)) return [0, 0, 0];
  if (sinN > 1e-12 * na * nb) {
    const k = angle / (sinN * dt);
    return [cx * k, cy * k, cz * k];
  }
  const p = axisPerp([a[0] / na, a[1] / na, a[2] / na]);
  return [p[0] * angle / dt, p[1] * angle / dt, p[2] * angle / dt];
}

/**
 * A STABLE frame whose local +Y is `axis` (the probes only need the axis on
 * +Y). Built from a fixed world reference, so it is smooth through straight
 * down, where the chain hangs.
 */
export function axisQuat(axis: Vec3): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(n > 1e-12)) return [0, 0, 0, 1];
  const y: Vec3 = [axis[0] / n, axis[1] / n, axis[2] / n];
  const x = axisPerp(y);
  const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const qn = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / qn, q[1] / qn, q[2] / qn, q[3] / qn];
}

/** A zeroed, poolable Chunk-shaped state (fields the blur never reads are neutral). */
export function makeMotionState(): Chunk {
  return {
    limb: 'torso', kind: 'gob',
    pos: [0, 0, 0], vel: [0, 0, 0], radius: 0, squash: 0,
    quat: [0, 0, 0, 1], angVel: [0, 0, 0], longAxis: [0, 1, 0],
    support: [{ c: [0, 0, 0], r: 0 }],
  };
}

/**
 * Write a motion state IN PLACE: position `cur`, velocity from the position
 * delta scaled by `gain`, the given orientation, and `angVel` scaled by `gain`.
 * `support` defaults to one origin sphere of `radius`.
 */
export function setMotionState(
  out: Chunk, prevPos: Vec3, curPos: Vec3, quat: Quat, angVel: Vec3, dt: number, radius: number,
  gain = 1, support?: readonly SupportSphere[],
): Chunk {
  const g = Number.isFinite(gain) ? Math.max(0, gain) : 0;
  const ok = dt > 0 && Number.isFinite(dt);
  const p = out.pos as unknown as number[], v = out.vel as unknown as number[];
  const q = out.quat as unknown as number[], w = out.angVel as unknown as number[];
  p[0] = curPos[0]; p[1] = curPos[1]; p[2] = curPos[2];
  v[0] = ok ? (g * (curPos[0] - prevPos[0])) / dt : 0;
  v[1] = ok ? (g * (curPos[1] - prevPos[1])) / dt : 0;
  v[2] = ok ? (g * (curPos[2] - prevPos[2])) / dt : 0;
  q[0] = quat[0]; q[1] = quat[1]; q[2] = quat[2]; q[3] = quat[3];
  w[0] = ok ? g * angVel[0] : 0; w[1] = ok ? g * angVel[1] : 0; w[2] = ok ? g * angVel[2] : 0;
  out.radius = radius;
  out.squash = 0;
  if (support) {
    out.support = support;
  } else {
    const s0 = out.support.length === 1 ? out.support[0] as SupportSphere : undefined;
    if (s0 && s0.c[0] === 0 && s0.c[1] === 0 && s0.c[2] === 0) (s0 as { r: number }).r = radius;
    else out.support = [{ c: [0, 0, 0], r: radius }];
  }
  return out;
}

/**
 * The BALL: its centre moved `prev → cur`, its ring axis (ball → ring node)
 * turned `axisPrev → axisCur`, over the unscaled `dt`.
 */
export function ballMotionState(
  out: Chunk, prev: Vec3, cur: Vec3, axisPrev: Vec3, axisCur: Vec3, dt: number, radius: number,
  gain: number = FLAIL_BLUR.ballGain,
): Chunk {
  return setMotionState(out, prev, cur, axisQuat(axisCur), swingAngularVelocity(axisPrev, axisCur, dt), dt, radius, gain);
}

/**
 * The CHAIN as segments between consecutive drawn nodes (`segments` of them,
 * nodes 0 … segments): segment k's centre is its midpoint, its axis runs node
 * k → k+1, its velocity is its midpoint's motion and its spin the axis's
 * swing, all scaled by `gain`. Radius is half the segment's length (never
 * below a link), with support spheres at both ends along local +Y so the
 * rotating probe set tiles the segment end to end. Written into `pool`
 * (grown as needed); returns the pool trimmed to `segments`.
 */
export function chainSegmentStates(
  prev: readonly Vec3[], cur: readonly Vec3[], segments: number, dt: number,
  gain: number = FLAIL_BLUR.chainGain, pool: Chunk[] = [],
): Chunk[] {
  const count = Math.max(0, Math.min(segments, cur.length - 1, prev.length - 1));
  for (let k = 0; k < count; k++) {
    const a0 = prev[k]!, b0 = prev[k + 1]!, a1 = cur[k]!, b1 = cur[k + 1]!;
    const midPrev: Vec3 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2, (a0[2] + b0[2]) / 2];
    const midCur: Vec3 = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2, (a1[2] + b1[2]) / 2];
    const axPrev: Vec3 = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]];
    const axCur: Vec3 = [b1[0] - a1[0], b1[1] - a1[1], b1[2] - a1[2]];
    const radius = Math.max(FLAIL_BLUR.linkMinRadius, Math.hypot(axCur[0], axCur[1], axCur[2]) / 2);
    const st = pool[k] ?? (pool[k] = makeMotionState());
    const sup = st.support.length === 2 ? st.support as SupportSphere[] : [
      { c: [0, 0, 0] as Vec3, r: FLAIL_BLUR.linkMinRadius }, { c: [0, 0, 0] as Vec3, r: FLAIL_BLUR.linkMinRadius },
    ];
    (sup[0]!.c as unknown as number[])[1] = -radius;
    (sup[1]!.c as unknown as number[])[1] = radius;
    setMotionState(st, midPrev, midCur, axisQuat(axCur), swingAngularVelocity(axPrev, axCur, dt), dt, radius, gain, sup);
  }
  pool.length = count;
  return pool;
}
