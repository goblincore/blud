// src/lab/sdf-zombie/webgpu/sector-bounce.ts
//
// GLOW BOUNCE (hand-off 2026-10-24 item 2b): the green a nukage pool (lava, acid) throws on the room
// round it, baked once per vertex at mesh build. The pool's own list light is masked to the pool's
// zone, and on E1M1 the room round the big pool is another zone, so without this the pool is a green
// shape in black. Per vertex, summed over glow sectors:
//
//   colour(kind) × min(1, area / POOL_REF_M2) × 1 / (1 + (d / FALLOFF_M)²) × fade(d) × facing × seen
//
// d: from the vertex to the nearest point of the pool polygon, in 3D (the height above or below the
// pool floor counts). fade: 1 to 0 over the last quarter of CUTOFF_M. facing: a wrapped n·L toward
// the pool. seen: the share of two rays (to the pool's nearest point and to its interior point) that
// cross no blocking line — a one-sided wall, or a two-sided line the ray passes below the higher
// floor or above the lower ceiling of (a lip, a closed door); the pool's own rim does not block up
// to RIM_MAX_M (the pit glows up to it), its soffit and taller risers do. So the green never bleeds through a solid wall into an unrelated room. The renderer multiplies the sum by the albedo and its gains.
//
// refineNearGlow splits the lines near pools so walls, floors and ceilings get vertices along them
// (both sides of a line split at the same points: no T-junctions); wallRows splits walls in height
// on a world grid (two walls meeting at a corner split alike).
//
// Pure: no three.js, no DOM.

import type { GlowKind, SectorLine, SectorMap, XZ } from './sector-def';
import { edgesArea, pointInEdges, sectorEdges } from './sector-edges';
import { sectorInteriorPoint } from './sector-geometry';
import { GLOW_BASE_RGB } from './sector-glow.wgsl';

export type RGB = [number, number, number];
type V3 = readonly [number, number, number];

/** Past this a pool adds nothing, metres. */
export const BOUNCE_CUTOFF_M = 12;
/** The falloff's half-power distance, metres. */
export const BOUNCE_FALLOFF_M = 3;
/** A pool this big (m²) or bigger counts in full; a smaller one in proportion. */
export const POOL_REF_M2 = 16;
/** The glow surface's mean brightness relative to its base colour (noise ~0.78, crust ~0.85). */
export const GLOW_MEAN = 0.7;
/** The facing wrap: (n·L + w) / (1 + w), so a surface edge-on to the pool still catches some. */
const WRAP = 0.5;
/** The rays aim this far above the pool's rim (its highest neighbouring floor, at most RIM_MAX_M above
 *  the pool floor): the pit glows up to its rim, so the floor round a sunken pool catches it edge-on. */
const TARGET_LIFT_M = 0.1;
const RIM_MAX_M = 1;
/** How far a ray starts off its surface (along the normal and into its sector). */
const START_OFF_M = 0.05;
/** The longest line piece refineNearGlow leaves near a pool, metres. */
export const REFINE_MAX_M = 2;
/** wallRows' world-grid step, metres. */
export const WALL_ROW_M = 2;

export interface GlowSource {
  sector: number;
  kind: GlowKind;
  floor: number;
  /** Where the rays aim: just above the rim (see TARGET_LIFT_M). */
  targetY: number;
  area: number;
  edges: [XZ, XZ][];
  interior: XZ;
  /** The pool's x/z box. */
  min: XZ;
  max: XZ;
  /** The lines within reach (the box grown by the cutoff) that can block this pool's light, packed
   *  OCC_STRIDE floats each for rayClear: a.x, a.z, (b - a).x, (b - a).z, lowest open y, highest
   *  open y (both 0 for a one-sided wall), solid (1 for a one-sided wall). On the pool's own
   *  two-sided lines the floor bound is dropped while the neighbour's floor is within RIM_MAX_M of
   *  the pool's (a sunken pool's pit glows up to its rim, its risers lit green, so the lip never
   *  shades the pool's own light); a taller riser and the soffit (the lower ceiling) still block. */
  occluders: Float64Array;
}

export const OCC_STRIDE = 7;

const boxNear = (min: XZ, max: XZ, a: XZ, b: XZ, r: number): boolean =>
  Math.max(a[0], b[0]) >= min[0] - r && Math.min(a[0], b[0]) <= max[0] + r
  && Math.max(a[1], b[1]) >= min[1] - r && Math.min(a[1], b[1]) <= max[1] + r;

