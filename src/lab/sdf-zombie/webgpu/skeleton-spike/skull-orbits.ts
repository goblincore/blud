// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-orbits.ts
//
// Where an anatomical skull's eyes sit, and how big they are: in its own orbits, found on its own fitted triangles.
//
// WHERE AN ANATOMICAL SKULL'S EYES SIT: in its own orbits, found on its own triangles. Pure CPU, no three, no DOM.
//
// The skull is looked at straight on from the front (down -z of its frame: +y up, +z out of the face), as the depth
// of the first bone each ray meets (frontDepth). In that view an ORBIT is a closed basin: fill it from behind and it
// holds up to the lowest point of its rim, where it would spill over the side of the face. The two largest such
// basins are the orbits (on the shipped asset ~900 mm2 each; the next basin is under a tenth of that, and the nasal
// opening holds nothing, it drains downward). An orbit's centre is the centroid of that filled outline, its depth the
// spill level (the rim's lowest point), its radius the radius of the disc of the outline's area. Nothing here is told
// where the orbits are, so a rebuilt or re-posed asset is measured, not assumed: the skull is not left/right
// symmetric, and its face sits a few mm off the middle of its bounds.
//
// THE SEAT (orbitEyeSeat). An eye is a ball about as wide as the orbit's opening, set back so that the bone hides
// its edge. Its pole goes ORBIT_EYE_RECESS radii behind the rim's lowest point. Across the opening it goes where
// WHAT SHOWS OF IT IS CENTRED ON IT: the centroid of the part of its disc the bone does not cover lies on the eye's
// own centre, so the pupil reads in the middle of the eye one sees. That is not the middle of the opening: an orbit
// narrows toward its inner back corner, and its outer wall leans in over a ball set this deep, so the seat ends a
// few mm inboard of the outline's centroid (1.9 and 2.7 mm on the zombie).
//
// THE FIT IS NOT THIS MODULE'S. The orbits are found on the FITTED plates, the triangles a head actually draws, so
// the seats follow whatever placed them there: today's scale-and-shift per character (anatomical-skull.ts
// skullFitMatrix), or a fit that bends the skull. Nothing is carried through a matrix.
import type { Vec3 } from '../../types';
import type { MeshEyePlacement } from './mesh-eyes';

/** Triangles: xyz per vertex, three indices per triangle (a FittedSkullPiece, a geometry's attribute arrays). */
export interface SkullSurface { positions: ArrayLike<number>; indices: ArrayLike<number> }

/** The front view: per cell, the z of the front-most surface on the ray down -z through the cell's centre
 *  (x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell), at z[j * nx + i]; -Infinity where the ray meets nothing. The grid
 *  spans the surfaces' bounds and one empty cell beyond them on every side. `cell` omitted: FRONT_CELLS of them. */
export interface FrontDepth { x0: number; y0: number; cell: number; nx: number; ny: number; z: Float32Array }

/** An orbit, in the frame of the depth map it was found in: `centre` = (the opening's centroid, the lowest point of
 *  its rim along z), `radius` = that of a disc with the opening's area. */
export interface SkullOrbit { centre: Vec3; radius: number }

/** How far behind the lowest point of its orbit's rim an eye's pole sits, in eye radii. 0.3 keeps the zombie's eyes
 *  at the depth they had in the sculpted skull's sockets (47.0 mm in the head's frame; 45.7 and 47.3 here) with as
 *  much bone over them (51.9% of the disc there; 52% and 50% here). */
export const ORBIT_EYE_RECESS = 0.3;

/** How hard the opening's centre holds an eye against the pull that centres what shows of it: the eye rests where
 *  that offset equals this share of its distance from the opening's centre. It decides nothing where the bone
 *  does (the zombie's eyes rest 0.1 to 0.2 mm short of exactly centred), and it decides where the bone leaves the
 *  choice open: a small eye in a tall orbit shows almost whole wherever it stands along it, and without the hold
 *  two such eyes come to rest 2 mm apart in height. */
export const ORBIT_EYE_HOLD = 0.05;

/** AN EYE'S SIZE IN ITS ORBIT: its radius as a share of the orbit's (the radius of a disc with the opening's area).
 *  A little over 1: the ball is wider than the opening, so the rim hides its edge. 1.13 is the zombie's eye in its
 *  anatomical orbits as the seats were tuned (a 19.1 mm eye in orbits of 16.9 mm, half the disc under bone). Both
 *  eyes of a skull are given one size, from the mean of its two orbits. */
