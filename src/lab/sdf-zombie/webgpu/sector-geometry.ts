// src/lab/sdf-zombie/webgpu/sector-geometry.ts
//
// SECTOR GEOMETRY as plain data (spec 2026-10-24-doom-sector-levels-design.md §6.4): each sector's
// boundary as loops (outer polygons and their holes) for triangulating floors and ceilings, and
// one quad per visible wall part, oriented so its face points into the sector it is seen from
// (the face normal is the LEFT of a -> b in x/z). Triangulation itself is the renderer's (earcut,
// via three's ShapeUtils in game-sector-mesh.ts; earcutr in the Rust port).
//
// Pure: no three.js, no DOM.

import { SKY_MATERIAL, type SectorMap, type XZ } from './sector-def';
import { edgesArea, pointInEdges, sectorEdgeIndices } from './sector-edges';

export interface SectorPolygon { sector: number; outer: XZ[]; holes: XZ[][] }
export type WallPart = 'mid' | 'lower' | 'upper';
export interface WallQuad { a: XZ; b: XZ; y0: number; y1: number; sector: number; part: WallPart }

const loopEdges = (loop: readonly XZ[]): [XZ, XZ][] => loop.map((p, i) => [p, loop[(i + 1) % loop.length]!]);

/** Signed shoelace area in x/z. */
export function loopArea(loop: readonly XZ[]): number {
  return edgesArea(loopEdges(loop));
}

const pointInLoop = (x: number, z: number, loop: readonly XZ[]): boolean => pointInEdges(x, z, loopEdges(loop));

/** Splits a closed vertex walk at every vertex it visits twice, so each piece is a simple loop
 *  (tracing the free side of two pillars that touch at a corner is one walk through the corner). */
function splitAtRepeats(walk: readonly number[]): number[][] {
  const out: number[][] = [], stack: number[] = [];
  for (const vi of walk) {
    const at = stack.indexOf(vi);
    if (at >= 0) out.push(stack.splice(at + 1));                 // the sub-loop that returned here
    if (at >= 0) out[out.length - 1]!.unshift(vi);
    else stack.push(vi);
  }
  out.push(stack);
  return out;
}

/** The closed vertex loops bounding one sector, chained along DIRECTED edges (the sector is on
 *  the left of each, spec §4). At a vertex with several outgoing edges the sharpest left turn is
 *  taken (first met sweeping clockwise from the way back), which separates loops that pinch at
 *  a point whatever the line order. Outer loops come out positive, holes negative. */
function sectorLoops(map: SectorMap, sector: number): XZ[][] {
  const V = map.vertices;
  const edges = sectorEdgeIndices(map, sector);
  const outgoing = new Map<number, number[]>();
  edges.forEach((e, i) => { const o = outgoing.get(e[0]); if (o) o.push(i); else outgoing.set(e[0], [i]); });
  const used = new Array<boolean>(edges.length).fill(false);
  const loops: XZ[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    const loop: number[] = [];
    let e = start;
    while (!used[e]) {
      used[e] = true;
      const [a, b] = edges[e]!;
      loop.push(a);
      const back = Math.atan2(V[a]![1] - V[b]![1], V[a]![0] - V[b]![0]);
      let best = -1, bestAng = Infinity;
      for (const c of outgoing.get(b) ?? []) {
        const to = V[edges[c]![1]]!;
        let cw = back - Math.atan2(to[1] - V[b]![1], to[0] - V[b]![0]);
        while (cw <= 0) cw += 2 * Math.PI;
        while (cw > 2 * Math.PI) cw -= 2 * Math.PI;
        if (cw < bestAng) { bestAng = cw; best = c; }
      }
      if (best < 0 || best === start) break;                        // closed (or open: the parser refuses that)
      e = best;
    }
    for (const simple of splitAtRepeats(loop)) if (simple.length >= 3) loops.push(simple.map(vi => V[vi]!));
  }
  return loops;
}

/** Every sector as outer polygons with their holes: positive loops are outers, negative loops
 *  are holes of the smallest outer that contains them. */
export function sectorPolygons(map: SectorMap): SectorPolygon[] {
  const out: SectorPolygon[] = [];
  map.sectors.forEach((_, sector) => {
    const loops = sectorLoops(map, sector);
    const polys: SectorPolygon[] = loops.filter(l => loopArea(l) > 0).map(outer => ({ sector, outer, holes: [] }));
    for (const hole of loops.filter(l => loopArea(l) <= 0)) {
      const px = (hole[0]![0] + hole[1]![0]) / 2, pz = (hole[0]![1] + hole[1]![1]) / 2;   // on the hole's own edge, never inside an island
      let owner: SectorPolygon | undefined;
      for (const p of polys) {
        if (!pointInLoop(px, pz, p.outer)) continue;
        if (!owner || loopArea(p.outer) < loopArea(owner.outer)) owner = p;
      }
      owner?.holes.push(hole);
    }
    out.push(...polys);
  });
  return out;
}

/** Wall quads: one-sided lines full height; two-sided lines a lower riser (seen from the lower
 *  floor) and an upper lip (seen from the higher ceiling, skipped when both ceilings are sky).
 *  Each quad runs a -> b with its sector on the left: a part seen from the front sector keeps
 *  the line's direction, one seen from the back sector swaps it. */
export function wallQuads(map: SectorMap): WallQuad[] {
  const out: WallQuad[] = [];
  for (const l of map.lines) {
    const va = map.vertices[l.v[0]]!, vb = map.vertices[l.v[1]]!;
    const push = (y0: number, y1: number, sector: number, part: WallPart) => {
      if (y1 - y0 < 1e-4) return;
      out.push(sector === l.front ? { a: va, b: vb, y0, y1, sector, part } : { a: vb, b: va, y0, y1, sector, part });
    };
    const f = map.sectors[l.front]!;
    if (l.back < 0) { push(f.floor, f.ceil, l.front, 'mid'); continue; }
    if (l.back === l.front) continue;
    const k = map.sectors[l.back]!;
    if (f.floor !== k.floor) push(Math.min(f.floor, k.floor), Math.max(f.floor, k.floor), f.floor < k.floor ? l.front : l.back, 'lower');
    if (f.ceil !== k.ceil && !(f.materials.ceil === SKY_MATERIAL && k.materials.ceil === SKY_MATERIAL)) {
      push(Math.min(f.ceil, k.ceil), Math.max(f.ceil, k.ceil), f.ceil > k.ceil ? l.front : l.back, 'upper');
    }
  }
  return out;
}
