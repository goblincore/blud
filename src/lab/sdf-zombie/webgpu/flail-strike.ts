// src/lab/sdf-zombie/webgpu/flail-strike.ts
//
// THE SPIKE FLAIL'S STRIKE WINDOW (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §5).
// Pure. At the strike frame, every actor whose torso centre is within `reach`
// (horizontal, from the eye) and within `arcDeg` of the facing is hit — no
// precise ball sweep, so a zombie standing in front of the player is never
// missed.
//
// PLACEMENT: the crater must land where the ball's swing path actually meets
// the skin, not wherever the body field's nearest EUCLIDEAN point happens to
// be. sdBody is a union of many parts (head, limbs, torso...) — the point
// nearest in straight-line distance to the authored impact point is often a
// stray part (a forward-drooping head, the far wall of a hugging actor's
// capsule), not the part the ball's line of sight actually reaches first. So
// placement casts a ray from the EYE — first through the authored impact
// point, falling back to the actor's torso centre if that misses — and takes
// its first surface contact; only THEN is that contact refined onto the true
// skin.
//
// SNAP PRECISION: sdBody is also a LOOSE bound — its gradient magnitude runs
// 0.27–0.55, not the 1 a true SDF promises. A naive gradient-descent step
// (p ← p − n·f, unit normal) assumes |∇f| = 1 and undershoots on a loose
// field, leaving results well outside the requested tolerance. snapToSurface
// (and snapToSurfaceResidual, which also reports how far off the final point
// still is) instead takes a full Newton step (q ← q − f·∇f/|∇f|², which is
// exact to first order for ANY gradient magnitude) with the step length
// clamped — a runaway |∇f| near a seam must not fling the point across the
// body — assuming the field's gradient never drops below FLAIL_STRIKE.minGrad.

import type { LimbId, Primitive, Vec3 } from '../types';

export const FLAIL_STRIKE = {
  /** Horizontal eye → torso-centre distance, metres. */
  reach: 1.8,
  /** Half-angle of the arc about the facing, degrees. */
  arcDeg: 50,
  /** Closer than this, an actor is in the arc whatever its bearing (hugging). */
  hugDist: 0.25,
  /** Newton iterations for the surface snap. */
  snapIters: 24,
  /** Central-difference epsilon for the gradient estimate, metres. */
  gradEps: 0.004,
  /** |field| residual above which a snap (and so a hit) is treated as a miss. */
  residualEps: 0.01,
  /** Assumed floor on |∇field|, for clamping one Newton step's length — the
   *  real body field's gradient magnitude is never observed below ~0.25. */
  minGrad: 0.25,
  /** Absolute cap on one Newton step, metres, whatever minGrad would allow. */
  maxSnapStep: 0.5,
  /** Ray-march "close enough to hand off to the Newton snap" epsilon. */
  rayEps: 0.01,
  /** Sphere-tracing safety factor for the ray march (the field is loose, so
   *  a full step of `f` would undershoot anyway; this is extra headroom). */
  raySafety: 0.5,
  rayMinStep: 0.005,
  rayMaxSteps: 200,
} as const;

export interface StrikeActor {
  id: number;
  /** Torso centre, world. */
  centre: Vec3;
  /** The posed body's signed distance (sdBody). */
  field: (p: Vec3) => number;
}

export interface StrikeHit {
  actorId: number;
  /** On the skin, world. */
  point: Vec3;
  /** Unit vector from the eye to `point`. */
  dir: Vec3;
}

/** A view-space point (x right, y up, −z forward) to world, from the eye's yaw and pitch
 *  (the game's convention: forward = (sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch)). */
export function viewToWorld(eye: Vec3, yaw: number, pitch: number, v: Vec3): Vec3 {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const f: Vec3 = [sy * cp, sp, -cy * cp];
  const r: Vec3 = [cy, 0, sy];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return [
    eye[0] + r[0] * v[0] + u[0] * v[1] - f[0] * v[2],
    eye[1] + r[1] * v[0] + u[1] * v[1] - f[1] * v[2],
    eye[2] + r[2] * v[0] + u[2] * v[1] - f[2] * v[2],
  ];
}