export const ORBIT_EYE_SIZE = 1.13;

/** The radius of the eyes of a skull with these orbits (ORBIT_EYE_SIZE of their mean radius); 0 with none. */
export function orbitEyeRadius(orbits: readonly SkullOrbit[]): number {
  return orbits.length ? ORBIT_EYE_SIZE * orbits.reduce((sum, o) => sum + o.radius, 0) / orbits.length : 0;
}

/** How many cells a front view has when no cell size is given: the cell is the square that tiles the surfaces'
 *  bounds this many times (1 mm on the life-size skull). The orbits do not depend on it: the real skull's centres
 *  move under 0.2 mm between 0.5 mm and 2 mm cells. */
export const FRONT_CELLS = 30000;

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function frontDepth(surfaces: readonly SkullSurface[], cell?: number): FrontDepth {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of surfaces) for (let i = 0; i < s.positions.length; i += 3) {
    minX = Math.min(minX, s.positions[i]!); maxX = Math.max(maxX, s.positions[i]!);
    minY = Math.min(minY, s.positions[i + 1]!); maxY = Math.max(maxY, s.positions[i + 1]!);
  }
  const empty = !(maxX >= minX);
  cell ??= empty ? 0 : Math.sqrt((maxX - minX) * (maxY - minY) / FRONT_CELLS);
  if (empty || !(cell > 0)) return { x0: 0, y0: 0, cell: 0, nx: 0, ny: 0, z: new Float32Array(0) };
  const x0 = minX - cell, y0 = minY - cell;
  const nx = Math.ceil((maxX - minX) / cell) + 2, ny = Math.ceil((maxY - minY) / cell) + 2;
  const z = new Float32Array(nx * ny).fill(-Infinity);
  for (const s of surfaces) {
    const p = s.positions, ix = s.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
      const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!, bx = p[b]!, by = p[b + 1]!, cx = p[c]!, cy = p[c + 1]!;
      const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (det === 0) continue;   // edge-on to the view
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / cell - 0.5));
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / cell - 0.5)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / cell - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
        const u = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / det, v = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const hit = az + u * (p[b + 2]! - az) + v * (p[c + 2]! - az), k = j * nx + i;
        if (hit > z[k]!) z[k] = hit;
      }
    }
  }
  return { x0, y0, cell, nx, ny, z };
}

/** The level each cell fills to before it spills to the outside (the grid's border and every cell with nothing in
 *  it): the lowest, over all ways out, of the highest bone on the way. Cells are taken lowest level first from the
 *  outside in (a binary heap of cell indices keyed by level). */
function fillLevels({ nx, ny, z }: FrontDepth): Float32Array {
  const level = new Float32Array(nx * ny).fill(NaN), heap: number[] = [];
  const push = (k: number) => {
    let i = heap.length;
    heap.push(k);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (level[heap[up]!]! <= level[k]!) break;
      heap[i] = heap[up]!; i = up;
    }
    heap[i] = k;
  };
  const pop = (): number => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length === 0) return top;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= heap.length) break;
      if (child + 1 < heap.length && level[heap[child + 1]!]! < level[heap[child]!]!) child++;
      if (level[heap[child]!]! >= level[last]!) break;
      heap[i] = heap[child]!; i = child;
    }
    heap[i] = last;
    return top;
  };
  for (let k = 0; k < nx * ny; k++) {
    const i = k % nx, j = (k - i) / nx;
    if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1 || z[k] === -Infinity) { level[k] = z[k]!; push(k); }
  }
  while (heap.length) {
    const k = pop(), i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of NEIGHBOURS) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const q = b * nx + a;
      if (!Number.isNaN(level[q]!)) continue;
      level[q] = Math.max(z[q]!, level[k]!);
      push(q);
    }
  }
  return level;
}

/** The skull's orbits: the two largest closed basins of its front view, the one at lower x first (the skull's own
 *  right: the order of the sculpt's seats, mesh-eyes.ts). Fewer when the view holds fewer basins. */
