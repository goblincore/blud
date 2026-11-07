// src/lab/sdf-zombie/corpse-contact.ts
//
// A CORPSE MEETS THE WORLD (owner playtest 2026-11-05: "when the thrown blow back death happens it clips through
// walls and other enemies"). A corpse's rig points met the floor and nothing else: a body thrown along a volley flew
// through the level's wall boxes and through the bodies standing in its way. Here each point is a sphere (the flesh
// round it) pushed out of
//   - the level's boxes (walls, solids, gates, barrels): along the face it came in through, swept from where it was
//     last step, so a point flying 25 cm a step cannot pass through a 30 cm wall;
//   - the bodies round it: a standing body is an upright cylinder from its knees up (a corpse lying at its feet is
//     stepped over, not shoved about; a flying one hits it), a corpse is a few spheres along its trunk.
// The push adds no speed (prev moves with pos), the speed into the contact is dropped and the speed along it eased
// by `friction`, so a thrown body thuds against a wall and slides down it instead of bouncing off.
//
// Pure: no level, no actors; the caller hands in boxes and obstacles.
import type { RigPoint } from './rig';
import type { Vec3 } from './types';

export interface ContactBox { min: Vec3; max: Vec3 }

/** A body another corpse can hit, by the id of the actor it belongs to (an actor never hits its own). */
export type BodyObstacle =
  | { id: number; kind: 'upright'; x: number; z: number; r: number; y0: number; y1: number }
  | { id: number; kind: 'sphere'; c: Vec3; r: number };

export const CORPSE_CONTACT = {
  /** Share of the speed along a contact lost per step (a body sliding down a wall). */
  friction: 0.25,
  /** Most another corpse moves a point per step (m): corpses resting against each other part gently. */
  bodyStep: 0.03,
  /** The same for a standing body (m): nothing of a corpse belongs inside one above its knees. */
  uprightStep: 0.08,
  /** A standing body's cylinder starts this far above its feet (m). */
  kneeY: 0.35,
  /** A standing body's cylinder radius (m). */
  uprightR: 0.24,
  /** A corpse's trunk sphere radius (m). */
  trunkR: 0.13,
};

type Mut3 = [number, number, number];

/** Move point `p` by `move` (no added speed), drop its speed into normal `n` and ease the rest by `friction`. */
function contact(p: RigPoint, move: Vec3, n: Vec3, friction: number): RigPoint {
  const pos: Mut3 = [p.pos[0] + move[0], p.pos[1] + move[1], p.pos[2] + move[2]];
  const v: Mut3 = [p.pos[0] - p.prev[0], p.pos[1] - p.prev[1], p.pos[2] - p.prev[2]];
  const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  if (vn < 0) for (let k = 0; k < 3; k++) v[k]! -= n[k]! * vn;
  const keep = 1 - friction;
  // Friction only on the speed along the contact (what is left once the inward part is gone).
  const along = vn < 0 ? keep : 1;
  return { ...p, pos, prev: [pos[0] - v[0] * along, pos[1] - v[1] * along, pos[2] - v[2] * along] };
}

/**
 * Push each point (radius `radius(i)`) out of the boxes. A point that entered a box (grown by its radius) since
 * `prev` goes back out through the face it entered by; one that tunnelled clean through in a step is stopped at the
 * face it hit; one that was already inside (a box that appeared round it) leaves by the shallowest face.
 * Pinned points stay. Returns the same array when nothing touched.
 */