/** Every glow sector as a bounce source. */
export function glowSources(map: SectorMap): GlowSource[] {
  const out: GlowSource[] = [];
  map.sectors.forEach((s, sector) => {
    if (s.glow === null) return;
    const edges = sectorEdges(map, sector);
    const interior = sectorInteriorPoint(map, sector);
    if (edges.length === 0 || !interior) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [a, b] of edges) for (const [x, z] of [a, b]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const min: XZ = [x0, z0], max: XZ = [x1, z1];
    const occ: number[] = [];
    let rim = s.floor;
    for (const l of map.lines) {
      const other = l.front === sector ? l.back : l.back === sector ? l.front : -1;
      if (other >= 0 && other !== sector) rim = Math.max(rim, Math.min(map.sectors[other]!.floor, s.floor + RIM_MAX_M));
    }
    for (const l of map.lines) {
      if (l.front === l.back) continue;
      const a = map.vertices[l.v[0]]!, b = map.vertices[l.v[1]]!;
      if (!boxNear(min, max, a, b, BOUNCE_CUTOFF_M)) continue;
      const f = map.sectors[l.front]!, k = l.back >= 0 ? map.sectors[l.back]! : null;
      const own = l.front === sector || l.back === sector;
      const hiFloor = k ? Math.max(f.floor, k.floor) : 0;
      const lo = !k ? 0 : own && hiFloor <= s.floor + RIM_MAX_M ? -Infinity : hiFloor - 1e-3;
      occ.push(a[0], a[1], b[0] - a[0], b[1] - a[1], lo, k ? Math.min(f.ceil, k.ceil) + 1e-3 : 0, k ? 0 : 1);
    }
    out.push({ sector, kind: s.glow, floor: s.floor, targetY: rim + TARGET_LIFT_M, area: Math.abs(edgesArea(edges)), edges, interior, min, max,
      occluders: Float64Array.from(occ) });
  });
  return out;
}

/** The nearest point of the pool to (x, z) — (x, z) itself when inside — and its distance. */
export function nearestOnPool(src: Pick<GlowSource, 'edges'>, x: number, z: number): { p: XZ; d: number } {
  if (pointInEdges(x, z, src.edges)) return { p: [x, z], d: 0 };
  let best: XZ = [x, z], bd = Infinity;
  for (const [[ax, az], [bx, bz]] of src.edges) {
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return { p: best, d: bd };
}

/** 1 / (1 + (d / FALLOFF)²), faded to 0 over the last quarter of the cutoff. */
export function bounceFalloff(d: number): number {
  if (d >= BOUNCE_CUTOFF_M) return 0;
  const f = 1 / (1 + (d / BOUNCE_FALLOFF_M) ** 2);
  const t = Math.min(1, Math.max(0, (BOUNCE_CUTOFF_M - d) / (0.25 * BOUNCE_CUTOFF_M)));
  return f * t * t * (3 - 2 * t);
}

/** Does the segment from a to b cross none of the packed occluders (glowSources)? A one-sided wall
 *  blocks; a two-sided line blocks where the ray passes below its higher floor or above its lower
 *  ceiling (a lip, a closed door). */
export function rayClear(occ: Float64Array, a: V3, b: V3): boolean {
  const rx = b[0] - a[0], rz = b[2] - a[2];
  if (rx * rx + rz * rz < 1e-10) return true;                    // straight up or down: no line crossed
  for (let o = 0; o < occ.length; o += OCC_STRIDE) {
    const px = occ[o]!, pz = occ[o + 1]!, sx = occ[o + 2]!, sz = occ[o + 3]!;
    const den = rx * sz - rz * sx;
    if (den > -1e-12 && den < 1e-12) continue;                    // parallel
    const qx = px - a[0], qz = pz - a[2];
    const t = (qx * sz - qz * sx) / den;                          // along the ray
    if (t <= 1e-6 || t >= 1 - 1e-6) continue;
    const u = (qx * rz - qz * rx) / den;                          // along the line
    if (u < 0 || u > 1) continue;
    if (occ[o + 6] === 1) return false;
    const h = a[1] + t * (b[1] - a[1]);
    if (h < occ[o + 4]! || h > occ[o + 5]!) return false;
  }
  return true;
}

export interface GlowBounce {
  sources: readonly GlowSource[];
  /** The bounce at vertex `p` with normal `n`; `into` is an x/z direction into the vertex's own
   *  sector (a wall's normal x/z; for a floor or ceiling, toward its triangle's centre), so a ray
   *  starts inside it. */
  at(p: V3, n: V3, into: XZ, out?: RGB): RGB;
}

const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return l > 1e-9 ? [x / l, y / l, z / l] : [0, 0, 0];
};

