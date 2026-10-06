/** Anatomical skull damage and ray selection. Pure data; metres in the head frame. */
import type { Vec3 } from './types';

export interface SkullPieceSurface {
  id: string;
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  pivot: Vec3;
  min: Vec3;
  max: Vec3;
}
export interface SkullDamage { missing: number; hits: readonly number[] }
export const intactSkull = (count: number): SkullDamage => ({ missing: 0, hits: Array(count).fill(0) });
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

/** A ray's first bone: the plate, and how far along the ray (head-frame metres) its surface is. */
export interface SkullRayHit { plate: number; distance: number }

/** Exact two-sided triangle hit, bounded to the bullet's penetration into the head.
 * A bounding-box-only hit would break frontal bone even through an empty orbit.
 * `accept`, when given, is asked about each triangle hit's point (head frame) and its plate: a hit it refuses is not
 * bone the ray meets there (a split skull's copy shows only what its piece owns), and the ray carries on to the next
 * surface. */
export function skullRayCast(
  pieces: readonly SkullPieceSurface[], state: SkullDamage, origin: Vec3, direction: Vec3, reach = 0.14,
  accept?: (point: Vec3, plate: number) => boolean,
): SkullRayHit | null {
  const length = Math.hypot(...direction);
  if (length < 1e-9 || !Number.isFinite(length)) return null;
  const ray: Vec3 = [direction[0]/length,direction[1]/length,direction[2]/length];
  let closest = reach, result: number | null = null;
  pieces.forEach((piece, index) => {
    if (state.missing & (1 << index)) return;
    let enter = 0, leave = closest;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(ray[axis]!) < 1e-9) {
        if (origin[axis]! < piece.min[axis]! || origin[axis]! > piece.max[axis]!) return;
      } else {
        const a = (piece.min[axis]!-origin[axis]!)/ray[axis]!;
        const b = (piece.max[axis]!-origin[axis]!)/ray[axis]!;
        enter = Math.max(enter, Math.min(a,b)); leave = Math.min(leave, Math.max(a,b));
        if (enter > leave) return;
      }
    }
    const vertex = (i: number): Vec3 => [piece.positions[i*3]!,piece.positions[i*3+1]!,piece.positions[i*3+2]!];
    for (let i = 0; i < piece.indices.length; i += 3) {
      const a = vertex(piece.indices[i]!), b = vertex(piece.indices[i+1]!), c = vertex(piece.indices[i+2]!);
      const e1 = sub(b,a), e2 = sub(c,a), p = cross(ray,e2), det = dot(e1,p);
      if (Math.abs(det) < 1e-10) continue;
      const t = sub(origin,a), u = dot(t,p)/det;
      if (u < 0 || u > 1) continue;
      const q = cross(t,e1), v = dot(ray,q)/det;
      if (v < 0 || u+v > 1) continue;
      const distance = dot(e2,q)/det;
      if (!(distance >= 0 && distance < closest)) continue;
      if (accept && !accept([origin[0]+ray[0]*distance,origin[1]+ray[1]*distance,origin[2]+ray[2]*distance],index)) continue;
      closest = distance; result = index;
    }
  });
  return result === null ? null : { plate: result, distance: closest };
}

/** The plate skullRayCast hits (null: none within reach). */
export function skullRayHit(pieces: readonly SkullPieceSurface[], state: SkullDamage, origin: Vec3, direction: Vec3, reach = 0.14): number | null {
  return skullRayCast(pieces,state,origin,direction,reach)?.plate ?? null;
}

export function damageSkull(state: SkullDamage, piece: number | null, kind: 'pellet' | 'slug'): { state: SkullDamage; detached: number[] } {
  if (piece === null || piece < 0 || piece >= state.hits.length || state.missing & (1 << piece)) return { state, detached: [] };
  const hits = [...state.hits];
  hits[piece] = hits[piece]! + (kind === 'slug' ? 3 : 1);
  const broke = hits[piece]! >= 3;
  return { state: { hits, missing: state.missing | (broke ? 1 << piece : 0) }, detached: broke ? [piece] : [] };
}

export function explodeSkull(state: SkullDamage): { state: SkullDamage; detached: number[] } {
  const detached = state.hits.map((_, i) => i).filter(i => !(state.missing & (1 << i)));
  return { state: { hits: state.hits, missing: (1 << state.hits.length)-1 }, detached };
}

/** Stable piece-specific tumble; never consumes the gameplay RNG stream. */
export function skullPieceLaunch(pivot: Vec3, centre: Vec3, direction: Vec3, index: number): { velocity: Vec3; angular: Vec3 } {
  const outward = sub(pivot,centre), length = Math.hypot(...outward) || 1;
  const dl = Math.hypot(...direction) || 1;
  const velocity: Vec3 = [outward[0]/length*1.4+direction[0]/dl*2.2,
    outward[1]/length*1.4+direction[1]/dl*2.2+1.3,outward[2]/length*1.4+direction[2]/dl*2.2];
  return { velocity, angular: [((index*7)%9)-4, ((index*3)%11)-5, ((index*5)%7)-3] };
}
