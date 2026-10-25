// src/lab/sdf-zombie/webgpu/grid-navigation.ts
//
// GRID NAVIGATION CORE: an 8-connected grid of standable cells over a level's bounds, a BFS route
// between the nearest reachable cells, and `follow` (the furthest waypoint reachable in a straight
// line). What "standable" and "travel" mean is the level's business: room levels
// (encounter-navigation.ts) test rooms, tunnels and boxes; sector levels (sector-navigation.ts) test
// sector floors, steps and walls. Extracted unchanged from encounter-navigation.ts.
//
// Pure: no three.js, no DOM.

import type { Vec3 } from '../types';
import type { WanderBounds } from '../wander';

export interface GridNavSpec {
  bounds: WanderBounds;
  step: number;
  canStand(p: Vec3): boolean;
  canTravel(a: Vec3, b: Vec3): boolean;
  roomAt(p: Vec3): number;
  /** Feet height at p (0 on room levels). Also each waypoint's y: the floor under its cell centre. */
  floorAt(p: Vec3): number;
  /** Travel is one-way (sector levels: drops yes, climbs no). The route then ends at the cell nearest
   *  `to` in the first BFS layer holding a cell within NEAREST_M of `to` joined to it either way (it may
   *  be unable to walk onto `to`: the foot of a ledge the target stands on), instead of the
   *  nearest cell `to` can travel to, which may sit on a ledge nothing below reaches (a target a
   *  smaller body stands on at the foot of a riser). Default false: room levels. */
  oneWay?: boolean;
}

export interface EncounterNavigation {
  readonly bounds: WanderBounds;
  canStand(p: Vec3): boolean;
  canTravel(a: Vec3, b: Vec3): boolean;
  /** Waypoints from `from` to `to` (the last is `to` itself); [] when there is no way. On one-way
   *  levels (sector levels) the waypoint before `to` is a reachable cell within 1.5 m of it that may
   *  not walk onto it (the foot of a ledge the target stands on), and [] means no reachable cell is
   *  within 1.5 m of `to` joined to it either way. A waypoint's y
   *  is the floor under its grid cell's centre (`floorAt`), not the feet height of a body standing
   *  there: a cell whose disc overhangs a higher floor still says the lower one. */
  route(from: Vec3, to: Vec3): Vec3[];
  /** The furthest waypoint of `path` reachable from `from` in a straight line, or null. */
  follow(from: Vec3, path: readonly Vec3[]): Vec3 | null;
  roomAt(p: Vec3): number;
  /** The floor under p: 0 everywhere on room levels; the sector's floor on sector levels, NaN off the map. */
  floorAt(p: Vec3): number;
}

/** How far `nearest` looks for a grid cell (m). */
const NEAREST_M = 1.5;