export function skullOrbits(depth: FrontDepth): SkullOrbit[] {
  const { x0, y0, cell, nx, ny, z } = depth, level = fillLevels(depth);
  const held = (k: number) => level[k]! > z[k]!;
  const taken = new Uint8Array(nx * ny), basins: { area: number; orbit: SkullOrbit }[] = [];
  for (let start = 0; start < nx * ny; start++) {
    if (taken[start] || !held(start)) continue;
    const stack = [start];
    let count = 0, sx = 0, sy = 0, rim = -Infinity;
    taken[start] = 1;
    while (stack.length) {
      const k = stack.pop()!, i = k % nx, j = (k - i) / nx;
      count++; sx += i; sy += j; rim = Math.max(rim, level[k]!);
      for (const [di, dj] of NEIGHBOURS) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const q = b * nx + a;
        if (taken[q] || !held(q)) continue;
        taken[q] = 1; stack.push(q);
      }
    }
    const area = count * cell * cell;
    basins.push({ area, orbit: { centre: [x0 + (sx / count + 0.5) * cell, y0 + (sy / count + 0.5) * cell, rim], radius: Math.sqrt(area / Math.PI) } });
  }
  return basins.sort((a, b) => b.area - a.area).slice(0, 2).map(b => b.orbit).sort((a, b) => a.centre[0] - b.centre[0]);
}

/** An eye (the sphere of `radius` about `centre`) as the front view sees it: `seen` = the share of its disc the bone
 *  does not cover (a ray sees the eye when it reaches the sphere before any bone), `offset` = where the centroid of
 *  that part lies from the eye's centre, (x, y). Nothing seen: offset (0, 0). */
export function seenDisc(depth: FrontDepth, centre: Vec3, radius: number): { seen: number; offset: [number, number] } {
  const { x0, y0, cell, nx, ny, z } = depth;
  const i0 = Math.floor((centre[0] - radius - x0) / cell), i1 = Math.ceil((centre[0] + radius - x0) / cell);
  const j0 = Math.floor((centre[1] - radius - y0) / cell), j1 = Math.ceil((centre[1] + radius - y0) / cell);
  let all = 0, seen = 0, sx = 0, sy = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = x0 + (i + 0.5) * cell - centre[0], dy = y0 + (j + 0.5) * cell - centre[1];
    const q = radius * radius - dx * dx - dy * dy;
    if (q < 0) continue;
    all++;
    const bone = i < 0 || j < 0 || i >= nx || j >= ny ? -Infinity : z[j * nx + i]!;
    if (bone > centre[2] + Math.sqrt(q)) continue;
    seen++; sx += dx; sy += dy;
  }
  return { seen: all ? seen / all : 0, offset: seen ? [sx / seen, sy / seen] : [0, 0] };
}

/** The centre of an eye of `radius` seated in `orbit`: its pole ORBIT_EYE_RECESS radii behind the rim's lowest
 *  point, and, starting from the opening's centroid, moved across the opening until the offset of what shows of it
 *  (seenDisc) is balanced by the opening's hold (ORBIT_EYE_HOLD), to a twentieth of a cell. A step moves the eye by
 *  that imbalance, which is less than the move it corrects, so the steps shrink; 48 bounds them. */
export function orbitEyeSeat(depth: FrontDepth, orbit: SkullOrbit, radius: number): Vec3 {
  const seat: [number, number, number] = [orbit.centre[0], orbit.centre[1], orbit.centre[2] - radius * (1 + ORBIT_EYE_RECESS)];
  for (let step = 0; step < 48; step++) {
    const { offset } = seenDisc(depth, seat, radius);
    const mx = offset[0] - ORBIT_EYE_HOLD * (seat[0] - orbit.centre[0]), my = offset[1] - ORBIT_EYE_HOLD * (seat[1] - orbit.centre[1]);
    if (Math.hypot(mx, my) < depth.cell * 0.05) break;
    seat[0] += mx; seat[1] += my;
  }
  return seat;
}

/** The eyes of the skull whose front view is `depth`: one of `radius` seated in each of `orbits`, in their order. */
export function orbitEyePlacements(depth: FrontDepth, orbits: readonly SkullOrbit[], radius: number): MeshEyePlacement[] {
  return orbits.map(orbit => ({ center: orbitEyeSeat(depth, orbit, radius), radius }));
}
