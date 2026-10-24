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

export interface SectorPolygon { sector: number; outer: XZ[]; holes: XZ[][] }
export type WallPart = 'mid' | 'lower' | 'upper';
export interface WallQuad { a: XZ; b: XZ; y0: number; y1: number; sector: number; part: WallPart }

/** Signed shoelace area in x/z. */
export function loopArea(loop: readonly XZ[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, z0] = loop[i]!, [x1, z1] = loop[(i + 1) % loop.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

function pointInLoop(x: number, z: number, loop: readonly XZ[]): boolean {
  let odd = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [ax, az] = loop[i]!, [bx, bz] = loop[j]!;
    if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) odd = !odd;
  }
  return odd;
}

/** The closed vertex loops bounding one sector. Edges are chained without direction; at a vertex
 *  with several unused edges the first in line order is taken (Doom maps rarely pinch). */
function sectorLoops(map: SectorMap, sector: number): XZ[][] {
  const edges = map.lines.filter(l => l.front !== l.back && (l.front === sector || l.back === sector)).map(l => l.v);
  const used = new Array<boolean>(edges.length).fill(false);
  const loops: XZ[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const first = edges[start]![0];
    const loop: number[] = [first];
    let cur = edges[start]![1];
    while (cur !== first) {
      loop.push(cur);
      const next = edges.findIndex((e, i) => !used[i] && (e[0] === cur || e[1] === cur));
      if (next < 0) break;                                          // open: the parser refuses this
      used[next] = true;
      cur = edges[next]![0] === cur ? edges[next]![1] : edges[next]![0];
    }
    if (loop.length >= 3) loops.push(loop.map(vi => map.vertices[vi]!));
  }
  return loops;
}

/** Every sector as outer polygons with their holes: a loop nested inside an odd number of the
 *  sector's other loops is a hole of the smallest loop that holds it. */
export function sectorPolygons(map: SectorMap): SectorPolygon[] {
  const out: SectorPolygon[] = [];
  map.sectors.forEach((_, sector) => {
    const loops = sectorLoops(map, sector);
    const probe = (l: XZ[]): [number, number] => [(l[0]![0] + l[1]![0]) / 2, (l[0]![1] + l[1]![1]) / 2];
    const holders = loops.map((l, i) => {
      const [px, pz] = probe(l);
      return loops.map((o, k) => k).filter(k => k !== i && pointInLoop(px, pz, loops[k]!));
    });
    const outers = loops.map((_, i) => i).filter(i => holders[i]!.length % 2 === 0);
    const polys = outers.map(i => ({ sector, outer: loops[i]!, holes: [] as XZ[][] }));
    loops.forEach((l, i) => {
      if (holders[i]!.length % 2 === 0) return;
      const owner = holders[i]!.filter(k => outers.includes(k))
        .sort((p, q) => Math.abs(loopArea(loops[p]!)) - Math.abs(loopArea(loops[q]!)))[0];
      if (owner !== undefined) polys[outers.indexOf(owner)]!.holes.push(l);
    });
    out.push(...polys);
  });
  return out;
}

/** Wall quads: one-sided lines full height; two-sided lines a lower riser (seen from the lower
 *  floor) and an upper lip (seen from the higher ceiling, skipped when both ceilings are sky).
 *  `sectorAt` orients each quad into its sector. */
export function wallQuads(map: SectorMap, sectorAt: (x: number, z: number) => number): WallQuad[] {
  const out: WallQuad[] = [];
  const push = (a: XZ, b: XZ, y0: number, y1: number, sector: number, part: WallPart) => {
    if (y1 - y0 < 1e-4) return;
    const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz);
    const mx = (a[0] + b[0]) / 2 + (-dz / n) * 0.05, mz = (a[1] + b[1]) / 2 + (dx / n) * 0.05;
    out.push(sectorAt(mx, mz) === sector ? { a, b, y0, y1, sector, part } : { a: b, b: a, y0, y1, sector, part });
  };
  for (const l of map.lines) {
    const a = map.vertices[l.v[0]]!, b = map.vertices[l.v[1]]!;
    const f = map.sectors[l.front]!;
    if (l.back < 0) { push(a, b, f.floor, f.ceil, l.front, 'mid'); continue; }
    if (l.back === l.front) continue;
    const k = map.sectors[l.back]!;
    if (f.floor !== k.floor) {
      const low = f.floor < k.floor ? l.front : l.back;
      push(a, b, Math.min(f.floor, k.floor), Math.max(f.floor, k.floor), low, 'lower');
    }
    if (f.ceil !== k.ceil && !(f.materials.ceil === SKY_MATERIAL && k.materials.ceil === SKY_MATERIAL)) {
      const high = f.ceil > k.ceil ? l.front : l.back;
      push(a, b, Math.min(f.ceil, k.ceil), Math.max(f.ceil, k.ceil), high, 'upper');
    }
  }
  return out;
}