export function pushOutOfBoxes(
  points: readonly RigPoint[], boxes: readonly ContactBox[], radius: (i: number) => number,
  friction = CORPSE_CONTACT.friction,
): RigPoint[] {
  if (boxes.length === 0) return points as RigPoint[];
  let out: RigPoint[] | null = null;
  for (let i = 0; i < points.length; i++) {
    let p = points[i]!;
    if (p.pinned) continue;
    const r = radius(i);
    for (const b of boxes) {
      const lo: Vec3 = [b.min[0] - r, b.min[1] - r, b.min[2] - r], hi: Vec3 = [b.max[0] + r, b.max[1] + r, b.max[2] + r];
      const a = p.prev, e = p.pos;
      const inside = (q: Vec3) => q[0] > lo[0] && q[0] < hi[0] && q[1] > lo[1] && q[1] < hi[1] && q[2] > lo[2] && q[2] < hi[2];
      if (inside(a)) {
        if (!inside(e)) continue;
        // Already in: the shallowest face.
        let axis = 0, sign = -1, best = Infinity;
        for (let k = 0; k < 3; k++) {
          const dLo = e[k]! - lo[k]!, dHi = hi[k]! - e[k]!;
          if (dLo < best) { best = dLo; axis = k; sign = -1; }
          if (dHi < best) { best = dHi; axis = k; sign = 1; }
        }
        const move: Mut3 = [0, 0, 0], n: Mut3 = [0, 0, 0];
        move[axis] = sign * best; n[axis] = sign;
        p = contact(p, move, n, friction);
        continue;
      }
      // Swept: where the step prev -> pos enters the grown box (slab test).
      let tIn = 0, tOut = 1, axis = -1;
      for (let k = 0; k < 3; k++) {
        const d = e[k]! - a[k]!;
        if (Math.abs(d) < 1e-12) { if (a[k]! <= lo[k]! || a[k]! >= hi[k]!) { tIn = 2; break; } continue; }
        let t0 = (lo[k]! - a[k]!) / d, t1 = (hi[k]! - a[k]!) / d;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tIn) { tIn = t0; axis = k; }
        if (t1 < tOut) tOut = t1;
        if (tIn > tOut) break;
      }
      if (axis < 0 || tIn > tOut || tIn > 1) continue;
      // Back to the entry face along that axis; the other axes keep the step (it slides along the face).
      const n: Mut3 = [0, 0, 0];
      n[axis] = e[axis]! > a[axis]! ? -1 : 1;
      const face = n[axis]! < 0 ? lo[axis]! : hi[axis]!;
      const move: Mut3 = [0, 0, 0];
      move[axis] = face - e[axis]!;
      p = contact(p, move, n, friction);
    }
    if (p !== points[i]) { out ??= points.slice(); out[i] = p; }
  }
  return out ?? (points as RigPoint[]);
}

/**
 * Push each point out of the bodies round it (not those with id `self`): an upright body sideways only, and only
 * the points above its knees; a sphere every way. At most `maxStep` (`uprightStep` for a standing body) a point per
 * call, plus however far it drove in
 * this step: two bodies resting against each other part over a few steps instead of one throwing the other, and a
 * thrown one still stops at the surface. Returns the same array when nothing touched.
 */
export function pushOutOfBodies(
  points: readonly RigPoint[], obstacles: readonly BodyObstacle[], self: number, radius: (i: number) => number,
  maxStep = CORPSE_CONTACT.bodyStep, friction = CORPSE_CONTACT.friction, uprightStep = CORPSE_CONTACT.uprightStep,
): RigPoint[] {
  let out: RigPoint[] | null = null;
  for (const o of obstacles) {
    if (o.id === self) continue;
    for (let i = 0; i < points.length; i++) {
      const p = (out ?? points)[i]!;
      if (p.pinned) continue;
      const r = radius(i) + o.r, q = p.pos;
      let d: Vec3;
      if (o.kind === 'upright') {
        if (q[1] < o.y0 || q[1] > o.y1 + radius(i)) continue;
        d = [q[0] - o.x, 0, q[2] - o.z];
      } else {
        d = [q[0] - o.c[0], q[1] - o.c[1], q[2] - o.c[2]];
      }
      const dl = Math.hypot(d[0], d[1], d[2]);
      if (dl >= r) continue;
      // Dead centre: out the way the point was moving from (else up for a sphere, along +x for a cylinder).
      const v: Vec3 = [p.prev[0] - q[0], o.kind === 'upright' ? 0 : p.prev[1] - q[1], p.prev[2] - q[2]];
      const vl = Math.hypot(v[0], v[1], v[2]);
      const n: Vec3 = dl > 1e-6 ? [d[0] / dl, d[1] / dl, d[2] / dl]
        : vl > 1e-6 ? [v[0] / vl, v[1] / vl, v[2] / vl] : o.kind === 'upright' ? [1, 0, 0] : [0, 1, 0];
      // A point driving in is put back as far as it came in this step, on top of maxStep: the cap is for bodies
      // resting against each other, not for a thrown one arriving.
      const inward = Math.max(0, -((q[0] - p.prev[0]) * n[0] + (q[1] - p.prev[1]) * n[1] + (q[2] - p.prev[2]) * n[2]));
      const pen = Math.min(r - dl, (o.kind === 'upright' ? uprightStep : maxStep) + inward);
      out ??= points.slice();
      out[i] = contact(p, [n[0] * pen, n[1] * pen, n[2] * pen], n, friction);
    }
  }
  return out ?? (points as RigPoint[]);
}
