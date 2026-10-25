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
//
// SECTOR LEVELS (2026-10-25): the boxes are the room levels' walls; a sector
// level's walls, floors and ceilings are lines and heights, which the boxes do
// not hold, so every body in the frustum was drawn (10 drawn / 1 in sight at
// E1M1's pit corridor, 67-75 ms). `occluded` adds that geometry: a probe is
// clear only when the boxes AND the occluder let it through. `sectorOcclusion`
// builds it over sector-ray.ts, biased the same way — anything it cannot judge
// (an eye outside the level, under its floor, over a closed ceiling) reads as
// open, and a hit within `slackM` of the probe point is the body's own spot,
// not a wall in front of it. Two-sided openings (windows, steps, ledges) are
// open where sectorSegmentHit says they are.

import type { Vec3 } from '../types';
import type { Aabb } from './game-level';
import { clearSight } from './encounter-director';
import type { SectorMap } from './sector-def';
import type { SectorGround } from './sector-ground';
import { sectorSegmentHit, type SectorHit } from './sector-ray';

export interface SightSphere { center: Vec3; radius: number; alive: boolean }

/** Extra occlusion beyond the boxes: true when eye→p is blocked before it gets within `slackM` of p. */
export type SightOccluder = (eye: Vec3, p: Vec3, slackM: number) => boolean;

/** How close to a probe point a hit may land and still count as the body's own spot (metres). A body
 *  against a wall, a foot on its floor: the probe is ON the geometry, not behind it. */
export const SIGHT_SLACK_M = 0.1;

/** The sector geometry as a SightOccluder (one hit record per closure: no allocation per call). */
export function sectorOcclusion(map: SectorMap, ground: SectorGround): SightOccluder {
  const out: SectorHit = { t: 0, point: [0, 0, 0], kind: 'wall', line: -1, sector: -1 };
  return (eye, p, slackM) => {
    const hit = sectorSegmentHit(map, ground, eye, p, out);
    if (!hit) return false;
    const len = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    const at = hit.t * len;
    // A hit at the eye itself: the eye is in the void, under its floor or over a closed ceiling (a
    // camera mid step, a debug pose). Nothing can be judged from there — never cull on it.
    if (at < 1e-3) return false;
    return at < len - slackM;
  };
}

const probe: [number, number, number] = [0, 0, 0];

export function bodyInSight(eye: Vec3, clusters: readonly SightSphere[], boxes: readonly Aabb[], occluded?: SightOccluder): boolean {
  const clear = (q: Vec3) => clearSight(eye, q, boxes) && !(occluded && occluded(eye, q, SIGHT_SLACK_M));
  for (const c of clusters) {
    if (!c.alive) continue;
    const p = c.center, r = c.radius;
    if (clear(p)) return true;
    // Horizontal unit vector perpendicular to the eye->centre ray; degenerate
    // (body straight above/below) falls back to +X.
    const dx = p[0] - eye[0], dz = p[2] - eye[2];
    const len = Math.hypot(dx, dz);
    const sx = len > 1e-6 ? -dz / len : 1, sz = len > 1e-6 ? dx / len : 0;
    probe[0] = p[0] + sx * r; probe[1] = p[1]; probe[2] = p[2] + sz * r;
    if (clear(probe)) return true;
    probe[0] = p[0] - sx * r; probe[2] = p[2] - sz * r;
    if (clear(probe)) return true;
    probe[0] = p[0]; probe[1] = p[1] + r; probe[2] = p[2];
    if (clear(probe)) return true;
    // The bottom of the sphere too, only with an occluder: under a sector level's low lintels and
    // ceiling steps a body shows its lowest flesh first. Boxes alone keep the old four rays.
    if (occluded) {
      probe[1] = p[1] - r;
      if (clear(probe)) return true;
    }
  }
  return false;
}
