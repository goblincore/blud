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

/** True when a sphere of radius `r` at `q` touches none of the boxes (on a face counts as clear). */
export function clearOfBoxes(q: Vec3, r: number, boxes: readonly ContactBox[]): boolean {
  for (const b of boxes) {
    if (q[0] > b.min[0] - r && q[0] < b.max[0] + r && q[1] > b.min[1] - r && q[1] < b.max[1] + r
      && q[2] > b.min[2] - r && q[2] < b.max[2] + r) return false;
  }
  return true;
}

/** A wall line in x/z, any height (a sector level's blocking lines: level-ground.ts WallSeg). */
export interface ContactSeg { ax: number; az: number; bx: number; bz: number }

function segClosest(q: Vec3, g: ContactSeg): [number, number, number] {
  const ex = g.bx - g.ax, ez = g.bz - g.az, len2 = ex * ex + ez * ez;
  const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((q[0] - g.ax) * ex + (q[2] - g.az) * ez) / len2)) : 0;
  return [g.ax + ex * t, g.az + ez * t, t];
}

/** True when a sphere of radius `r` at `q` touches none of the wall lines (on one counts as clear). */
export function clearOfSegs(q: Vec3, r: number, segs: readonly ContactSeg[]): boolean {
  for (const g of segs) {
    const [cx, cz] = segClosest(q, g);
    if (Math.hypot(q[0] - cx, q[2] - cz) < r - 1e-6) return false;
  }
  return true;
}

/**
 * SECTOR WALLS (owner playtest 2026-11-12: a blown-away body through walls; a sector level's walls are lines, and a
 * corpse met none of them). Push each point out of the wall lines `segsFor(i)` gives it (the lines that block at
 * that point's height), sideways only. A line has no thickness, so where a point IS says nothing about which side
 * it belongs on: the side is the one `safe(i)` is on (where the point last was clear of every wall, else somewhere
 * the body could stand; `prev` with no `safe`). A point whose path from there crosses a line is put back on that
 * side, its radius off the line; one within its radius of a line without crossing it is pushed straight off it
 * (round a line's end too). Two passes, for a corner. No speed added, the speed into the wall dropped, the rest
 * eased by `friction`. Pinned points stay. Returns the same array when nothing touched.
 */
export function pushOutOfSegs(
  points: readonly RigPoint[], segsFor: (i: number) => readonly ContactSeg[], radius: (i: number) => number,
  friction = CORPSE_CONTACT.friction, safe?: (i: number) => Vec3 | undefined,
): RigPoint[] {
  let out: RigPoint[] | null = null;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.pinned) continue;
    const segs = segsFor(i);
    if (!segs.length) continue;
    const r = radius(i);
    for (let pass = 0; pass < 2; pass++) {
      let touched = false;
      for (const g of segs) {
        const p = (out ?? points)[i]!, q = p.pos, f = safe?.(i) ?? p.prev;
        const ex = g.bx - g.ax, ez = g.bz - g.az, len = Math.hypot(ex, ez);
        if (len < 1e-6) continue;
        let nx = -ez / len, nz = ex / len;
        const sf = (f[0] - g.ax) * nx + (f[2] - g.az) * nz;
        if (sf < 0) { nx = -nx; nz = -nz; }
        const sq = (q[0] - g.ax) * nx + (q[2] - g.az) * nz;        // < 0: the far side from `safe`
        let move: Vec3 | null = null, n: Vec3 = [nx, 0, nz];
        if (sq < 0 && Math.abs(sf) > 1e-9) {
          // Where the path safe -> pos meets the line: a crossing only between the line's ends.
          const t = Math.abs(sf) / (Math.abs(sf) - sq);
          const u = ((f[0] + (q[0] - f[0]) * t - g.ax) * ex + (f[2] + (q[2] - f[2]) * t - g.az) * ez) / (len * len);
          if (u >= 0 && u <= 1) move = [nx * (r - sq), 0, nz * (r - sq)];
        }
        if (!move) {
          const [cx, cz] = segClosest(q, g);
          const dx = q[0] - cx, dz = q[2] - cz, d = Math.hypot(dx, dz);
          if (d >= r - 1e-9) continue;
          if (d > 1e-6) n = [dx / d, 0, dz / d];
          move = [n[0] * (r - d), 0, n[2] * (r - d)];
        }
        out ??= points.slice();
        out[i] = contact(p, move, n, friction);
        touched = true;
      }
      if (!touched) break;
    }
  }
  return out ?? (points as RigPoint[]);
}

/**
 * Push each point (radius `radius(i)`) out of the boxes. A point that entered a box (grown by its radius) since
 * `prev` goes back out through the face it entered by; one that tunnelled clean through in a step is stopped at the
 * face it hit. Pinned points stay. Returns the same array when nothing touched.
 *
 * A point that was ALREADY inside (its `prev` is in the box) has no entry to go back through, and leaves by the
 * shallowest face: from past the middle of a wall that is the far side. A joint that sank a step into a wall (THE
 * ENTRY AT THE START, below), pulled 20 cm on by its pose or its bones, came out behind the wall, and the rest of
 * the body followed joint by joint (owner playtest 2026-11-12: a blown-away body through a wall; an authored 'blown'
 * fall put the whole body 1.5 m past a 30 cm wall). And a pass that moves a point with its `prev` (a bend stop, the
 * floor) can carry both across a thin wall, with no entry between them at all. So the caller hands in `safe(i)`:
 * where that point last was clear of every box (else somewhere the body could stand). The sweep starts there
 * instead of at `prev`, and the point goes back out through the face that line enters by. With no `safe`, or one
 * that is itself inside the box, `prev` as before.
 */
