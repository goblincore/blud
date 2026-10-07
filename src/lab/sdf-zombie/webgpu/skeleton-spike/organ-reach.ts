// src/lab/sdf-zombie/webgpu/skeleton-spike/organ-reach.ts
//
// ORGANS AS MESH (2026-10-06): which organ segments a body's wounds expose.
// Spec: docs/superpowers/specs/2026-10-06-organs-mesh-design.md, section 3.3.
//
// An organ mesh SHOWS by depth (the nearest of the marched flesh and the mesh wins, which is the field's hard min), so
// drawing one that no carve reached is only wasted work, as long as it stays under the skin. Organs are authored
// inside the REST flesh (validate.ts checkBoneContainment); under a pose the flesh prims and the organs' rigid frame
// move by different rules, and the SDF organs were never drawn away from a wound (applyBones runs only in a wound's
// near zone). So an organ segment is drawn only when a wound's exposure sphere (cut-wound.ts boneExposureOf: one per
// crater, a chain per cut) reaches its posed bound: a zombie shot in the head draws no guts.
//
// Pure: plain numbers in, plain numbers out. No three, no rig types.
import type { Point3, SegmentPose } from './contract';

export interface ReachSphere { pos: Point3; radius: number }

/** The bound sphere of a segment-local AABB under a rigid pose: the box centre mapped to the world, half the box's
 *  diagonal for a radius (rotation-proof). */
export function segmentBoundSphere(bounds: { min: Point3; max: Point3 }, pose: SegmentPose): { centre: [number, number, number]; radius: number } {
  const { min, max } = bounds;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  const [qx, qy, qz, qw] = pose.quat;
  // v + 2 q.w (q x v) + 2 q x (q x v)
  const tx = 2 * (qy * cz - qz * cy), ty = 2 * (qz * cx - qx * cz), tz = 2 * (qx * cy - qy * cx);
  return {
    centre: [
      pose.origin[0] + cx + qw * tx + (qy * tz - qz * ty),
      pose.origin[1] + cy + qw * ty + (qz * tx - qx * tz),
      pose.origin[2] + cz + qw * tz + (qx * ty - qy * tx),
    ],
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  };
}

/** True when any exposure sphere overlaps the sphere (centre, radius). An empty list reaches nothing. */
export function organReached(spheres: ReadonlyArray<ReachSphere>, centre: Point3, radius: number): boolean {
  for (const s of spheres) {
    const r = radius + s.radius;
    const dx = s.pos[0] - centre[0], dy = s.pos[1] - centre[1], dz = s.pos[2] - centre[2];
    if (dx * dx + dy * dy + dz * dz < r * r) return true;
  }
  return false;
}
