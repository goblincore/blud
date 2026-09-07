// src/lab/sdf-zombie/ik.ts
//
// Pure FABRIK inverse kinematics over point chains — the same representation
// the verlet rig (rig.ts) already runs. FABRIK is iterative POSITION
// adjustment: a chain of points joined by fixed segment lengths is solved by
// walking the end effector onto the goal (forward pass), then walking the
// root back to its anchor (backward pass), preserving every segment length
// exactly, until the end effector converges. No rotations, no quaternions.
//
// Two consumers, all PURE functions of their inputs — no Date.now, no
// Math.random (determinism is load-bearing; the solver runs every frame):
//
//  - Foot plant (stepPlant / solvePlantedLeg): during the gait's stance phase
//    the foot LOCKS to its stored floor contact and a 2-bone hip→knee→ankle
//    solve keeps it there while the root translates. Swing releases the lock
//    and the gait oscillator carries the foot to the next plant.
//  - Head look-at (stepAim): 1-2 segment aim at a world target with clamped
//    max yaw/pitch off the rest forward and rate-limited (damped) tracking.
//
// Axes: +y up. Yaw follows the wander heading convention (0 = facing +z,
// positive = clockwise seen from above — see wander.ts). Everything here is
// world space; the wiring rotates body-local gait offsets into world space
// (gait.ts rotateYaw) before solving.
import type { Vec3 } from './types';
import { add, cross, dot, len, normalize, qFromAxisAngle, qRotate, scale, sub } from './vec';

const Z: Vec3 = [0, 0, 0];
const UP: Vec3 = [0, 1, 0];

/** All IK knobs in one place — the wiring hands these to the solvers. */
export const IK_TUNING = {
  /** FABRIK iteration cap per solve. */
  iterations: 8,
  /** Converged when the end effector sits within this many metres of the target. */
  epsilon: 0.001,
  /** Head look-at: max yaw off the rest forward (rad). */
  headMaxYaw: 0.85,
  /** Head look-at: max pitch off the rest forward (rad). */
  headMaxPitch: 0.5,
  /** Head look-at: damped tracking turn rate (rad/s). */
  headTurnRate: 2.4,
  /** Pole bias deadband (m): a mid joint this close to the root→end axis on
   *  the WRONG side is left alone — a near-straight chain reads neutral, not
   *  "bent", and the AUTHORED rest knee sits ~1 cm behind the hip→ankle
   *  line (the feet drift +z), so without the deadband the bias would
   *  fight the authored pose and break bit-exact idle frames. The cow-knee
   *  the bias exists to kill was 0.21 m — an order of magnitude out. */
  poleDeadband: 0.02,
} as const;

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

// ---------------------------------------------------------------------------
// solveChain — the raw FABRIK solver.
// ---------------------------------------------------------------------------

export interface SolveOpts {
  /** Max FABRIK iterations. */
  iterations: number;
  /** Stop when the end effector is within this distance of the target (m). */
  epsilon: number;
}

/**
 * Classic FABRIK: forward pass walks the end effector onto the target,
 * backward pass re-anchors the root, repeat until the end effector converges
 * or the iteration cap is hit. Segment lengths are preserved exactly every
 * pass (FABRIK's defining property) and the input chain is untouched.
 *
 * Unreachable targets (farther than the chain's total length): the chain
 * extends straight from the root toward the target — the standard FABRIK
 * treatment. Targets closer than the chain can fold converge to a folded
 * pose; degenerate zero-length segments collapse safely (no NaN).
 *
 * The root point never moves: the backward pass always restores points[0] to
 * its input position, so body-owned anchors (hip, shoulder, neck) stay put.
 */