export function pushOutOfBoxes(
  points: readonly RigPoint[], boxes: readonly ContactBox[], radius: (i: number) => number,
  friction = CORPSE_CONTACT.friction, safe?: (i: number) => Vec3 | undefined,
): RigPoint[] {
  if (boxes.length === 0) return points as RigPoint[];
  let out: RigPoint[] | null = null;
  for (let i = 0; i < points.length; i++) {
    let p = points[i]!;
    if (p.pinned) continue;
    const r = radius(i);
    for (const b of boxes) {
      const lo: Vec3 = [b.min[0] - r, b.min[1] - r, b.min[2] - r], hi: Vec3 = [b.max[0] + r, b.max[1] + r, b.max[2] + r];
      let a = p.prev;
      const e = p.pos;
      const inside = (q: Vec3) => q[0] > lo[0] && q[0] < hi[0] && q[1] > lo[1] && q[1] < hi[1] && q[2] > lo[2] && q[2] < hi[2];
      const from = safe?.(i);
      if (from && !inside(from)) a = from;
      else if (inside(a)) {
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
      // Swept: where the step prev -> pos enters the grown box (slab test). THE ENTRY AT THE START: a point the
      // last contact left ON a face (where every contact leaves it) and that now moves in enters at t = 0. Counted
      // as no entry, it sank a whole step into the wall every other step, and the already-inside rule fetched it
      // back the step after, or put it out the far side.
      let tIn = -Infinity, tOut = 1, axis = -1;
      for (let k = 0; k < 3; k++) {
        const d = e[k]! - a[k]!;
        if (Math.abs(d) < 1e-12) { if (a[k]! <= lo[k]! || a[k]! >= hi[k]!) { tIn = 2; break; } continue; }
        let t0 = (lo[k]! - a[k]!) / d, t1 = (hi[k]! - a[k]!) / d;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tIn) { tIn = t0; axis = k; }
        if (t1 < tOut) tOut = t1;
        if (tIn > tOut) break;
      }
      if (axis < 0 || tIn < 0 || tIn > tOut || tIn > 1) continue;
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

/** A point met a body: `into` is how far it was driving into it this step (m), `n` the way out (unit). */
export type BodyHit = (o: BodyObstacle, n: Vec3, into: number, i: number) => void;

/**
 * Push each point out of the bodies round it (not those with id `self`): an upright body sideways only, and only
 * the points above its knees; a sphere every way. At most `maxStep` (`uprightStep` for a standing body) a point per
 * call, plus however far it drove in
 * this step: two bodies resting against each other part over a few steps instead of one throwing the other, and a
 * thrown one still stops at the surface. Returns the same array when nothing touched.
 *
 * SWEPT (owner playtest 2026-11-12, "clips through ... other bodies"): a point that was outside a body last step
 * stops where its path prev -> pos first meets the surface. Judged by where it ended alone, a limb flying 25 cm a
 * step ended past the middle of a 24 cm cylinder and was pushed out the far side, or crossed it between two steps
 * and was never seen. `onHit` hears every contact (the standing body's knock, game-actor.ts BODY_KNOCK).
 */
export function pushOutOfBodies(
  points: readonly RigPoint[], obstacles: readonly BodyObstacle[], self: number, radius: (i: number) => number,
  maxStep = CORPSE_CONTACT.bodyStep, friction = CORPSE_CONTACT.friction, uprightStep = CORPSE_CONTACT.uprightStep,
  onHit?: BodyHit,
): RigPoint[] {
  let out: RigPoint[] | null = null;
  for (const o of obstacles) {
    if (o.id === self) continue;
    const up = o.kind === 'upright';
    const cx = up ? o.x : o.c[0], cy = up ? 0 : o.c[1], cz = up ? o.z : o.c[2];
    for (let i = 0; i < points.length; i++) {
      const p = (out ?? points)[i]!;
      if (p.pinned) continue;
      const r = radius(i) + o.r, q = p.pos;
      // The path's first meeting with the surface, from outside: a + t (q - a), |.| = r.
      const a: Vec3 = [p.prev[0] - cx, up ? 0 : p.prev[1] - cy, p.prev[2] - cz];
      const m: Vec3 = [q[0] - p.prev[0], up ? 0 : q[1] - p.prev[1], q[2] - p.prev[2]];
      const aa = a[0] * a[0] + a[1] * a[1] + a[2] * a[2], mm = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
      const am = a[0] * m[0] + a[1] * m[1] + a[2] * m[2];
      if (aa >= r * r - 1e-9 && am < 0 && mm > 1e-12) {
        const disc = am * am - mm * (aa - r * r);
        const t = disc >= 0 ? Math.max(0, (-am - Math.sqrt(disc)) / mm) : 2;
        const y = p.prev[1] + (q[1] - p.prev[1]) * t;
        if (t <= 1 && (!up || (y >= o.y0 && y <= o.y1 + radius(i)))) {
          const n: Vec3 = [(a[0] + m[0] * t) / r, (a[1] + m[1] * t) / r, (a[2] + m[2] * t) / r];
          const back = t - 1;
          out ??= points.slice();
          out[i] = contact(p, [(q[0] - p.prev[0]) * back, (q[1] - p.prev[1]) * back, (q[2] - p.prev[2]) * back], n, friction);
          onHit?.(o, n, -(m[0] * n[0] + m[1] * n[1] + m[2] * n[2]), i);
          continue;
        }
      }
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
      onHit?.(o, n, inward, i);
    }
  }
  return out ?? (points as RigPoint[]);
}
