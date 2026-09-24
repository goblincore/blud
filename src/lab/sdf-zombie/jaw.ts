// src/lab/sdf-zombie/jaw.ts
//
// THE JAW (bride Task 12) — the one piece of a face that moves on its own.
//
// A `jaw` bone (gait.ts GaitJointName 'jaw') is only a CARRIER: it hangs off
// the skull's pivot to the chin so its tail is a named rig point. The jaw
// itself ROTATES about a hinge on the skull axis (jawHinge) by the GAPE
// angle, in the head's own frame. Two consumers share that geometry:
//   - motion.ts computes the gape (sword-swing.ts jawGapeAt), hands it on as
//     MotionFrame.jawGape -> rig.jawGape, and pins the jaw point to the
//     head's current frame opened by it (jawTargetAt);
//   - rig-bind.ts poses the `on jaw` prims with the rigid head plus the gape
//     (openAboutHinge, jawOrient).
// The prims take the SCALAR, never an angle read back off the jaw point:
// that point is one step stale, and the pivot moves ~2.5 cm a step at a walk.
//
// Pure; no three. Body-local conventions: +x right, +y up, +z forward. A
// positive gape turns +z toward -y about +x: the chin drops.
import type { Vec3 } from './types';
import { qFromAxisAngle, qMul, qRotate, normalize, sub, add, type Quat } from './vec';
import { segmentQuat } from './rig-frames';

/** Where the jaw HINGES, as a fraction along the skull bone plus a step back
 *  (-z, body-local): at 0.30 of the bride's skull that is y 1.640, the upper
 *  lip's line, 2 cm behind the skull axis (z -0.020), ~10 cm behind the lips.
 *  LOWER than a human jaw joint on purpose. At the anatomical height (0.38,
 *  y 1.659, under the nose) the 0.55 rad gape swung the lower lip 3.4 cm
 *  BACK into the face as it dropped, and it vanished; level with the lips
 *  they drop ~5 cm and retreat ~1.4: the jaw falls open, unhinged, which is
 *  the horror hook. Rotating about the skull's pivot (the jaw bone's own
 *  head, 7 cm lower still) swings the chin FORWARD, an underbite. */
export const JAW_HINGE = { at: 0.30, back: 0.020 } as const;

/** Largest gape rig-bind will pose (rad). The swing asks for <= 0.55
 *  (sword-swing.ts JAW_GAPE); this only bounds a nonsense input. */
export const JAW_MAX_GAPE = 0.9;

/** The jaw's rest geometry, relative to the skull pivot (bind space, yaw 0). */
export interface JawRest {
  /** Skull pivot -> skull tip, unit. */
  restDir: Vec3;
  /** The hinge, pivot-relative. */
  hinge: Vec3;
  /** The jaw point (the `jaw` bone's tail), pivot-relative. */
  jaw: Vec3;
}

export function jawRestOf(skullHead: Vec3, skullTail: Vec3, jawTail: Vec3): JawRest {
  const axis = sub(skullTail, skullHead);
  const t = JAW_HINGE.at;
  return {
    restDir: normalize(axis),
    hinge: [axis[0] * t, axis[1] * t, axis[2] * t - JAW_HINGE.back],
    jaw: sub(jawTail, skullHead),
  };
}

/** The gape's own rotation, about body-local +x. */
export function gapeQuat(gape: number): Quat {
  return qFromAxisAngle([1, 0, 0], gape);
}

/** A pivot-relative REST point on the jaw, opened by `gape` about the hinge
 *  (still pivot-relative, still unturned by the head). */
export function openAboutHinge(rest: JawRest, v: Vec3, gape: number): Vec3 {
  if (gape === 0) return v;
  return add(rest.hinge, qRotate(gapeQuat(gape), sub(v, rest.hinge)));
}

/** World target for the jaw point: the head frame (pivot, looking along the
 *  unit `dir` — rig-bind's CLAMPED skull direction, so the point sits where
 *  the posed jaw does) turned open by `gape`. Gape 0 is rigid with the skull. */
export function jawTargetAt(rest: JawRest, pivot: Vec3, dir: Vec3, bodyYaw: number, gape: number): Vec3 {
  const q = segmentQuat(rest.restDir, dir, bodyYaw);
  return add(pivot, qRotate(q, openAboutHinge(rest, rest.jaw, gape)));
}

/** The head's rigid rotation composed with the gape — the orientation a
 *  jaw prim is posed with (the gape first, in the head's rest frame). */
export function jawOrient(qHead: Quat, gape: number): Quat {
  return gape === 0 ? qHead : qMul(qHead, gapeQuat(gape));
}