export function createGridNavigation(spec: GridNavSpec): EncounterNavigation {
  const { bounds, step, canStand, canTravel, roomAt, floorAt, oneWay = false } = spec;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step), nz = Math.ceil((bounds.maxZ - bounds.minZ) / step);
  const cx = (i: number) => bounds.minX + (i % nx + .5) * step, cz = (i: number) => bounds.minZ + (Math.floor(i / nx) + .5) * step;
  const open = Uint8Array.from({ length: nx * nz }, (_, i) => canStand([cx(i), 0, cz(i)]) ? 1 : 0);
  // Waypoints sit on the floor (0 on room levels).
  const floorY = Float64Array.from({ length: nx * nz }, (_, i) => open[i] ? floorAt([cx(i), 0, cz(i)]) : 0);
  const point = (i: number): Vec3 => [cx(i), floorY[i]!, cz(i)];
  const edges = Array.from({ length: open.length }, () => [] as number[]);
  for (let i = 0; i < open.length; i++)
    if (open[i])
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = i % nx + dx!, z = Math.floor(i / nx) + dz!;
        if (x < 0 || x >= nx || z < 0 || z >= nz)
          continue;
        const j = z * nx + x;
        if (open[j] && canTravel(point(i), point(j)))
          edges[i]!.push(j);
      }
  // Visits only the window of cells that can lie within NEAREST_M of p, in index order, so `nearest`
  // picks the same cell as a scan of the whole grid.
  const inWindow = (p: Vec3, visit: (i: number) => void) => {
    const c0 = Math.max(0, Math.floor((p[0] - NEAREST_M - bounds.minX) / step) - 1);
    const c1 = Math.min(nx - 1, Math.ceil((p[0] + NEAREST_M - bounds.minX) / step) + 1);
    const r0 = Math.max(0, Math.floor((p[2] - NEAREST_M - bounds.minZ) / step) - 1);
    const r1 = Math.min(nz - 1, Math.ceil((p[2] + NEAREST_M - bounds.minZ) / step) + 1);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) visit(r * nx + c);
  };
  /** One-way travel: the open cells within NEAREST_M joined to `to` either way. */
  const arrivals = (to: Vec3): Set<number> => {
    const out = new Set<number>();
    inWindow(to, i => {
      if (open[i]) {
        const q = point(i);
        if (Math.hypot(q[0] - to[0], q[2] - to[2]) < NEAREST_M && (canTravel(q, to) || canTravel(to, q))) out.add(i);
      }
    });
    return out;
  };
  const nearest = (p: Vec3) => {
    let best = -1, dist = Infinity;
    inWindow(p, i => {
      if (open[i]) {
        const q = point(i), d = Math.hypot(q[0] - p[0], q[2] - p[2]);
        if (d < dist && d < NEAREST_M && canTravel(p, q)) {
          best = i;
          dist = d;
        }
      }
    });
    return best;
  };
  const route = (from: Vec3, to: Vec3): Vec3[] => {
    if (canTravel(from, to))
      return [[...to] as Vec3];
    const start = nearest(from), ends = oneWay ? arrivals(to) : null;
    let end = ends ? (ends.has(start) ? start : -1) : nearest(to);
    if (start < 0 || (ends ? ends.size === 0 : end < 0))
      return [];
    const parent = new Int32Array(open.length).fill(-1), queue = [start];
    parent[start] = start;
    if (ends) {
      // One-way: finish the BFS layer of the first arrival and take the arrival nearest `to`.
      const depth = new Int32Array(open.length), gap = (i: number) => { const q = point(i); return Math.hypot(q[0] - to[0], q[2] - to[2]); };
      let endDepth = end >= 0 ? 0 : -1, endGap = end >= 0 ? gap(end) : Infinity;
      for (let at = 0; at < queue.length && !(end >= 0 && depth[queue[at]!]! >= endDepth); at++)
        for (const j of edges[queue[at]!]!)
          if (parent[j] === -1) {
            parent[j] = queue[at]!;
            depth[j] = depth[queue[at]!]! + 1;
            queue.push(j);
            if (ends.has(j) && (end < 0 || gap(j) < endGap)) { end = j; endDepth = depth[j]!; endGap = gap(j); }
          }
      if (end < 0)
        return [];
    } else {
      for (let at = 0; at < queue.length && parent[end] === -1; at++)
        for (const j of edges[queue[at]!]!)
          if (parent[j] === -1) {
            parent[j] = queue[at]!;
            queue.push(j);
          }
      if (parent[end] === -1)
        return [];
    }
    const path: Vec3[] = [];
    for (let i = end; i !== start; i = parent[i]!)
      path.push(point(i));
    path.reverse();
    path.push([...to] as Vec3);
    return path;
  };
  const follow = (from: Vec3, path: readonly Vec3[]): Vec3 | null => {
    for (let i = path.length - 1; i >= 0; i--)
      if (canTravel(from, path[i]!))
        return path[i]!;
    return null;
  };
  return { bounds, canStand, canTravel, route, follow, roomAt, floorAt };
}
