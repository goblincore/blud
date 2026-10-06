// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-split-hit.ts
//
// A SHOT AT A SPLIT SKULL. The anatomical skull's plates are stored on the CLOSED head (skull-fracture.ts), and a
// split head draws them once per piece, each copy turned about the hinge by its piece's bone angle and clipped to
// what the piece owns (mesh-renderer.ts drawPieces, mesh-split.ts). A ray has to meet the bone where it is DRAWN, so
// the test here is the draw read backwards: for each piece, the ray is turned BACK by that piece's angle and cast at
// the closed plates, and a triangle hit counts only where the piece owns the hit point (the clip). The nearest hit
// over the pieces is the bone the ray meets.
//
//
// WHERE THE RAY STARTS (skullShotCast). A projectile is stopped by the FLESH: the game traces its step against the
// flesh field, and on a closed head the skull is cast from the flesh impact, a bullet's reach on. An open head has
// bone with no flesh in front of it, standing in the gap between the halves: there the skull is cast from the start
// of the projectile's step, so bone ahead of the flesh counts, and a step that meets no flesh at all is cast along
// its whole length. One projectile damages one plate of a skull at most (SkullStrikes).
//
// Pure (no three): the renderer hands in the head's frame as functions, so a closed head's test is the same
// arithmetic it always was.
import type { Vec3 } from '../../types';
import { HEAD_SPLIT, rotAxis, skullPieceAt, type SkullSplit } from '../../head-split';
import { SKULL_REACH, skullRayCast, type SkullDamage, type SkullPieceSurface } from '../../skull-fracture';
import { skullJagAt, type SplitJag } from './mesh-split';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The head's frame, as the skull's plates are drawn with it: a world point in the frame the plates are stored in
 *  and back, and a world direction in that frame (any length: the ray test normalises it). */
export interface SkullHeadFrame {
  toLocal(point: Vec3): Vec3;
  toWorld(point: Vec3): Vec3;
  dirToLocal(direction: Vec3): Vec3;
}

/** What a ray meets on a skull: the plate, the piece whose copy shows it there (0 the rest, 1 the + half, 2 the -
 *  half; a closed skull is all piece 0), and the distance along the ray in head-frame metres, as skullRayCast's. */
export interface SkullSplitHit { plate: number; piece: 0 | 1 | 2; distance: number }

/** The bone angle of a piece's copy (rad): 0 for the rest, and for a half that does not turn. */
export function skullPieceAngle(split: SkullSplit, piece: 0 | 1 | 2): number {
  return piece === 1 ? split.angleP : piece === 2 ? split.angleM : 0;
}

/** The piece that owns the closed skull's WORLD point `q`, by the fracture `jag` the copies are clipped along
 *  (head-split.ts skullPieceAt at mesh-split.ts skullJagAt): the clip's rule, on the CPU. */
export function skullOwnerAt(split: SkullSplit, q: Vec3, jag: SplitJag = HEAD_SPLIT.skull.jag): 0 | 1 | 2 {
  return skullPieceAt(split, q, skullJagAt(split, q, jag));
}

/** The first bone the world ray `point` + t `direction` meets on the skull as it is drawn. `split` null (a closed
 *  head): skullRayCast in the head's frame, exactly. Else, for each piece that has a copy, the ray taken back by the
 *  copy's turn about the hinge is cast at the closed plates, counting a triangle only where that piece owns the hit
 *  point; the nearest over the pieces wins (the rest, then the + half, then the - half, on a tie). `jag` is the
 *  fracture the renderer draws with; `reach` the bullet's penetration, as skullRayCast's. */
export function skullSplitRayHit(
  pieces: readonly SkullPieceSurface[], state: SkullDamage, split: SkullSplit | null, frame: SkullHeadFrame,
  point: Vec3, direction: Vec3, jag: SplitJag = HEAD_SPLIT.skull.jag, reach = SKULL_REACH,
): SkullSplitHit | null {
  if (!split) {
    const hit = skullRayCast(pieces, state, frame.toLocal(point), frame.dirToLocal(direction), reach);
    return hit && { plate: hit.plate, piece: 0, distance: hit.distance };
  }
  const { h, a } = split.frame.w;
  let best: SkullSplitHit | null = null;
  for (const piece of [0, 1, 2] as const) {
    const angle = skullPieceAngle(split, piece);
    if (piece !== 0 && angle === 0) continue;   // no such copy is drawn: the rest owns that side
    // The copy is the closed skull turned by `angle` about the hinge: the ray turned by -angle meets the closed
    // skull where the given ray meets the copy.
    const from = angle === 0 ? point : add(h, rotAxis(sub(point, h), a, -angle));
    const along = angle === 0 ? direction : rotAxis(direction, a, -angle);
    const hit = skullRayCast(
      pieces, state, frame.toLocal(from), frame.dirToLocal(along), best ? best.distance : reach,
      local => skullOwnerAt(split, frame.toWorld(local), jag) === piece,
    );
    if (hit) best = { plate: hit.plate, piece, distance: hit.distance };
  }
  return best;
}

