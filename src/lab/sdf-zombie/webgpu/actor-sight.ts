// src/lab/sdf-zombie/webgpu/actor-sight.ts
//
// IS ANY PART OF THIS BODY IN SIGHT? — the occlusion half of the march cull.
//
// The cull used to fire two rays: at the torso cluster's centre and at a point
// 0.6 m straight above it. A body leaning out from a corner shows an arm and
// its (forward-thrust) head while both of those points are still behind the
// wall, so it was culled: no flesh, and — because the skeleton meshes are not
// culled — a bare skull and arm bones in the doorway (owner report 2026-09-20).
//
// The posed body already carries a bounding sphere per limb cluster. A body is
// in sight when ANY live cluster is: its centre, or one of its silhouette
// points (left / right / top of the sphere as seen from the eye), has a clear
// line. The edge probes are what a corner needs — a corner hides a sphere's
// centre long before it hides the sphere.
//
// SAFETY BIAS, unchanged: a wrongly culled visible body is a visible bug, a
// wrongly kept one is only a cost. More probes can only keep MORE.
//
// Pure: no renderer. Early-outs on the first clear ray, so a body in the open
// costs one ray, as before.

import type { Vec3 } from '../types';
import type { Aabb } from './game-level';
import { clearSight } from './encounter-director';

export interface SightSphere { center: Vec3; radius: number; alive: boolean }

export function bodyInSight(eye: Vec3, clusters: readonly SightSphere[], boxes: readonly Aabb[]): boolean {
  const probe: [number, number, number] = [0, 0, 0];
  for (const c of clusters) {
    if (!c.alive) continue;
    const p = c.center, r = c.radius;
    if (clearSight(eye, p, boxes)) return true;
    // Horizontal unit vector perpendicular to the eye->centre ray; degenerate
    // (body straight above/below) falls back to +X.
    const dx = p[0] - eye[0], dz = p[2] - eye[2];
    const len = Math.hypot(dx, dz);
    const sx = len > 1e-6 ? -dz / len : 1, sz = len > 1e-6 ? dx / len : 0;
    probe[0] = p[0] + sx * r; probe[1] = p[1]; probe[2] = p[2] + sz * r;
    if (clearSight(eye, probe, boxes)) return true;
    probe[0] = p[0] - sx * r; probe[2] = p[2] - sz * r;
    if (clearSight(eye, probe, boxes)) return true;
    probe[0] = p[0]; probe[1] = p[1] + r; probe[2] = p[2];
    if (clearSight(eye, probe, boxes)) return true;
  }
  return false;
}
