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
import { edgesArea, pointInEdges, sectorEdgeIndices, sectorEdges } from './sector-edges';

export interface SectorPolygon { sector: number; outer: XZ[]; holes: XZ[][] }
export type WallPart = 'mid' | 'lower' | 'upper';
/** `mat`: the wall family this quad wears — its line side's own (`SectorLine.walls`), else its sector's.
 *  `along`: where the quad's a and b ends sit along its whole line (the original one when the line was
 *  cut into pieces, `SectorLine.origin`), measured in the quad's own direction, and that line's length. */
export interface WallQuad { a: XZ; b: XZ; y0: number; y1: number; sector: number; part: WallPart; mat: string; along: [number, number, number] }

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
    const o = l.origin?.a ?? va, len = l.origin?.len ?? Math.hypot(vb[0] - va[0], vb[1] - va[1]);
    const ta = Math.hypot(va[0] - o[0], va[1] - o[1]), tb = Math.hypot(vb[0] - o[0], vb[1] - o[1]);
    const push = (y0: number, y1: number, sector: number, part: WallPart) => {
      if (y1 - y0 < 1e-4) return;
      const front = sector === l.front;
      const mat = (front ? l.walls?.front : l.walls?.back)?.[part] ?? map.sectors[sector]!.materials.wall;
      out.push(front ? { a: va, b: vb, y0, y1, sector, part, mat, along: [ta, tb, len] }
        : { a: vb, b: va, y0, y1, sector, part, mat, along: [len - tb, len - ta, len] });
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

const distToSeg = (x: number, z: number, [ax, az]: XZ, [bx, bz]: XZ): number => {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
};

/** A point well inside sector s (the inside grid sample farthest from its lines, ties broken
 *  toward the middle of the sector), or null. A second, finer pass refines around the best sample. */
export function sectorInteriorPoint(map: SectorMap, s: number): [number, number] | null {
  const edges = sectorEdges(map, s);
  if (edges.length === 0) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [a, b] of edges) for (const [x, z] of [a, b]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const clearance = (x: number, z: number): number => {
    let d = Infinity;
    for (const [a, b] of edges) d = Math.min(d, distToSeg(x, z, a, b));
    return d;
  };
  const sample = (ax: number, bx: number, az: number, bz: number, step: number) => {
    const pts: { x: number; z: number; d: number }[] = [];
    for (let z = az + step / 2; z < bz; z += step) {
      for (let x = ax + step / 2; x < bx; x += step) {
        if (pointInEdges(x, z, edges)) pts.push({ x, z, d: clearance(x, z) });
      }
    }
    return pts;
  };
  const pick = (pts: { x: number; z: number; d: number }[]) => {
    if (pts.length === 0) return null;
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p.x; cz += p.z; }
    cx /= pts.length; cz /= pts.length;
    let best = pts[0]!, bestC = Math.hypot(best.x - cx, best.z - cz);
    for (const p of pts) {
      const c = Math.hypot(p.x - cx, p.z - cz);
      if (p.d > best.d + 1e-6 || (Math.abs(p.d - best.d) <= 1e-6 && c < bestC)) { best = p; bestC = c; }
    }
    return best;
  };
  const step = Math.max(0.25, Math.min(x1 - x0, z1 - z0) / 24);
  const coarse = pick(sample(x0, x1, z0, z1, step));
  if (!coarse) return null;
  const fine = pick(sample(coarse.x - step, coarse.x + step, coarse.z - step, coarse.z + step, step / 4));
  const best = fine && fine.d > coarse.d - 1e-6 ? fine : coarse;
  return [best.x, best.z];
}