export function inStrikeArc(eye: Vec3, yaw: number, centre: Vec3): boolean {
  const dx = centre[0] - eye[0], dz = centre[2] - eye[2];
  const d = Math.hypot(dx, dz);
  if (d > FLAIL_STRIKE.reach) return false;
  if (d < FLAIL_STRIKE.hugDist) return true;
  const cosA = (dx * Math.sin(yaw) - dz * Math.cos(yaw)) / d;
  return cosA >= Math.cos((FLAIL_STRIKE.arcDeg * Math.PI) / 180);
}

export interface SnapResult {
  /** The (attempted) surface point. */
  point: Vec3;
  /** |field(point)| after snapping — Infinity if the field ever went non-finite. */
  residual: number;
}

/** Central-difference gradient estimate of `field` at `q`. */
function gradient(field: (p: Vec3) => number, q: Vec3, e: number): Vec3 {
  const inv = 1 / (2 * e);
  return [
    (field([q[0] + e, q[1], q[2]]) - field([q[0] - e, q[1], q[2]])) * inv,
    (field([q[0], q[1] + e, q[2]]) - field([q[0], q[1] - e, q[2]])) * inv,
    (field([q[0], q[1], q[2] + e]) - field([q[0], q[1], q[2] - e])) * inv,
  ];
}

/** Walk `p` onto the field's zero surface with a Newton step
 *  (q ← q − f·∇f/|∇f|²), clamped so a locally steep gradient can't fling the
 *  point across the body. Reports the final |field| — the caller should
 *  reject a result whose residual is still large (FLAIL_STRIKE.residualEps). */
export function snapToSurfaceResidual(field: (p: Vec3) => number, p: Vec3): SnapResult {
  const e = FLAIL_STRIKE.gradEps;
  let q: Vec3 = [p[0], p[1], p[2]];
  let f = field(q);
  if (!Number.isFinite(f)) return { point: q, residual: Infinity };
  for (let i = 0; i < FLAIL_STRIKE.snapIters && Math.abs(f) >= 1e-4; i++) {
    const g = gradient(field, q, e);
    const gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    if (gg < 1e-12) break;
    let dx = (f * g[0]) / gg, dy = (f * g[1]) / gg, dz = (f * g[2]) / gg;
    const dLen = Math.hypot(dx, dy, dz);
    const cap = Math.min(Math.abs(f) / FLAIL_STRIKE.minGrad, FLAIL_STRIKE.maxSnapStep);
    if (dLen > cap && dLen > 1e-12) {
      const k = cap / dLen;
      dx *= k; dy *= k; dz *= k;
    }
    q = [q[0] - dx, q[1] - dy, q[2] - dz];
    f = field(q);
    if (!Number.isFinite(f)) return { point: q, residual: Infinity };
  }
  return { point: q, residual: Math.abs(f) };
}

/** `snapToSurfaceResidual`, discarding the residual. */
export function snapToSurface(field: (p: Vec3) => number, p: Vec3): Vec3 {
  return snapToSurfaceResidual(field, p).point;
}

/** Sphere-trace from `from` along unit `dir`, up to `maxDist`, for the field's
 *  first surface crossing. The field is a loose bound (§ above), so the step
 *  takes extra headroom (raySafety) rather than the usual full `f`. Returns
 *  null on a miss (out of range, or the field went non-finite). */
function traceRaySurface(field: (p: Vec3) => number, from: Vec3, dir: Vec3, maxDist: number): Vec3 | null {
  let f = field(from);
  if (!Number.isFinite(f)) return null;
  if (f <= FLAIL_STRIKE.rayEps) return [from[0], from[1], from[2]];
  let t = 0;
  for (let i = 0; i < FLAIL_STRIKE.rayMaxSteps; i++) {
    const step = Math.max(f * FLAIL_STRIKE.raySafety, FLAIL_STRIKE.rayMinStep);
    t += step;
    if (t > maxDist) return null;
    const p: Vec3 = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
    f = field(p);
    if (!Number.isFinite(f)) return null;
    if (f <= FLAIL_STRIKE.rayEps) return p;
  }
  return null;
}

/** Unit vector from `from` to `to`, or null if they coincide or the result
 *  isn't finite. */
