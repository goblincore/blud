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

/** A limb segment (two rig points) the head capsule keeps out. */
export interface RigKeepOutLimb {
  a: number;
  b: number;
  /** Required distance between this segment's axis and the head capsule's axis
   *  (m): the head radius plus the limb's, capped at the REST distance so a
   *  body authored with an arm already touching its head keeps its rest pose. */
  clearance: number;
}

/**
 * THE HEAD KEEP-OUT: a capsule along the live skull axis (pivot -> tip) that
 * the arms may not enter. The rig had distance constraints and an elbow stop
 * and nothing between a limb and the head, so a swinging forearm passed
 * straight through the face (zombie hook/sweep: 7-9 cm deep; a flail hit's
 * stagger shoves the hands up through it too). The limbs yield; the head never
 * does -- it is placed by the neck and its own cone clamp.
 */
export interface RigHeadKeepOut {
  /** Rig point of the neck pivot and of the skull tip: the capsule's axis. */
  pivot: number;
  tip: number;
  /** The capsule's end CENTRES, metres along pivot -> tip from the pivot. */
  t0: number;
  t1: number;
  radius: number;
  limbs: RigKeepOutLimb[];
}

export interface RigState {
  points: RigPoint[];
  constraints: RigConstraint[];
  /** Authored pose. Points are pulled back toward this every step. */
  restPose: Vec3[];
  /** Animated weight-bearing joints that must not spring away from contact. */
  posePins?: readonly number[];
  bends?: RigBendConstraint[];
  /** Heading of the authored body frame; independent of flinch/rest targets. */
  bodyYaw?: number;
  /** Fallen structural actors rotate the skull with the full rig, not an upright gaze cone. */
  headFollowsRig?: boolean;
  /** THE JAW's gape (rad, jaw.ts), from MotionFrame.jawGape: rig-bind opens
   *  the `on jaw` prims by it. Absent = shut. An explicit scalar rather than
   *  a read of the jaw point: the pivot moves ~2.5 cm a step at a walk, and
   *  an angle measured off a point one step stale is off by ~0.2 rad. */
  jawGape?: number;
  /** Per-point multiplier on the rest pull (absent = 1 everywhere). A CLOTH
   *  pendulum point (the cultist's `hem`) springs to its target far more
   *  loosely than a joint, so it lags and overshoots instead of snapping. */
  restScale?: readonly number[];
  /** WIND on cloth: an acceleration (m/s^2, world) added to every point whose
   *  restScale is below 1 — the cloth pendulums, never a joint. Absent = no
   *  wind. The host modulates it (gusts); the rig just integrates it. */
  clothForce?: Vec3;
  /** Arms stay out of the head (absent = no collision). */
  headKeepOut?: RigHeadKeepOut;
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

/** Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time
 *  Collision Detection 5.1.9): the parameters s, t in [0,1] along each. */
export function closestSegmentPoints(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { s: number; t: number } {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  if (a <= 1e-12 && e <= 1e-12) return { s: 0, t: 0 };
  let s: number, t: number;
  if (a <= 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = dot(d1, d2), denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  return { s, t };
}

/** The head capsule's end centres in the CURRENT pose, or null when the skull
 *  is degenerate. */
export function headCapsule(points: readonly RigPoint[], ko: RigHeadKeepOut): [Vec3, Vec3] | null {
  const pv = points[ko.pivot]!.pos, tp = points[ko.tip]!.pos;
  const axis = sub(tp, pv);
  if (len(axis) < 1e-6) return null;
  const u = normalize(axis);
  return [add(pv, scale(u, ko.t0)), add(pv, scale(u, ko.t1))];
}

/**
 * Push every kept-out limb segment out of the head capsule. Position-based:
 * the limb's ends move by their share of the penetration, and `prev` moves with
 * them so the correction injects no velocity (a limb pressed against the head
 * slides along it instead of bouncing off). Pinned points do not move.
 */
export function applyHeadKeepOut(points: RigPoint[], ko: RigHeadKeepOut | undefined): RigPoint[] {
  if (!ko || ko.limbs.length === 0) return points;
  const cap = headCapsule(points, ko);
  if (!cap) return points;
  let out = points;
  for (const limb of ko.limbs) {
    const A = out[limb.a]!, B = out[limb.b]!;
    const { s, t } = closestSegmentPoints(A.pos, B.pos, cap[0], cap[1]);
    const cl = add(A.pos, scale(sub(B.pos, A.pos), s));
    const ch = add(cap[0], scale(sub(cap[1], cap[0]), t));
    const delta = sub(cl, ch);
    const dist = len(delta);
    if (dist >= limb.clearance) continue;
    // Axes crossing (dist ~ 0) has no normal: go outward from the head axis at
    // the limb's midpoint, else sideways.
    let n: Vec3;
    if (dist > 1e-6) n = scale(delta, 1 / dist);
    else {
      const mid = scale(add(A.pos, B.pos), 0.5);
      const away = sub(mid, ch);
      n = len(away) > 1e-6 ? normalize(away) : [1, 0, 0];
    }
    const push = limb.clearance - dist;
    // Share of the correction per end (PBD weights); a pinned end takes none.
    // A weight is floored so a closest point right at the fixed end cannot
    // demand an unbounded push from the other.
    let wA = !A.pinned ? 1 - s : 0;
    let wB = !B.pinned ? s : 0;
    if (wA > 0) wA = Math.max(wA, 0.25);
    if (wB > 0) wB = Math.max(wB, 0.25);
    const denom = wA * wA + wB * wB;
    if (denom < 1e-9) continue;
    if (out === points) out = points.slice();
    if (wA > 0) { const d = scale(n, (push * wA) / denom); out[limb.a] = { ...A, pos: add(A.pos, d), prev: add(A.prev, d) }; }
    if (wB > 0) { const d = scale(n, (push * wB) / denom); out[limb.b] = { ...B, pos: add(B.pos, d), prev: add(B.prev, d) }; }
  }
  return out;
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
  const frames = Math.max(dt, 1e-4) * 60;
  const st = 1 - Math.pow(1 - opts.restStiffness, frames);
  const stOf = (i: number): number => {
    const k = state.restScale?.[i];
    return k === undefined || k === 1 ? st : 1 - Math.pow(1 - opts.restStiffness * k, frames);
  };

  let points = state.points.map((p, i) => {
    if (state.posePins?.includes(i)) return { pos: state.restPose[i]!, prev: state.restPose[i]!, pinned: true };
    if (p.pinned) return { ...p, prev: p.pos };
    const vel = scale(sub(p.pos, p.prev), 1 - opts.damping);
    let next = add(add(p.pos, vel), scale(opts.gravity, dt * dt));
    if (state.clothForce && (state.restScale?.[i] ?? 1) < 1) next = add(next, scale(state.clothForce, dt * dt));
    const sti = stOf(i);
    if (sti > 0) next = lerp(next, state.restPose[i]!, sti);
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
    points = applyHeadKeepOut(points, state.headKeepOut);
    points = constrainRigBends({ ...state, points }).points;
  }

  const bent = constrainRigBends({ ...state, points });
  // Last word: whatever the bend stop moved, an arm is never left in the head.
  const result = state.headKeepOut ? { ...bent, points: applyHeadKeepOut(bent.points, state.headKeepOut) } : bent;
  if (!state.posePins?.length) return result;
  return { ...result, points: result.points.map((p, i) => state.posePins!.includes(i)
    ? { ...p, pinned: state.points[i]!.pinned } : p) };
}

/** Guards against NaN/Infinity poisoning the whole rig after an extreme impulse. */
function sanitize(v: Vec3, fallback: Vec3): Vec3 {
  const ok = v.every(n => Number.isFinite(n) && Math.abs(n) < 1e6);
  return ok ? v : fallback;
}
