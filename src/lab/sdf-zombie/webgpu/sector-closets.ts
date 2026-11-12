// src/lab/sdf-zombie/webgpu/sector-closets.ts
//
// MONSTER CLOSETS (2026-11-08): sectors Doom keeps shut until the player crosses a walk-over line. MAP28's first corner
// hides eight revenants (our flayers) behind s115, a wall-thick sector whose ceiling sits on its floor until line 735
// raises it; s104-s106 are an imp ledge hidden over s103's ceiling until a line lowers it. The importer used to write
// them open from load, so the crowd behind them was drawn (and marched) from the start. The level file's `closets`
// (sector-def.ts SectorClosetDef) say which sectors, what moves and where it rests shut; this module is the rest:
//
//   - shutting at load: the live sector's ceiling (or floor) is written at `shut`. The file's heights are the OPEN ones,
//     so whatever is built from the map before the game shuts it (the static mesh, navigation, the portal graph) sees the
//     closet open: enemies route out of it once it opens, the portal flood has its lines to open again;
//   - every height reader follows the live sector (the lifts' rule, sector-lifts.ts): a shut closet's lines have no
//     opening, so the ground blocks bodies (sector-ground.ts lineBlocks, navigation's canTravel), rays stop at them
//     (sight, shots, the render's occlusion: sector-ray.ts), and `lineShut` closes them to the portal flood
//     (game-zone-cull.ts), so the bodies behind are culled until it opens;
//   - opening: `fire(event)` starts every closet waiting for it; `step` moves the height to the open one at `speed` and
//     it stays open (Doom's 'open, stay': a raise variant that would close again is opened for good);
//   - the block: the mesh that fills the shut part (closetBlockMesh), squeezed by game-closets.ts as it opens.
//
// Pure: no three.js, no DOM.

import type { SectorClosetDef, SectorMap } from './sector-def';
import { sectorPolygons } from './sector-geometry';

/** Leaf travel for a file closet that leaves it out (Doom's door speed, near enough). */
export const CLOSET_SPEED_M_S = 3;

export type ClosetPhase = 'shut' | 'opening' | 'open';
export interface ClosetEvent { closet: number; phase: ClosetPhase }

export interface ClosetRuntime {
  readonly defs: readonly SectorClosetDef[];
  /** Per closet, its open height (the file's ceiling for 'ceil', floor for 'floor'). */
  readonly open: Float64Array;
  /** Per closet, the live moving height. */
  readonly at: Float64Array;
  readonly phase: ClosetPhase[];
  /** Per line, the closet whose sector it borders, or -1. */
  readonly lineCloset: Int32Array;
  /** Whether line i borders a closet that is still shut (no opening: the portal flood's closed line). */
  lineShut(i: number): boolean;
  /** A level event: every shut closet waiting for it starts opening. Returns their indices. */
  fire(event: string): number[];
  /** Move the opening closets; writes the live sector heights. Returns the phase changes. */
  step(dt: number): ClosetEvent[];
}

/** The closets of `map`, shut now (`shut` false, `?closets=0`: left open, as the old import wrote them, and inert). */
export function createClosets(map: SectorMap, shut = true): ClosetRuntime {
  const defs = map.closets ?? [];
  const open = Float64Array.from(defs, d => (d.moves === 'ceil' ? map.sectors[d.sector]!.ceil : map.sectors[d.sector]!.floor));
  const at = Float64Array.from(defs, (d, i) => (shut ? d.shut : open[i]!));
  const phase: ClosetPhase[] = defs.map(() => (shut ? 'shut' : 'open'));
  const write = (i: number) => {
    const d = defs[i]!, s = map.sectors[d.sector]!;
    if (d.moves === 'ceil') s.ceil = at[i]!; else s.floor = at[i]!;
  };
  defs.forEach((_, i) => write(i));
  const bySector = new Map(defs.map((d, i) => [d.sector, i]));
  const lineCloset = Int32Array.from(map.lines, l => bySector.get(l.front) ?? bySector.get(l.back) ?? -1);
  return {
    defs, open, at, phase, lineCloset,
    lineShut: i => { const c = lineCloset[i]!; return c >= 0 && phase[c] === 'shut'; },
    fire(event) {
      const out: number[] = [];
      defs.forEach((d, i) => { if (d.opensOn === event && phase[i] === 'shut') { phase[i] = 'opening'; out.push(i); } });
      return out;
    },
    step(dt) {
      const events: ClosetEvent[] = [];
      if (!(dt > 0)) return events;
      defs.forEach((d, i) => {
        if (phase[i] !== 'opening') return;
        const dir = Math.sign(open[i]! - d.shut);
        at[i] = dir >= 0 ? Math.min(open[i]!, at[i]! + d.speed * dt) : Math.max(open[i]!, at[i]! - d.speed * dt);
        if (at[i] === open[i]) { phase[i] = 'open'; events.push({ closet: i, phase: 'open' }); }
        write(i);
      });
      return events;
    },
  };
}

