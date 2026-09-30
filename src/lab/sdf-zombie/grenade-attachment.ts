// Use the existing primitive-local wound transport for attached props too.
import type { BuildResult } from './build-body';
import type { Vec3 } from './types';
import { worldHitToWound, woundWorldPos, type Wound } from './damage';
import { add, scale, sub, normalize } from './vec';
export interface GrenadeAttachment { center: Wound; axis: Wound; limb: string }
export function bindGrenade(body: BuildResult, yaw: number, pos: Vec3, direction: Vec3): GrenadeAttachment {
  const center = worldHitToWound(body.prims, pos, 0, 'pellet', yaw);
  // Bind both points to the SAME primitive, so the axis cannot follow a neighbouring limb.
  const index = center.primIdx, one = [body.prims[index]!];
  const axis = worldHitToWound(one, add(pos, scale(direction, .1)), 0, 'pellet', yaw);
  axis.primIdx = index;
  return { center, axis, limb: body.prims[index]!.limb };
}
export function attachedGrenade(body: BuildResult, yaw: number, anchor: GrenadeAttachment): { pos: Vec3; direction: Vec3 } | null {
  const prim = body.prims[anchor.center.primIdx];
  if (!prim || prim.dead || prim.limb !== anchor.limb || !body.clusters.some(c => c.alive && c.limb === anchor.limb)) return null;
  const pos = woundWorldPos(body.prims, anchor.center, yaw);
  return { pos, direction: normalize(sub(woundWorldPos(body.prims, anchor.axis, yaw), pos)) };
}
