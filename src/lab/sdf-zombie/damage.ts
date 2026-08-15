// src/lab/sdf-zombie/damage.ts
import type { Primitive, Vec3 } from './types';
import { add, basisFromAxis, dot, len, scale, sub } from './vec';

/** Must match MAX_WOUNDS in the fragment shader. */
export const MAX_WOUNDS = 16;

export type WoundType = 'pellet' | 'blast' | 'burn';

export interface Wound {
  /** Index into the built primitive array — the primitive this wound rides. */
  primIdx: number;
  /** Hit position in that primitive's local frame (u, v, w along its axis basis). */
  local: Vec3;
  radius: number;
  type: WoundType;
  ageSec: number;
}

/** Local basis for a primitive: w along its axis, u/v perpendicular. */
function frame(prim: Primitive) {
  const axis = sub(prim.b, prim.a);
  return basisFromAxis(len(axis) === 0 ? [0, 1, 0] : axis);
}

/**
 * Converts a world-space hit into a wound bound to the nearest primitive, stored
 * in that primitive's LOCAL frame. This is what makes a crater stay on the
 * shoulder while the shoulder swings and stretches.
 */
export function worldHitToWound(
  prims: Primitive[],
  hit: Vec3,
  radius: number,
  type: WoundType,
): Wound {
  let primIdx = 0;
  let best = Infinity;
  prims.forEach((p, i) => {
    const d = Math.min(len(sub(hit, p.a)), len(sub(hit, p.b)));
    if (d < best) { best = d; primIdx = i; }
  });

  const prim = prims[primIdx]!;
  const { u, v, w } = frame(prim);
  const rel = sub(hit, prim.a);
  return { primIdx, local: [dot(rel, u), dot(rel, v), dot(rel, w)], radius, type, ageSec: 0 };
}

/** Transforms a wound back into world space using its primitive's current pose. */
export function woundWorldPos(prims: Primitive[], wound: Wound): Vec3 {
  const prim = prims[wound.primIdx]!;
  const { u, v, w } = frame(prim);
  return add(prim.a, add(add(scale(u, wound.local[0]), scale(v, wound.local[1])), scale(w, wound.local[2])));
}

/** Ring buffer append — oldest is evicted at capacity. */
export function pushWound(ring: Wound[], wound: Wound, cap: number): Wound[] {
  const next = [...ring, wound];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
