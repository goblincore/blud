// src/lab/sdf-zombie/rig.ts
import type { Vec3 } from './types';
import { add, len, lerp, scale, sub } from './vec';

export interface RigPoint { pos: Vec3; prev: Vec3; pinned: boolean }
export interface RigConstraint { a: number; b: number; rest: number; stiffness: number }

export interface RigState {
  points: RigPoint[];
  constraints: RigConstraint[];
  /** Authored pose. Points are pulled back toward this every step. */
  restPose: Vec3[];
}

export interface StepOpts {
  gravity: Vec3;
  /** Velocity bleed per step, 0..1. */
  damping: number;
  iterations: number;
  /**
   * Pull back toward restPose, 0..1 per 1/60 s. Borrowed from goober-test's
   * Rope: without it the chain has nothing to return to and gravity drags the
   * silhouette away permanently. With it, an impulse stretches the limb and it
   * springs home.
   */
  restStiffness: number;
}

export function makeRig(
  points: { pos: Vec3; pinned: boolean }[],
  constraints: RigConstraint[],
): RigState {
  return {
    points: points.map(p => ({ pos: p.pos, prev: p.pos, pinned: p.pinned })),
    constraints,
    restPose: points.map(p => p.pos),
  };
}

/**
 * One Verlet step: integrate, pull toward the rest pose, then relax
 * constraints. Returns new state; the input is untouched, which keeps this
 * trivially testable at ~20 points.
 */
export function stepRig(state: RigState, dt: number, opts: StepOpts): RigState {
  // Frame-rate independent rest pull, same shaping as goober-test's Rope.
  const st = 1 - Math.pow(1 - opts.restStiffness, Math.max(dt, 1e-4) * 60);

  const points = state.points.map((p, i) => {
    if (p.pinned) return { ...p, prev: p.pos };
    const vel = scale(sub(p.pos, p.prev), 1 - opts.damping);
    let next = add(add(p.pos, vel), scale(opts.gravity, dt * dt));
    if (st > 0) next = lerp(next, state.restPose[i]!, st);
    return { pos: sanitize(next, p.pos), prev: p.pos, pinned: false };
  });

  for (let it = 0; it < opts.iterations; it++)
    for (const c of state.constraints) {
      const pa = points[c.a]!, pb = points[c.b]!;
      const delta = sub(pb.pos, pa.pos);
      const dist = len(delta);
      if (dist === 0) continue;
      const correction = scale(delta, ((dist - c.rest) / dist) * c.stiffness * 0.5);
      if (!pa.pinned) pa.pos = add(pa.pos, correction);
      if (!pb.pinned) pb.pos = sub(pb.pos, correction);
    }

  return { points, constraints: state.constraints, restPose: state.restPose };
}

/** Guards against NaN/Infinity poisoning the whole rig after an extreme impulse. */
function sanitize(v: Vec3, fallback: Vec3): Vec3 {
  const ok = v.every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
  return ok ? v : fallback;
}
