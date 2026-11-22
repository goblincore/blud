// src/lab/sdf-zombie/webgpu/sector-edges.ts
//
// SECTOR EDGES — the one rule for a sector's directed boundary, shared by the parser (closure,
// winding), the loop builder and the point-in-sector test (spec 2026-10-24 §4): a sector lies on
// the LEFT of its lines, so a line contributes v0 -> v1 to its front sector and v1 -> v0 to its
// back sector; a line with the same sector on both sides contributes nothing.
// scripts/levels/doom_map.py keeps copies of these rules (sector_edges, point_in_edges).
//
// Pure: no three.js, no DOM.

import type { SectorMap, XZ } from './sector-def';

/** A sector's directed boundary as vertex index pairs, sector on the left of each. */
export function sectorEdgeIndices(map: SectorMap, s: number): [number, number][] {
  const out: [number, number][] = [];
  for (const l of map.lines) {
    if (l.front === l.back) continue;
    if (l.front === s) out.push([l.v[0], l.v[1]]);
    else if (l.back === s) out.push([l.v[1], l.v[0]]);
  }
  return out;
}

/** The same edges as points. */
export function sectorEdges(map: SectorMap, s: number): [XZ, XZ][] {
  return sectorEdgeIndices(map, s).map(([a, b]) => [map.vertices[a]!, map.vertices[b]!]);
}

/** Signed shoelace area of a set of directed edges (positive: the region is on their left). */
export function edgesArea(edges: readonly (readonly [XZ, XZ])[]): number {
  let a = 0;
  for (const [[x0, z0], [x1, z1]] of edges) a += x0 * z1 - x1 * z0;
  return a / 2;
}

/** Even-odd crossing test of (x, z) against a set of edges (their direction does not matter). */
export function pointInEdges(x: number, z: number, edges: readonly (readonly [XZ, XZ])[]): boolean {
  let odd = false;
  for (const [[ax, az], [bx, bz]] of edges) {
    if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) odd = !odd;
  }
  return odd;
}
