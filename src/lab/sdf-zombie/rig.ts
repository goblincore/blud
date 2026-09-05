// src/lab/sdf-zombie/rig.ts
import type { Vec3 } from './types';
import { add, cross, dot, len, lerp, normalize, qFromAxisAngle, qFromTo, qRotate, scale, sub } from './vec';

export interface RigPoint { pos: Vec3; prev: Vec3; pinned: boolean }
export interface RigConstraint { a: number; b: number; rest: number; stiffness: number }

/** Elbow limits expressed in the authored upper-arm frame. */
export interface RigBendConstraint {
  root: number;
  mid: number;
  end: number;
  restUpper: Vec3;
  restPole: Vec3;
  /** Optional forward-fold limit in radians, in [π/2, π); 150° for zombies. */
  maxFlex?: number;
}

export interface RigState {
  points: RigPoint[];
  constraints: RigConstraint[];
  /** Authored pose. Points are pulled back toward this every step. */
  restPose: Vec3[];
  bends?: RigBendConstraint[];
  /** Heading of the authored body frame; independent of flinch/rest targets. */
  bodyYaw?: number;
}

/**
 * Stop forbidden extension and excessive flexion while retaining forearm
 * length and permitted recoil. The wrist slides to the allowed boundaries;
 * shoulder and elbow remain where physics put them.
 * Pure so both the impulse path and post-integration callers can use it.
 */
export function constrainRigBends(state: RigState, floorY?: number): RigState {
  let points = state.points;
  for (const bend of state.bends ?? []) {
    const root = points[bend.root]!, mid = points[bend.mid]!, end = points[bend.end]!;
    if (end.pinned) continue;
    const upper = sub(mid.pos, root.pos), fore = sub(end.pos, mid.pos);
    const foreLength = len(fore);
    if (len(upper) < 1e-8 || foreLength < 1e-8) continue;
    // Recoil can move the animation target itself through the wrong side.
    // The stop belongs to the authored arm, never to that transient target.
    // Carry its pole through body yaw and then the upper arm's residual swing.
    const yaw = qFromAxisAngle([0, 1, 0], state.bodyYaw ?? 0);
    const restUpper = qRotate(yaw, bend.restUpper);
    const restPole = qRotate(yaw, bend.restPole);
    const pole = normalize(qRotate(qFromTo(restUpper, normalize(upper)), restPole));
    const normals = [pole];
    if (bend.maxFlex !== undefined) normals.push(sub(scale(normalize(upper), Math.sin(bend.maxFlex)),
      scale(pole, Math.cos(bend.maxFlex))));
    if (normals.every(n => dot(fore, n) >= -1e-9)) continue;
    let dir = normalize(fore);
    // Project onto extension first, then maximum flexion. For our 150°
    // flexion limit the inward normals have positive dot product, so the
    // second projection cannot undo the first. Sideways carry is retained.
    for (const normal of normals) {
      const forbidden = dot(dir, normal);
      if (forbidden >= 0) continue;
      const tangent = sub(dir, scale(normal, forbidden));
      dir = len(tangent) < 1e-8 ? normalize(upper) : normalize(tangent);
    }
    let pos = add(mid.pos, scale(dir, foreLength));
    if (floorY !== undefined && pos[1] < floorY && mid.pos[1] >= floorY) {
      // Floor contact already positioned the elbow above ground. A horizontal
      // forearm in the allowed half-plane satisfies BOTH constraints without
      // shortening the segment or undoing contact by pushing the wrist down.
      const horizontalPole: Vec3 = [pole[0], 0, pole[2]];
      let horizontal: Vec3 = [dir[0], 0, dir[2]];
      const h2 = dot(horizontalPole, horizontalPole);
      if (h2 > 1e-12 && dot(horizontal, horizontalPole) < 0)
        horizontal = sub(horizontal, scale(horizontalPole, dot(horizontal, horizontalPole) / h2));
      if (len(horizontal) < 1e-8) horizontal = cross([0, 1, 0], horizontalPole);
      if (len(horizontal) < 1e-8) horizontal = [1, 0, 0];
      if (normals.some(n => dot(horizontal, n) < -1e-9)) {
        // The horizontal floor fallback must satisfy the flexion stop too.
        // A feasible horizontal wedge has a boundary perpendicular to one
        // of these normals. Pick its closest valid boundary direction.
        const candidates = normals.flatMap(n => {
          const v = normalize(cross([0, 1, 0], n));
          return [v, scale(v, -1)];
        }).filter(v => len(v) > 1e-8 && normals.every(n => dot(v, n) >= -1e-9));
        candidates.sort((a, b) => dot(b, dir) - dot(a, dir));
        if (candidates[0]) horizontal = candidates[0];
      }
      dir = normalize(horizontal);
      pos = add(mid.pos, scale(dir, foreLength));
    }
    // Moving pos without prev would inject another impulse. Keep allowed
    // velocity, remove only the relative velocity driving through the stop.
    let velocity = sub(end.pos, end.prev);
    for (const normal of normals) {
      if (dot(dir, normal) > 1e-7) continue; // this limit is not in contact
      const intoStop = dot(sub(velocity, sub(mid.pos, mid.prev)), normal);
      if (intoStop < 0) velocity = sub(velocity, scale(normal, intoStop));
    }
    if (points === state.points) points = points.slice();
    points[bend.end] = { ...end, pos, prev: sub(pos, velocity) };
  }
  return points === state.points ? state : { ...state, points };
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

  let points = state.points.map((p, i) => {
    if (p.pinned) return { ...p, prev: p.pos };
    const vel = scale(sub(p.pos, p.prev), 1 - opts.damping);
    let next = add(add(p.pos, vel), scale(opts.gravity, dt * dt));
    if (st > 0) next = lerp(next, state.restPose[i]!, st);
    return { pos: sanitize(next, p.pos), prev: p.pos, pinned: false };
  });

  for (let it = 0; it < opts.iterations; it++) {
    for (const c of state.constraints) {
      const pa = points[c.a]!, pb = points[c.b]!;
      const delta = sub(pb.pos, pa.pos);
      const dist = len(delta);
      if (dist === 0) continue;
      const correction = scale(delta, ((dist - c.rest) / dist) * c.stiffness * 0.5);
      if (!pa.pinned) pa.pos = add(pa.pos, correction);
      if (!pb.pinned) pb.pos = sub(pb.pos, correction);
    }
    points = constrainRigBends({ ...state, points }).points;
  }

  return constrainRigBends({ ...state, points });
}

/** Guards against NaN/Infinity poisoning the whole rig after an extreme impulse. */
function sanitize(v: Vec3, fallback: Vec3): Vec3 {
  const ok = v.every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
  return ok ? v : fallback;
}