function unitTowards(from: Vec3, to: Vec3): Vec3 | null {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (!Number.isFinite(l) || l < 1e-9) return null;
  return [d[0] / l, d[1] / l, d[2] / l];
}

export function resolveStrike(eye: Vec3, yaw: number, impactWorld: Vec3, actors: readonly StrikeActor[]): StrikeHit[] {
  const hits: StrikeHit[] = [];
  const maxDist = FLAIL_STRIKE.reach + 0.5;
  for (const a of actors) {
    if (!inStrikeArc(eye, yaw, a.centre)) continue;

    // Placement: ray from the eye through the AUTHORED impact point first —
    // that's the ball's actual line of sight, so it lands on whichever part
    // of the body the ball would really reach first (the near torso, not a
    // Euclidean-nearer stray head or the far wall behind a hugging actor).
    let contact: Vec3 | null = null;
    const dirImpact = unitTowards(eye, impactWorld);
    if (dirImpact) contact = traceRaySurface(a.field, eye, dirImpact, maxDist);
    if (!contact) {
      const dirCentre = unitTowards(eye, a.centre);
      if (dirCentre) contact = traceRaySurface(a.field, eye, dirCentre, maxDist);
    }
    if (!contact) continue; // neither ray reached this actor's skin

    const { point, residual } = snapToSurfaceResidual(a.field, contact);
    if (!Number.isFinite(residual) || residual > FLAIL_STRIKE.residualEps) continue;

    const d: Vec3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    hits.push({ actorId: a.id, point, dir: [d[0] / l, d[1] / l, d[2] / l] });
  }
  return hits;
}

/** Gradual head damage (spec §10.5, §11): a head-region hit caves the face in without severing until the
 *  actor's `hitsToSever`-th, which is the full crater and SNAPS THE NECK (game-flail.ts stamps a sever
 *  wound at the neck midpoint, so the head comes off wherever on the head the last blow lands). */
export const FLAIL_HEAD = {
  regionDist: 0.25,
  /** Also the head region: within this of the neck root. Crosshair-on-head hits used to land on the upper
   *  chest ~0.16 m from it and sever the neck on hit 1 (spec §11). */
  neckDist: 0.2,
  hitsToSever: 4,
  faceCraterR: 0.06,
  /** The neck-snap wound's sever calibre, metres (a zombie neck is ~0.07 m in radius). */
  neckSeverR: 0.12,
} as const;

export function isHeadRegion(limb: LimbId | undefined, point: Vec3, headCentre: Vec3 | null, neckRoot: Vec3 | null): boolean {
  if (limb === 'head') return true;
  const near = (c: Vec3 | null, r: number) => !!c && Math.hypot(point[0] - c[0], point[1] - c[1], point[2] - c[2]) < r;
  return near(headCentre, FLAIL_HEAD.regionDist) || near(neckRoot, FLAIL_HEAD.neckDist);
}

/** The wound for one hit. `headHitsBefore` counts this actor's earlier head-region hits. */
export function flailWound(
  headRegion: boolean, headHitsBefore: number, craterR: number, severMul: number,
): { radius: number; severRadius: number; snapNeck: boolean } {
  if (!headRegion) return { radius: craterR, severRadius: craterR * severMul, snapNeck: false };
  if (headHitsBefore + 1 >= FLAIL_HEAD.hitsToSever) return { radius: craterR, severRadius: craterR * severMul, snapNeck: true };
  return { radius: FLAIL_HEAD.faceCraterR, severRadius: 0, snapNeck: false };
}

/** The head chain's root (it sits in the shoulders) and its first segment's midpoint (the neck), from the
 *  first live, non-`sub` `head` prim; null when there is none (the head is off). */
export function headNeck(prims: readonly Primitive[]): { root: Vec3; mid: Vec3 } | null {
  const n = prims.find(p => p.limb === 'head' && p.op !== 'sub' && !p.dead);
  if (!n) return null;
  return { root: [n.a[0], n.a[1], n.a[2]], mid: [(n.a[0] + n.b[0]) / 2, (n.a[1] + n.b[1]) / 2, (n.a[2] + n.b[2]) / 2] };
}
