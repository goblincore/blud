// src/lab/sdf-zombie/webgpu/sector-lifts.ts
//
// SECTOR LIFTS (2026-11-01): a sector whose floor moves between `low` (the sector's floor in the file, so the static
// mesh draws the shaft's risers at their full height) and `top`, where it rests. MAP28 needs one: the drop from s80 to s0
// is one way and the lift at s82 is the only way back up, so with locks a player holding the yellow key could not reach
// the yellow door without it. Doom's rule, without a use key: the player walks up to it from below and it comes down,
// waits, rises when stood on or when the wait runs out. Enemies do not call it (they ride it if they are on it).
//
// A step writes the live `floor` of the map's sector: every floor reader (the ground's floorAt and blocking test, rays,
// bodies) reads that, so they all follow. Navigation is built once with the lift at the top: enemies walk across it
// and nothing routes up through it. game-lifts.ts draws the moving block; this module also holds its mesh data.
//
// Pure: no three.js, no DOM.

import type { SectorLiftDef, SectorMap } from './sector-def';
import { SECTOR_STEP_M } from './sector-def';
import { sectorPolygons } from './sector-geometry';

/** The map as the static mesh draws it: each lift sector at its low position, so the shaft's risers have their full
 *  height and the moving block (game-lifts.ts) covers them. The live map's floor rests at `top` from the parser on, so
 *  navigation, built before the meshes, sees the lift where it rests. */
export function withLiftsLow(map: SectorMap): SectorMap {
  if (!map.lifts?.length) return map;
  const sectors = map.sectors.slice();
  for (const l of map.lifts) sectors[l.sector] = { ...sectors[l.sector]!, floor: l.low };
  return { ...map, sectors };
}

/** The player within this of the lift's edge, below it, calls it. */
export const LIFT_TRIGGER_M = 1.5;
export const LIFT_SPEED_M_S = 2.5;
/** How long it waits at the bottom for someone to step on. */
export const LIFT_WAIT_S = 4;
/** Standing on it this long at the bottom sends it up. */
export const LIFT_BOARD_S = 0.4;

export type LiftPhase = 'top' | 'lowering' | 'bottom' | 'rising';
export interface LiftState { phase: LiftPhase; floor: number; hold: number }
export const restingLift = (def: SectorLiftDef): LiftState => ({ phase: 'top', floor: def.top, hold: 0 });

/** One tick. `called`: the player is below it, at its edge. `aboard`: the player stands on it. Mutates `st`; true when
 *  the phase changed. A lift that is on its way up turns back for a call only from the top (a body on it rides on). */
export function stepLift(def: SectorLiftDef, st: LiftState, dt: number, called: boolean, aboard: boolean): boolean {
  const before = st.phase;
  switch (st.phase) {
    case 'top':
      if (called) st.phase = 'lowering';
      break;
    case 'lowering':
      st.floor = Math.max(def.low, st.floor - def.speed * dt);
      if (st.floor <= def.low) { st.phase = 'bottom'; st.hold = def.wait; }
      break;
    case 'bottom':
      if (aboard) st.hold = Math.min(st.hold, LIFT_BOARD_S);
      else if (called) st.hold = def.wait;
      st.hold -= dt;
      if (st.hold <= 0) st.phase = 'rising';
      break;
    case 'rising':
      st.floor = Math.min(def.top, st.floor + def.speed * dt);
      if (st.floor >= def.top) st.phase = 'top';
      break;
  }
  return st.phase !== before;
}

/** Squared distance from (x, z) to the nearest of the lift sector's lines. */
export function liftEdgeDist2(map: SectorMap, sector: number, x: number, z: number): number {
  let best = Infinity;
  for (const l of map.lines) {
    if (l.front !== sector && l.back !== sector) continue;
    const a = map.vertices[l.v[0]]!, b = map.vertices[l.v[1]]!;
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    const dx = a[0] + ex * t - x, dz = a[1] + ez * t - z;
    best = Math.min(best, dx * dx + dz * dz);
  }
  return best;
}

/** The player at (x, feetY, z) in `sectorNow` calls the lift: not on it, at its edge, too far below its top to step up. */
export function callsLift(map: SectorMap, def: SectorLiftDef, sectorNow: number, x: number, feetY: number, z: number): boolean {
  if (sectorNow === def.sector || def.top - feetY <= SECTOR_STEP_M) return false;
  return liftEdgeDist2(map, def.sector, x, z) <= LIFT_TRIGGER_M * LIFT_TRIGGER_M;
}

/** The moving block's lamp strip height (metres) along the top of each side: the cue that this wall moves. */
export const LIFT_LAMP_M = 0.09;
const UV_TILE_M = 4;

export interface LiftMeshData { position: number[]; normal: number[]; uv: number[]; mottleUv: number[]; lamp: number[]; spill: number[]; count: number }

/** The moving block at its LOW position (game-lifts.ts lifts it by floor - low): the cap and a side under each edge
 *  reaching `top - low` down, its upper strip the lamp. `triangulate`: the renderer's earcut (sector-geometry.ts leaves
 *  triangulation to it); the default fan is for a convex loop. */
export function liftBlockMesh(map: SectorMap, def: SectorLiftDef,
  triangulate: (outer: readonly (readonly [number, number])[]) => number[][] = o => o.slice(2).map((_, i) => [0, i + 1, i + 2])): LiftMeshData {
  const out: LiftMeshData = { position: [], normal: [], uv: [], mottleUv: [], lamp: [], spill: [], count: 0 };
  const push = (x: number, y: number, z: number, n: readonly [number, number, number], u: number, v: number, lamp: number) => {
    out.position.push(x, y, z); out.normal.push(n[0], n[1], n[2]);
    out.uv.push(u / UV_TILE_M, v / UV_TILE_M); out.mottleUv.push(u / UV_TILE_M, v / UV_TILE_M);
    out.lamp.push(lamp); out.spill.push(0);
    out.count++;
  };
  const up = [0, 1, 0] as const;
  const H = def.top - def.low;
  for (const poly of sectorPolygons(map)) {
    if (poly.sector !== def.sector) continue;
    const o = poly.outer;
    for (const tri of triangulate(o)) {
      const [a, b, c] = tri as [number, number, number];
      // Seen from above (+y): swap to the winding that faces up.
      const faces = (o[b]![1] - o[a]![1]) * (o[c]![0] - o[a]![0]) - (o[b]![0] - o[a]![0]) * (o[c]![1] - o[a]![1]) > 0;
      for (const k of faces ? [a, b, c] : [a, c, b]) push(o[k]![0], def.low, o[k]![1], up, o[k]![0], o[k]![1], 0);
    }
    for (let i = 0; i < o.length; i++) {
      const a = o[i]!, b = o[(i + 1) % o.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const n = [(b[1] - a[1]) / len, 0, -(b[0] - a[0]) / len] as const;    // outward: the sector is on the left
      const band = (y0: number, y1: number, lamp: number) => {
        // a -> b seen from outside runs right to left: (a low, a high, b high), (a low, b high, b low) faces n.
        const quad: [readonly [number, number], number][] = [[a, y0], [a, y1], [b, y1], [a, y0], [b, y1], [b, y0]];
        for (const [p, y] of quad) {
          const along = (p === a ? 0 : len);
          push(p[0], y, p[1], n, along, y, lamp);
        }
      };
      band(def.low - H, def.low - LIFT_LAMP_M, 0);
      band(def.low - LIFT_LAMP_M, def.low, 1);
    }
  }
  return out;
}
