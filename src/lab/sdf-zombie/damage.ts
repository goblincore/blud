// src/lab/sdf-zombie/damage.ts
import type { Primitive, Vec3 } from './types';
import { add, basisFromAxis, dot, len, qRotate, scale, sub } from './vec';
import { rotateYaw } from './gait';

/** Must match MAX_WOUNDS in the fragment shader. */
export const MAX_WOUNDS = 16;

export type WoundType = 'pellet' | 'blast' | 'burn';

/** Per-type wound character — the "weapon calibre" knobs. rimSplayScale and
 *  rimOffsetScale multiply the global woundCfg rim settings PER WOUND, packed
 *  into the spare ROW_WOUND_META channels (z, w). */
export interface WoundProfile {
  radius: number;
  rimSplayScale: number;
  rimOffsetScale: number;
}
export const WOUND_PROFILES: Record<WoundType, WoundProfile> = {
  // Pellet: small clean punch, modest lip.
  pellet: { radius: 0.055, rimSplayScale: 0.8, rimOffsetScale: 1.0 },
  // Blast: big crater but a TAMED lip — the default splay welded the arm to
  // the torso at the shoulder (playtest 2026-08-16 screenshot 1).
  blast: { radius: 0.13, rimSplayScale: 0.45, rimOffsetScale: 0.85 },
  // Burn: chars and contracts; barely everts (shader already scales by 0.25).
  burn: { radius: 0.08, rimSplayScale: 1.0, rimOffsetScale: 1.0 },
};

export interface Wound {
  /** Index into the built primitive array — the primitive this wound rides. */
  primIdx: number;
  /** Hit position in that primitive's local frame (u, v, w along the basis
   *  `frame(prim, bodyYaw)` builds — axis basis de-yawed by the body yaw, or
   *  the orient-quat basis for rigid-head prims). */
  local: Vec3;
  radius: number;
  type: WoundType;
  ageSec: number;
}

/**
 * Local basis for a primitive AT A GIVEN BODY YAW.
 *
 * The yaw threading is what glues wounds to a TURNING body (motion-polish
 * fix): the basis is built in the DE-YAWED body frame and rotated back out,
 * so a wound stamped at yaw θ0 and mapped at yaw θ rides the rotation — its
 * offset comes out rotated by exactly (θ − θ0), for every primitive shape:
 *
 *  - SPHERES (a === b — every torso blob, the shoulder ball) have no axis at
 *    all; without the yaw their "local" frame was fixed WORLD axes and a
 *    crater stayed viewer-fixed while the body rotated under it (owner
 *    playtest). De-yawed, they get one canonical basis that the re-yaw then
 *    turns with the body.
 *  - VERTICAL capsules (the thigh, axis exactly ±y) hit basisFromAxis's
 *    degenerate fallback — also a fixed frame. De-yawing makes the fallback
 *    deterministic at BOTH ends (stamp and upload see the same de-yawed
 *    axis), so the delta-yaw rotation is exact there too.
 *  - Every other capsule already tracked axis swings; the de-yaw/re-yaw is
 *    an exact no-op at yaw 0 and a rigid delta-rotation under a pure turn.
 *
 * Oriented prims (the rigid head's face spheres, rig-bind.ts) carry their
 * FULL rotation — body yaw included — in prim.orient, so the wound frame is
 * that quaternion's basis outright: a crater on the nose rides the head's
 * own turn inside the clamp cone, not just the body's.
 */
function frame(prim: Primitive, bodyYaw: number) {
  if (prim.orient) {
    const q = prim.orient;
    return {
      u: qRotate(q, [1, 0, 0] as Vec3),
      v: qRotate(q, [0, 1, 0] as Vec3),
      w: qRotate(q, [0, 0, 1] as Vec3),
    };
  }
  const axis = rotateYaw(sub(prim.b, prim.a), -bodyYaw);
  const b = basisFromAxis(len(axis) === 0 ? [0, 1, 0] : axis);
  if (bodyYaw === 0) return b;
  return { u: rotateYaw(b.u, bodyYaw), v: rotateYaw(b.v, bodyYaw), w: rotateYaw(b.w, bodyYaw) };
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
  /** The body's applied yaw at stamp time (motion.ts state.bodyYaw, 0 in the
   *  statue loop) — the frame the hit is expressed in. Must match the yaw
   *  woundWorldPos is later called with or the wound drifts by the delta. */
  bodyYaw = 0,
): Wound {
  let primIdx = -1;
  let best = Infinity;
  prims.forEach((p, i) => {
    // A carve is a hole. A crater riding the inside of an eye socket is
    // meaningless, and it would be carried by a primitive with no surface.
    if (p.op === 'sub') return;
    const d = Math.min(len(sub(hit, p.a)), len(sub(hit, p.b)));
    if (d < best) { best = d; primIdx = i; }
  });
  if (primIdx < 0) primIdx = 0; // a body with no solid primitives cannot be hit

  const prim = prims[primIdx]!;
  const { u, v, w } = frame(prim, bodyYaw);
  const rel = sub(hit, prim.a);
  return { primIdx, local: [dot(rel, u), dot(rel, v), dot(rel, w)], radius, type, ageSec: 0 };
}

/**
 * Transforms a wound back into world space using its primitive's current
 * pose. Pass the body's CURRENT applied yaw — the same value the motion
 * pipeline rotated the rest pose by this frame — so the wound's stored
 * offset rotates out of the stamp frame and into the live one.
 */
export function woundWorldPos(prims: Primitive[], wound: Wound, bodyYaw = 0): Vec3 {
  const prim = prims[wound.primIdx]!;
  const { u, v, w } = frame(prim, bodyYaw);
  return add(prim.a, add(add(scale(u, wound.local[0]), scale(v, wound.local[1])), scale(w, wound.local[2])));
}

/** Ring buffer append — oldest is evicted at capacity. */
export function pushWound(ring: Wound[], wound: Wound, cap: number): Wound[] {
  const next = [...ring, wound];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