export function createGlowBounce(map: SectorMap, sources: readonly GlowSource[] = glowSources(map)): GlowBounce {
  return {
    sources,
    at(p, n, into, out = [0, 0, 0]) {
      out[0] = out[1] = out[2] = 0;
      const il = Math.hypot(into[0], into[1]) || 1;
      const start: V3 = [p[0] + n[0] * START_OFF_M + (into[0] / il) * START_OFF_M, p[1] + n[1] * START_OFF_M,
        p[2] + n[2] * START_OFF_M + (into[1] / il) * START_OFF_M];
      for (const src of sources) {
        if (p[0] < src.min[0] - BOUNCE_CUTOFF_M || p[0] > src.max[0] + BOUNCE_CUTOFF_M
          || p[2] < src.min[1] - BOUNCE_CUTOFF_M || p[2] > src.max[1] + BOUNCE_CUTOFF_M) continue;
        const near = nearestOnPool(src, p[0], p[2]);
        const d = Math.hypot(near.d, p[1] - src.floor);
        const fall = bounceFalloff(d);
        if (fall <= 0) continue;
        const ty = src.targetY;
        // The near target nudged 5 cm into the pool, so it is not on the pool's own boundary line.
        const ix = src.interior[0] - near.p[0], iz = src.interior[1] - near.p[1], ilen = Math.hypot(ix, iz);
        const k = ilen > 0.05 ? 0.05 / ilen : 0;
        const t1: V3 = [near.p[0] + ix * k, ty, near.p[1] + iz * k];
        const t2: V3 = [src.interior[0], ty, src.interior[1]];
        const seen = ((rayClear(src.occluders, start, t1) ? 1 : 0) + (rayClear(src.occluders, start, t2) ? 1 : 0)) / 2;
        if (seen === 0) continue;
        const d1 = unit(t1[0] - p[0], t1[1] - p[1], t1[2] - p[2]), d2 = unit(t2[0] - p[0], t2[1] - p[1], t2[2] - p[2]);
        const L = unit(d1[0] + d2[0], d1[1] + d2[1], d1[2] + d2[2]);
        const facing = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2] + WRAP) / (1 + WRAP));
        const w = Math.min(1, src.area / POOL_REF_M2) * fall * facing * seen * GLOW_MEAN;
        const c = GLOW_BASE_RGB[src.kind];
        out[0] += c[0] * w; out[1] += c[1] * w; out[2] += c[2] * w;
      }
      return out;
    },
  };
}

/** A copy of the map whose lines near a pool (within the cutoff of its box) are split into pieces of
 *  at most `maxLen`, each keeping its sectors, door and exit. Split points run v0 -> v1 of the
 *  original line, so the sectors on both sides share them. For meshing only: the ground and the
 *  collision keep the original map. */
export function refineNearGlow(map: SectorMap, sources: readonly GlowSource[] = glowSources(map), maxLen = REFINE_MAX_M): SectorMap {
  if (sources.length === 0) return map;
  const vertices: XZ[] = [...map.vertices];
  const lines: SectorLine[] = [];
  for (const l of map.lines) {
    const a = map.vertices[l.v[0]]!, b = map.vertices[l.v[1]]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const near = sources.some(s => boxNear(s.min, s.max, a, b, BOUNCE_CUTOFF_M));
    const n = near ? Math.ceil(len / maxLen - 1e-9) : 1;
    if (n <= 1) { lines.push(l); continue; }
    let prev = l.v[0];
    const origin = l.origin ?? { a, len };
    for (let i = 1; i <= n; i++) {
      let next = l.v[1];
      if (i < n) { vertices.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]); next = vertices.length - 1; }
      lines.push({ ...l, v: [prev, next], origin });
      prev = next;
    }
  }
  return { vertices, sectors: map.sectors, lines };
}

/** The heights a wall from y0 to y1 is cut at: y0, every multiple of `step` strictly between, y1. */
export function wallRows(y0: number, y1: number, step = WALL_ROW_M): number[] {
  const out = [y0];
  for (let k = Math.floor(y0 / step) + 1; k * step < y1 - 1e-6; k++) if (k * step > y0 + 1e-6) out.push(k * step);
  out.push(y1);
  return out;
}

/** Is (x, z) within the cutoff of any pool's box? (Where walls get cut in height.) */
export function nearGlow(sources: readonly GlowSource[], x: number, z: number): boolean {
  for (const s of sources) {
    const dx = Math.max(s.min[0] - x, 0, x - s.max[0]), dz = Math.max(s.min[1] - z, 0, z - s.max[1]);
    if (dx * dx + dz * dz < BOUNCE_CUTOFF_M * BOUNCE_CUTOFF_M) return true;
  }
  return false;
}

/** A wall quad's triangles when its two vertical edges are cut at different heights (`left` at its
 *  a end, `right` at its b end, both ascending, sharing the first and last y): each corner is
 *  [0 = a side | 1 = b side, row index]; an even quad comes out as the old [a0, b0, b1], [a0, b1, a1]
 *  (Batch.tri fixes the winding). Each edge's cuts depend only on that end, so two walls
 *  meeting at a corner cut it alike (no T-junction). */
export function wallStrip(left: readonly number[], right: readonly number[]): [number, number][][] {
  const out: [number, number][][] = [];
  let i = 0, j = 0;
  while (i < left.length - 1 || j < right.length - 1) {
    const upLeft = j >= right.length - 1 || (i < left.length - 1 && left[i + 1]! < right[j + 1]!);
    if (upLeft) { out.push([[0, i], [1, j], [0, i + 1]]); i++; }
    else { out.push([[0, i], [1, j], [1, j + 1]]); j++; }
  }
  return out;
}