/** The share of its travel a closet has made: 0 shut, 1 open. */
export function closetOpenFraction(rt: ClosetRuntime, i: number): number {
  const span = rt.open[i]! - rt.defs[i]!.shut;
  return span === 0 ? 1 : Math.min(1, Math.max(0, (rt.at[i]! - rt.defs[i]!.shut) / span));
}

const UV_TILE_M = 4;
export interface ClosetMeshData { position: number[]; normal: number[]; uv: number[]; mottleUv: number[]; lamp: number[]; spill: number[]; count: number }

/** The block that fills a shut closet: the sector's footprint from `lo` to `hi` (the shut and open heights, whichever
 *  way round), sides facing out under each edge and the moving cap (facing down for a 'ceil' closet, at `lo`; up for a
 *  'floor' one, at `hi`). game-closets.ts slides it by (at - shut) and clamps every vertex into [lo, hi], so it squeezes
 *  into the open height and is gone when open. `triangulate`: the renderer's earcut; the default fan is for a convex loop. */
export function closetBlockMesh(map: SectorMap, def: SectorClosetDef, openHeight: number,
  triangulate: (outer: readonly (readonly [number, number])[]) => number[][] = o => o.slice(2).map((_, i) => [0, i + 1, i + 2])): ClosetMeshData {
  const out: ClosetMeshData = { position: [], normal: [], uv: [], mottleUv: [], lamp: [], spill: [], count: 0 };
  const push = (x: number, y: number, z: number, n: readonly [number, number, number], u: number, v: number) => {
    out.position.push(x, y, z); out.normal.push(n[0], n[1], n[2]);
    out.uv.push(u / UV_TILE_M, v / UV_TILE_M); out.mottleUv.push(u / UV_TILE_M, v / UV_TILE_M);
    out.lamp.push(0); out.spill.push(0);
    out.count++;
  };
  const lo = Math.min(def.shut, openHeight), hi = Math.max(def.shut, openHeight);
  const capUp = def.moves === 'floor';
  const capY = capUp ? hi : lo;
  const n = [0, capUp ? 1 : -1, 0] as const;
  for (const poly of sectorPolygons(map)) {
    if (poly.sector !== def.sector) continue;
    const o = poly.outer;
    for (const tri of triangulate(o)) {
      const [a, b, c] = tri as [number, number, number];
      // Seen from above (+y) this winding faces up; a cap facing down takes the other.
      const up = (o[b]![1] - o[a]![1]) * (o[c]![0] - o[a]![0]) - (o[b]![0] - o[a]![0]) * (o[c]![1] - o[a]![1]) > 0;
      for (const k of up === capUp ? [a, b, c] : [a, c, b]) push(o[k]![0], capY, o[k]![1], n, o[k]![0], o[k]![1]);
    }
    for (let i = 0; i < o.length; i++) {
      const a = o[i]!, b = o[(i + 1) % o.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const sn = [(b[1] - a[1]) / len, 0, -(b[0] - a[0]) / len] as const;    // outward: the sector is on the left
      const quad: [readonly [number, number], number][] = [[a, lo], [a, hi], [b, hi], [a, lo], [b, hi], [b, lo]];
      for (const [p, y] of quad) push(p[0], y, p[1], sn, p === a ? 0 : len, y);
    }
  }
  return out;
}
