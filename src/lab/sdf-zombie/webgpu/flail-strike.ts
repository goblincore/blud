// src/lab/sdf-zombie/webgpu/flail-strike.ts
//
// THE SPIKE FLAIL'S STRIKE WINDOW (spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §5).
// Pure. At the strike frame, every actor whose torso centre is within `reach`
// (horizontal, from the eye) and within `arcDeg` of the facing is hit — no
// precise ball sweep, so a zombie standing in front of the player is never
// missed. The crater lands where the ball's AUTHORED impact point (view space,
// flail-swing FLAIL_IMPACT) meets that actor's skin: the point is taken to
// world space from the eye, yaw and pitch, then walked down the body's
// distance-field gradient onto the surface.

import type { Vec3 } from '../types';

export const FLAIL_STRIKE = {
  /** Horizontal eye → torso-centre distance, metres. */
  reach: 1.8,
  /** Half-angle of the arc about the facing, degrees. */
  arcDeg: 50,
  /** Closer than this, an actor is in the arc whatever its bearing (hugging). */
  hugDist: 0.25,
  snapIters: 6,
  gradEps: 0.004,
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

/** Walk `p` down the field's gradient onto its zero surface (p ← p − n·f). */
export function snapToSurface(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = FLAIL_STRIKE.gradEps;
  let q: Vec3 = [p[0], p[1], p[2]];
  for (let i = 0; i < FLAIL_STRIKE.snapIters; i++) {
    const f = field(q);
    const g: Vec3 = [
      field([q[0] + e, q[1], q[2]]) - field([q[0] - e, q[1], q[2]]),
      field([q[0], q[1] + e, q[2]]) - field([q[0], q[1] - e, q[2]]),
      field([q[0], q[1], q[2] + e]) - field([q[0], q[1], q[2] - e]),
    ];
    const l = Math.hypot(g[0], g[1], g[2]);
    if (l < 1e-12) break;
    q = [q[0] - (g[0] / l) * f, q[1] - (g[1] / l) * f, q[2] - (g[2] / l) * f];
    if (Math.abs(f) < 1e-4) break;
  }
  return q;
}

export function resolveStrike(eye: Vec3, yaw: number, impactWorld: Vec3, actors: readonly StrikeActor[]): StrikeHit[] {
  const hits: StrikeHit[] = [];
  for (const a of actors) {
    if (!inStrikeArc(eye, yaw, a.centre)) continue;
    const point = snapToSurface(a.field, impactWorld);
    const d: Vec3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    hits.push({ actorId: a.id, point, dir: [d[0] / l, d[1] / l, d[2] / l] });
  }
  return hits;
}