/** One step of a projectile, as one actor's skull sees it: the step's two ends, the projectile's direction (any
 *  length), and where the step met THIS actor's flesh (null: it met none of it; `to` is then where the step ends, or
 *  where something else stopped the projectile). World metres. */
export interface SkullShotStep { from: Vec3; to: Vec3; direction: Vec3; flesh: Vec3 | null }

/** The ray a step casts at a skull: skullSplitRayHit's `point`, `direction` and `reach`. */
export interface SkullCast { origin: Vec3; direction: Vec3; reach: number }

/** A sphere that holds a skull as it is drawn (world metres). */
export interface SkullBound { centre: Vec3; radius: number }

/** What a projectile remembers of the skulls it has damaged: the owners, each once. A slug that breaks a plate
 *  standing in the gap on one step and meets that head's flesh on the next must not break a second. */
export interface SkullStrikes { skulls?: object[] }

/** The projectile `by` has damaged a plate of `owner`'s skull already. */
export const skullStruck = (by: SkullStrikes | undefined, owner: object): boolean => by?.skulls?.includes(owner) ?? false;

/** The sphere that holds every copy of a split skull whose CLOSED bone lies in the sphere `centre`, `radius`: a
 *  half's copy is that bone turned about the hinge line, which keeps every point's distance to the hinge point, so
 *  all of it stays within the furthest the closed sphere reaches from there. `split` null: the closed sphere. */
export function skullCopiesBound(centre: Vec3, radius: number, split: SkullSplit | null): SkullBound {
  if (!split) return { centre, radius };
  const h = split.frame.w.h;
  return { centre: h, radius: Math.hypot(centre[0] - h[0], centre[1] - h[1], centre[2] - h[2]) + radius };
}

/** The segment `from`..`to` passes within `bound`. */
export function segmentInBound(from: Vec3, to: Vec3, bound: SkullBound): boolean {
  const d = sub(to, from), c = sub(bound.centre, from), l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = l2 > 0 ? Math.max(0, Math.min(1, (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]) / l2)) : 0;
  return Math.hypot(c[0] - d[0] * t, c[1] - d[1] * t, c[2] - d[2] * t) <= bound.radius;
}

/** THE RAY A PROJECTILE'S STEP CASTS AT ONE ACTOR'S SKULL (null: none).
 *  `open` false (a closed head, the sculpted skull, any actor whose head split is not drawn): from the flesh impact,
 *  a bullet's reach on, and nothing for a step that met no flesh. That is the rule a head has always had.
 *  `open` (the head split is drawn, on the anatomical skull): bone stands in the gap with no flesh in front of it.
 *    A step that met the flesh is cast from its START, as far as the flesh and a bullet's reach on: the nearest plate
 *      on the line is the one damaged, in front of the flesh or behind it.
 *    A step that met none is cast along its whole length, when it passes the skull's `bound` (asked only then; null:
 *      no bound to test, cast). The projectile carries on.
 *    `struck` (this projectile has damaged this skull already): no cast. */
export function skullShotCast(open: boolean, step: SkullShotStep, struck = false, bound?: () => SkullBound | null): SkullCast | null {
  if (!open) return step.flesh ? { origin: step.flesh, direction: step.direction, reach: SKULL_REACH } : null;
  if (struck) return null;
  const length = (to: Vec3) => Math.hypot(to[0] - step.from[0], to[1] - step.from[1], to[2] - step.from[2]);
  if (step.flesh) return { origin: step.from, direction: step.direction, reach: length(step.flesh) + SKULL_REACH };
  const reach = length(step.to), near = reach > 0 ? bound?.() : null;
  if (!(reach > 0) || (near && !segmentInBound(step.from, step.to, near))) return null;
  return { origin: step.from, direction: step.direction, reach };
}