export function solveChain(points: Vec3[], lengths: readonly number[], target: Vec3, opts: SolveOpts): Vec3[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [[target[0], target[1], target[2]]];
  if (lengths.length !== n - 1) {
    throw new Error(`solveChain: ${n} points need ${n - 1} lengths, got ${lengths.length}`);
  }

  const root = points[0]!;
  const total = lengths.reduce((a, b) => a + b, 0);
  const toTarget = sub(target, root);
  const dist = len(toTarget);

  // Unreachable — straighten the chain from the root toward the target.
  if (dist > total) {
    const dir = dist === 0 ? Z : scale(toTarget, 1 / dist);
    const out: Vec3[] = new Array(n);
    out[0] = [root[0], root[1], root[2]];
    for (let i = 1; i < n; i++) out[i] = add(out[i - 1]!, scale(dir, lengths[i - 1]!));
    return out;
  }

  const pts: Vec3[] = points.map(p => [p[0], p[1], p[2]]);
  for (let it = 0; it < opts.iterations; it++) {
    // Forward pass: end effector onto the target, then each joint toward it
    // (point i lands at length[i] from point i+1, on its own side).
    pts[n - 1] = [target[0], target[1], target[2]];
    for (let i = n - 2; i >= 0; i--) {
      const dir = normalize(sub(pts[i]!, pts[i + 1]!));
      pts[i] = add(pts[i + 1]!, scale(dir, lengths[i]!));
    }
    // Backward pass: root back onto its anchor.
    pts[0] = [root[0], root[1], root[2]];
    for (let i = 1; i < n; i++) {
      const dir = normalize(sub(pts[i]!, pts[i - 1]!));
      pts[i] = add(pts[i - 1]!, scale(dir, lengths[i - 1]!));
    }
    if (len(sub(pts[n - 1]!, target)) < opts.epsilon) break;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Pole bias — which SIDE of a chain's root→end axis the middle joint bows to.
// ---------------------------------------------------------------------------

/**
 * Pole bias for a 2-bone chain: FABRIK preserves the fold side of its start
 * guess, so from a near-straight start the knee/elbow folds to whichever side
 * numerical drift picks — and stays there (owner playtest: a knee solved
 * 0.21 m BEHIND the hip→ankle axis, the "cow standing up" walk).
 *
 * If `mid` lies MATERIALLY on the wrong side of the root→end axis —
 * dot(mid − axis, pole) < −IK_TUNING.poleDeadband — it is REFLECTED across
 * the axis to the pole side. Reflection across the line preserves mid's
 * distance to both root and end exactly (both sit on the axis), so the
 * solved segment lengths and the end effector are untouched; only the fold
 * side flips. A mid already on the pole side, exactly on the axis, or
 * within the deadband of it (a near-straight chain reads neutral — and the
 * authored rest pose stays bit-identical) is returned untouched. Pure and
 * deterministic.
 *
 * Conventions (body-local, matching gait.ts's axes): knees bow FORWARD — the
 * wiring passes the body's world forward (headingDir(bodyYaw)); elbows bow
 * DOWN — the wiring passes world down ([0,-1,0], yaw-invariant).
 */
export function poleReflect(root: Vec3, mid: Vec3, end: Vec3, pole: Vec3): Vec3 {
  const axis = sub(end, root);
  const aa = dot(axis, axis);
  if (aa < 1e-12) return mid; // degenerate axis — nothing to reflect across
  const t = dot(sub(mid, root), axis) / aa;
  const onAxis = add(root, scale(axis, t));
  const off = sub(mid, onAxis);
  if (dot(off, pole) >= -IK_TUNING.poleDeadband) return mid;
  return sub(onAxis, off); // 2*onAxis - mid: the mirror image across the line
}

/** Exact two-bone hinge for an authored floor contact. Unlike an iterative
 * solve seeded from a nearly straight clip pose, flexion is determined by
 * the contact geometry, and a reachable ankle has no convergence drift. */
export function solveHingeLeg(hip: Vec3, target: Vec3, lengths: readonly [number, number], pole: Vec3): { knee: Vec3; foot: Vec3 } {
  const [a, b] = lengths;
  if (a + b < 1e-9) return { knee: hip, foot: hip };
  const delta = sub(target, hip);
  const distance = len(delta);
  const axis: Vec3 = distance > 1e-9 ? scale(delta, 1 / distance) : [0, -1, 0];
  const d = clamp(distance, Math.max(1e-9, Math.abs(a - b)), a + b);
  const along = (a * a - b * b + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  let forward = sub(pole, scale(axis, dot(pole, axis)));
  if (len(forward) < 1e-9) forward = cross(axis, Math.abs(axis[0]) < .9 ? [1, 0, 0] : UP);
  return {
    knee: add(add(hip, scale(axis, along)), scale(normalize(forward), height)),
    foot: distance >= Math.abs(a - b) && distance <= a + b ? target : add(hip, scale(axis, d)),
  };
}

// ---------------------------------------------------------------------------
// Foot plant.
// ---------------------------------------------------------------------------

/** Stance/swing phase — driven by the gait's per-leg stance signal. */
export type PlantPhase = 'stance' | 'swing';

/** Pure plant state: which phase the foot is in and where it is locked. */
export interface PlantState {
  phase: PlantPhase;
  /** The floor contact the foot is locked to (world). Meaningful in stance. */
  plantPoint: Vec3;
  /** Seconds the foot has been in the current phase — for release blending. */
  age: number;
}

/** Per-frame input from the gait + rig wiring. */
export interface PlantSignal {
  /** Gait stance flag for this foot (gait.ts pose.stance.legL / legR). */
  stance: boolean;
  /** Current foot position (world) — captured as the floor contact on lock. */
  footPos: Vec3;
  /** Ground height — the lock clamps the plant point to this plane. */
  groundY: number;
}

/** A fresh plant: foot free, no contact yet. */
export function makePlant(): PlantState {
  return { phase: 'swing', plantPoint: Z, age: 0 };
}

/**
 * One plant step: stance edge → capture the floor contact and lock; stance
 * hold → age; swing → release (the last plant point is kept as data). Pure
 * and deterministic.
 */
export function stepPlant(state: PlantState, sig: PlantSignal, dt: number): PlantState {
  if (sig.stance) {
    if (state.phase !== 'stance') {
      return { phase: 'stance', plantPoint: [sig.footPos[0], sig.groundY, sig.footPos[2]], age: 0 };
    }
    return { ...state, age: state.age + Math.max(dt, 0) };
  }
  return state.phase === 'stance' ? { phase: 'swing', plantPoint: state.plantPoint, age: 0 } : state;
}

/**
 * Solves the 2-bone leg hip→knee→ankle for the plant: while planted the ankle
 * stays EXACTLY on the stored contact and FABRIK places the knee as the root
 * translates; while swinging the hints pass through untouched and the gait
 * oscillator owns the foot.
 */
export function solvePlantedLeg(
  hip: Vec3,
  knee: Vec3,
  foot: Vec3,
  plant: PlantState,
  lengths: readonly [number, number],
  opts: SolveOpts,
  pole?: Vec3,
): { knee: Vec3; foot: Vec3 } {
  if (plant.phase !== 'stance') return { knee, foot };
  const chain = solveChain([hip, knee, plant.plantPoint], lengths, plant.plantPoint, opts);
  // Pole bias: the solved knee must bow FORWARD (pole = the body's world
  // forward), never backward — reflection preserves both segment lengths.
  const solvedKnee = pole ? poleReflect(hip, chain[1]!, plant.plantPoint, pole) : chain[1]!;
  return { knee: solvedKnee, foot: plant.plantPoint };
}

// ---------------------------------------------------------------------------
// Head look-at.
// ---------------------------------------------------------------------------

/** Aim knobs — clamped angular offsets off the rest forward, damped tracking. */
export interface AimOpts {
  /** Max yaw off the rest forward (rad). */
  maxYaw: number;
  /** Max pitch off the rest forward (rad). */
  maxPitch: number;
  /** Damped tracking: max turn rate toward the clamped target (rad/s). */
  turnRate: number;
}

/** The aim's damped direction — carries angular state across frames. */
export interface AimState {
  /** Current unit look direction (damped). */
  dir: Vec3;
}

/** A fresh aim looking along the rest forward. */
export function makeAim(restDir: Vec3): AimState {
  return { dir: normalize(restDir) };
}

/** One aim step: clamped target, damped turn, then the solved chain. */
export interface AimStep {
  state: AimState;
  /** The unit direction the chain points along after clamping + damping. */
  dir: Vec3;
  /** Solved chain: points[0] = root, the rest laid out along dir. */
  points: Vec3[];
}

/**
 * Head look-at: aim a 1-2 segment chain (neck→head) at a world target. The
 * desired direction is clamped to ±maxYaw / ±maxPitch off the rest forward,
 * then the current direction is turned toward it at ≤ turnRate rad/s — dt is
 * injected so the tracking is frame-rate independent — and the chain is laid
 * out straight along the result. Pure and deterministic.
 */
export function stepAim(
  state: AimState,
  root: Vec3,
  restDir: Vec3,
  target: Vec3,
  lengths: readonly number[],
  opts: AimOpts,
  dt: number,
): AimStep {
  const toTarget = sub(target, root);
  const dist = len(toTarget);
  const desired = dist < 1e-9 ? normalize(restDir) : scale(toTarget, 1 / dist);
  const clamped = clampDir(desired, normalize(restDir), opts.maxYaw, opts.maxPitch);
  const dir = dampedRotate(state.dir, clamped, opts.turnRate, dt);

  const points: Vec3[] = new Array(lengths.length + 1);
  points[0] = [root[0], root[1], root[2]];
  for (let i = 1; i < points.length; i++) points[i] = add(points[i - 1]!, scale(dir, lengths[i - 1]!));
  return { state: { dir }, dir, points };
}

/**
 * Clamps `dir` to within ±maxYaw / ±maxPitch of `rest` in the (forward,
 * right, up) frame — right = horizontal ⊥ rest, up = rest × right. Yaw sign
 * matches wander.ts: 0 = rest, positive = clockwise seen from above.
 *
 * Exported for rig-bind.ts's rigid head pass: the head cluster's posed
 * rotation is clamped in the SAME cone the look-at uses (IK_TUNING), so the
 * visual head can never nod past what the neck allows — one clamp, two
 * consumers (target-side in stepAim, pose-side in applyRig).
 */
export function clampDir(dir: Vec3, rest: Vec3, maxYaw: number, maxPitch: number): Vec3 {
  const w: Vec3 = len(rest) < 1e-9 ? [0, 0, 1] : normalize(rest);
  let u = normalize(cross(UP, w));
  if (len(u) < 1e-6) u = [1, 0, 0]; // rest straight up/down — arbitrary right
  const v = cross(w, u);
  const yaw = Math.atan2(dot(dir, u), dot(dir, w));
  const pitch = Math.asin(clamp(dot(dir, v), -1, 1));
  const cy = clamp(yaw, -maxYaw, maxYaw);
  const cp = clamp(pitch, -maxPitch, maxPitch);
  const ccy = Math.cos(cy);
  const scy = Math.sin(cy);
  const ccp = Math.cos(cp);
  const scp = Math.sin(cp);
  return [
    w[0] * ccp * ccy + u[0] * ccp * scy + v[0] * scp,
    w[1] * ccp * ccy + u[1] * ccp * scy + v[1] * scp,
    w[2] * ccp * ccy + u[2] * ccp * scy + v[2] * scp,
  ];
}

/** Turns `cur` toward `want` by at most `rate * dt` radians — damped tracking. */
function dampedRotate(cur: Vec3, want: Vec3, rate: number, dt: number): Vec3 {
  const c = clamp(dot(cur, want), -1, 1);
  const angle = Math.acos(c);
  const step = rate * Math.max(dt, 0);
  if (angle <= step || angle < 1e-9) return want;
  let axis = normalize(cross(cur, want));
  if (len(axis) < 1e-9) {
    // Anti-parallel — no unique axis; pick any perpendicular.
    axis = normalize(cross(cur, UP));
    if (len(axis) < 1e-9) axis = [1, 0, 0];
  }
  return qRotate(qFromAxisAngle(axis, step), cur);
}
