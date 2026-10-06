// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-split-hit.ts
//
// A SHOT AT A SPLIT SKULL. The anatomical skull's plates are stored on the CLOSED head (skull-fracture.ts), and a
// split head draws them once per piece, each copy turned about the hinge by its piece's bone angle and clipped to
// what the piece owns (mesh-renderer.ts drawPieces, mesh-split.ts). A ray has to meet the bone where it is DRAWN, so
// the test here is the draw read backwards: for each piece, the ray is turned BACK by that piece's angle and cast at
// the closed plates, and a triangle hit counts only where the piece owns the hit point (the clip). The nearest hit
// over the pieces is the bone the ray meets.
//
// Pure (no three): the renderer hands in the head's frame as functions, so a closed head's test is the same
// arithmetic it always was.
import type { Vec3 } from '../../types';
import { HEAD_SPLIT, rotAxis, skullPieceAt, type SkullSplit } from '../../head-split';
import { skullRayCast, type SkullDamage, type SkullPieceSurface } from '../../skull-fracture';
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
  point: Vec3, direction: Vec3, jag: SplitJag = HEAD_SPLIT.skull.jag, reach = 0.14,
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
