// src/lab/sdf-zombie/webgpu/sector-portals.ts
//
// SECTOR PORTAL VISIBILITY (occlusion pass, 2026-10-28): which sectors the camera can possibly see, from the
// sector graph alone. Pure and renderer-free (plain data in, a per-sector flag array out), so the Rust port takes it
// as it is.
//
// THE FLOOD. Every two-sided line is a portal between its two sectors; one-sided lines are solid. From the eye's
// sector, the camera's horizontal view wedge is pushed through each portal of the sector, narrowed to the portal's
// angular span as seen from the eye, and on into the sector beyond, recursively. A sector reached with a non-empty
// wedge is visible. Angles are measured relative to the camera's forward direction, so a wedge is one interval
// in [-PI, PI]; a portal's span that wraps behind the camera is split.
//
// CONSERVATIVE BY CONSTRUCTION — it may over-include, never drop:
// - It is 2D: a portal's vertical opening is ignored (a step, a window, a low lintel all pass the full wedge),
//   except that a two-sided line with NO opening (the higher floor at or over the lower ceiling) is a wall.
// - Depth is ignored inside a sector: a portal nearer the eye than the one the wedge came in through still passes.
// - Each span is widened by `marginM` seen at its distance (the flashlight and its shadow twin sit a hand off the
//   eye; a sliver around a jamb must never pop), and a portal within `nearM` of the eye passes the wedge unchanged
//   (the eye on a threshold, mid step through it).
// - A wedge is only pushed OUT of a sector through a line the eye is on that sector's side of (a straight ray
//   crosses a line once): the cut that stops the flood running backwards. A tolerance keeps it conservative.
// - A closed door closes its face lines (`closed`); an opening one is open from its first frame.
// - SKY. A sky ceiling is not drawn, so geometry TALLER than a sky sector's walls shows over them. A sky sector
//   reached with wedge W marks every sector whose ceiling is higher than its own and whose box lies in W, without
//   flooding on from them (a ray over the wall is above the sky sector's ceiling for good: everything it can reach
//   is taller too, and in W).
// - The eye in the void (no sector), or a flood that runs past `maxSteps`: every sector visible (fail open).
//
// Cost: one visit per (portal, new piece of interval); a per-edge memo of the intervals already pushed through
// passes on only the part of a repeat arrival that is new. E1M1 (88 sectors, 486 lines): 20-110 us a flood.
import type { SectorMap } from './sector-def';
import { SKY_MATERIAL } from './sector-def';

/** One sector's portals, oriented so the sector is on the LEFT of a -> b. */
interface Edge { line: number; ax: number; az: number; bx: number; bz: number; to: number }

export interface PortalGraph {
  readonly sectorCount: number;
  /** Per sector, its portal edges. */
  readonly edges: readonly (readonly Edge[])[];
  /** Per sector, its box [minX, minZ, maxX, maxZ] (for the sky rule). */
  readonly box: Float64Array;
  /** Per sky sector, the sectors whose ceiling is higher than its own (empty for a closed ceiling). */
  readonly overSky: readonly (readonly number[])[];
  /** Per sector, its zone. */
  readonly zone: Int32Array;
  readonly zoneCount: number;
}

export function buildPortalGraph(map: SectorMap): PortalGraph {
  const n = map.sectors.length;
  const edges: Edge[][] = Array.from({ length: n }, () => []);
  const box = new Float64Array(n * 4);
  for (let s = 0; s < n; s++) { box[4 * s] = Infinity; box[4 * s + 1] = Infinity; box[4 * s + 2] = -Infinity; box[4 * s + 3] = -Infinity; }
  const grow = (s: number, x: number, z: number) => {
    if (s < 0 || s >= n) return;
    box[4 * s] = Math.min(box[4 * s]!, x); box[4 * s + 1] = Math.min(box[4 * s + 1]!, z);
    box[4 * s + 2] = Math.max(box[4 * s + 2]!, x); box[4 * s + 3] = Math.max(box[4 * s + 3]!, z);
  };
  map.lines.forEach((l, i) => {
    const [ax, az] = map.vertices[l.v[0]]!, [bx, bz] = map.vertices[l.v[1]]!;
    grow(l.front, ax, az); grow(l.front, bx, bz); grow(l.back, ax, az); grow(l.back, bx, bz);
    if (l.back < 0 || l.front < 0 || l.back === l.front) return;
    // No vertical opening (the higher floor at or over the lower ceiling): a wall in 3D, not a portal. Two sky
    // ceilings leave the top open (no upper wall is needed between them).
    const F = map.sectors[l.front]!, B = map.sectors[l.back]!;
    const bothSky = F.materials.ceil === SKY_MATERIAL && B.materials.ceil === SKY_MATERIAL;
    if (!bothSky && Math.max(F.floor, B.floor) >= Math.min(F.ceil, B.ceil) - 1e-3) return;
    // Front on the left of v0 -> v1, back on the left of v1 -> v0.
    edges[l.front]!.push({ line: i, ax, az, bx, bz, to: l.back });
    edges[l.back]!.push({ line: i, ax: bx, az: bz, bx: ax, bz: az, to: l.front });
  });
  const overSky = map.sectors.map((s, i) => s.materials.ceil !== SKY_MATERIAL ? []
    : map.sectors.flatMap((o, j) => (j !== i && o.ceil > s.ceil + 1e-3 ? [j] : [])));
  const zone = Int32Array.from(map.sectors, s => s.zone);
  const zoneCount = zone.reduce((m, z) => Math.max(m, z + 1), 0);
  return { sectorCount: n, edges, box, overSky, zone, zoneCount };
}

/** The camera, flattened: eye on the ground plane, forward direction, and the view's horizontal half-angle bound
 *  (>= PI: every direction). */
export interface FloodView { x: number; z: number; fx: number; fz: number; half: number }

export interface FloodOptions {
  /** Line i is shut (a closed door's face). */
  closed?: (line: number) => boolean;
  /** A portal this close to the eye passes the wedge unchanged. */
  nearM?: number;
  /** Each portal span is widened by this lateral distance seen at the portal. */
  marginM?: number;
  /** Visits before the flood gives up and marks everything (fail open). */
  maxSteps?: number;
}

export interface FloodStats { steps: number; failOpen: boolean }

export const FLOOD_NEAR_M = 0.5;
export const FLOOD_MARGIN_M = 0.35;
const FLOOD_MAX_STEPS = 20000;
/** Side-test slack (metres): the eye this close behind a line still pushes through it. */
const SIDE_EPS_M = 0.05;
/** Intervals remembered per edge. */
const MEMO = 4;

/** The horizontal half-angle that bounds a perspective camera's frustum: `fovYDeg` vertical field of view, `aspect`
 *  width / height, `pitch` up positive (radians), plus `marginRad`. PI (everything) once the frustum can see
 *  straight up or down. */
export function frustumHalfAngle(fovYDeg: number, aspect: number, pitch: number, marginRad = 0.12): number {
  const ty = Math.tan((fovYDeg * Math.PI) / 360), tx = ty * aspect;
  // A frustum corner (+-tx, +-ty, forward 1) rotated by the pitch: its ground-forward part is cos p -+ ty sin p.
  const fwd = Math.cos(pitch) - ty * Math.abs(Math.sin(pitch));
  if (fwd <= 0.05) return Math.PI;
  return Math.min(Math.PI, Math.atan(tx / fwd) + marginRad);
}

/** Flood the sectors visible from `view` standing in `eyeSector`; `out[s]` becomes 1 for each (0 for the rest).
 *  `scratch` (optional) holds the memo between calls. */
export function floodSectors(g: PortalGraph, view: FloodView, eyeSector: number, out: Uint8Array,
  opts: FloodOptions = {}, scratch?: FloodScratch): FloodStats {
  out.fill(0);
  const stats: FloodStats = { steps: 0, failOpen: false };
  if (eyeSector < 0 || eyeSector >= g.sectorCount) { out.fill(1); stats.failOpen = true; return stats; }
  const sc = scratch ?? createFloodScratch(g);
  sc.reset();
  const closed = opts.closed, near = opts.nearM ?? FLOOD_NEAR_M, margin = opts.marginM ?? FLOOD_MARGIN_M;
  const maxSteps = opts.maxSteps ?? FLOOD_MAX_STEPS;
  const ex = view.x, ez = view.z;
  const fl = Math.hypot(view.fx, view.fz) || 1, fx = view.fx / fl, fz = view.fz / fl;
  const half = Math.min(Math.PI, view.half);
  // Explicit stack: sector, lo, hi.
  const stack: number[] = [eyeSector, -half, half];
  while (stack.length > 0) {
    const hi = stack.pop()!, lo = stack.pop()!, s = stack.pop()!;
    if (++stats.steps > maxSteps) { out.fill(1); stats.failOpen = true; return stats; }
    out[s] = 1;
    const sky = g.overSky[s]!;
    for (let k = 0; k < sky.length; k++) {
      const o = sky[k]!;
      if (out[o]) continue;
      if (boxInWedge(g.box, o, ex, ez, fx, fz, lo, hi)) out[o] = 1;
    }
    const es = g.edges[s]!;
    for (let k = 0; k < es.length; k++) {
      const e = es[k]!;
      if (closed?.(e.line)) continue;
      const lx = e.bx - e.ax, lz = e.bz - e.az, len = Math.hypot(lx, lz);
      if (len < 1e-9) continue;
      // The eye must be on this sector's (left) side of the line to look out through it.
      const side = (lx * (ez - e.az) - lz * (ex - e.ax)) / len;
      if (side < -SIDE_EPS_M) continue;
      const d = segDist(ex, ez, e.ax, e.az, e.bx, e.bz);
      if (d < near) { push(sc, stack, s, k, e.to, lo, hi); continue; }
      const ta = relAngle(ex, ez, fx, fz, e.ax, e.az), tb = relAngle(ex, ez, fx, fz, e.bx, e.bz);
      let w = tb - ta;
      if (w > Math.PI) w -= 2 * Math.PI; else if (w < -Math.PI) w += 2 * Math.PI;
      const m = Math.atan(margin / d);
      const a0 = (w >= 0 ? ta : tb) - m, a1 = (w >= 0 ? ta : tb) + Math.abs(w) + m;
      // The span may wrap past +-PI: test it and its two 2PI shifts against [lo, hi].
      for (let j = 0; j < 3; j++) {
        const shift = SHIFTS[j]!, nlo = Math.max(lo, a0 + shift), nhi = Math.min(hi, a1 + shift);
        if (nlo < nhi) push(sc, stack, s, k, e.to, nlo, nhi);
      }
    }
  }
  return stats;
}

const SHIFTS = [0, -2 * Math.PI, 2 * Math.PI] as const;

function push(sc: FloodScratch, stack: number[], s: number, k: number, to: number, lo: number, hi: number): void {
  sc.push(s, k, lo, hi, stack, to);
}

function boxInWedge(box: Float64Array, o: number, ex: number, ez: number, fx: number, fz: number,
  lo: number, hi: number): boolean {
  const x0 = box[4 * o]!, z0 = box[4 * o + 1]!, x1 = box[4 * o + 2]!, z1 = box[4 * o + 3]!;
  if (ex >= x0 && ex <= x1 && ez >= z0 && ez <= z1) return true;
  // The box's span from outside it is under PI: its corners' relative angles, unwrapped around the first.
  const c0 = relAngle(ex, ez, fx, fz, x0, z0);
  let mn = c0, mx = c0;
  for (let k = 1; k < 4; k++) {
    let t = relAngle(ex, ez, fx, fz, k & 1 ? x1 : x0, k & 2 ? z1 : z0) - c0;
    if (t > Math.PI) t -= 2 * Math.PI; else if (t < -Math.PI) t += 2 * Math.PI;
    if (c0 + t < mn) mn = c0 + t; else if (c0 + t > mx) mx = c0 + t;
  }
  return overlaps(lo, hi, mn, mx);
}

/** [lo, hi] meets [a0, a1] or either of its 2PI shifts. */
function overlaps(lo: number, hi: number, a0: number, a1: number): boolean {
  const T = 2 * Math.PI;
  return Math.max(lo, a0) < Math.min(hi, a1) || Math.max(lo, a0 - T) < Math.min(hi, a1 - T) || Math.max(lo, a0 + T) < Math.min(hi, a1 + T);
}

function relAngle(ex: number, ez: number, fx: number, fz: number, x: number, z: number): number {
  const dx = x - ex, dz = z - ez;
  return Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** The flood's per-edge memo: the intervals already pushed through each edge (disjoint, sorted), so a wedge
 *  arriving again by another path pushes on only what is new. Reused between frames. */
export interface FloodScratch {
  reset(): void;
  /** Push the parts of [lo, hi] not yet pushed through edge k of sector s onto `stack` as (to, lo, hi). */
  push(s: number, k: number, lo: number, hi: number, stack: number[], to: number): void;
}

export function createFloodScratch(g: PortalGraph): FloodScratch {
  const base = new Int32Array(g.sectorCount + 1);
  for (let s = 0; s < g.sectorCount; s++) base[s + 1] = base[s]! + g.edges[s]!.length;
  const total = base[g.sectorCount]!;
  const count = new Uint8Array(total);
  const iv = new Float64Array(total * MEMO * 2);
  const pieces: number[] = [];
  return {
    reset() { count.fill(0); },
    push(s, k, lo, hi, stack, to) {
      const e = base[s]! + k, n = count[e]!, o0 = e * MEMO * 2;
      // The uncovered pieces of [lo, hi] against the sorted, disjoint stored intervals.
      pieces.length = 0;
      let cur = lo;
      for (let j = 0; j < n && cur < hi; j++) {
        const a = iv[o0 + 2 * j]!, b = iv[o0 + 2 * j + 1]!;
        if (b <= cur) continue;
        if (a >= hi) break;
        if (a > cur + 1e-9) pieces.push(cur, a);
        cur = Math.max(cur, b);
      }
      if (cur < hi - 1e-9) pieces.push(cur, hi);
      for (let j = 0; j < pieces.length; j += 2) stack.push(to, pieces[j]!, pieces[j + 1]!);
      if (pieces.length === 0) return;
      // Store the union of what was there and [lo, hi] (merged), when it fits; else leave the memo as it is
      // (a later arrival is pushed again: more work, never less seen).
      const merged: number[] = [];
      let ins = false;
      const addIv = (a: number, b: number) => {
        const m = merged.length;
        if (m > 0 && a <= merged[m - 1]! + 1e-9) merged[m - 1] = Math.max(merged[m - 1]!, b);
        else merged.push(a, b);
      };
      for (let j = 0; j < n; j++) {
        const a = iv[o0 + 2 * j]!, b = iv[o0 + 2 * j + 1]!;
        if (!ins && lo < a) { addIv(lo, hi); ins = true; }
        addIv(a, b);
      }
      if (!ins) addIv(lo, hi);
      if (merged.length / 2 > MEMO) return;
      for (let j = 0; j < merged.length; j++) iv[o0 + j] = merged[j]!;
      count[e] = merged.length / 2;
    },
  };
}

/** Whether any sector a disc of radius `r` round (x, z) in sector `s` reaches is visible: `s` and every sector
 *  across a portal line within `r` of the centre, onward (a body's flesh round its torso). Solid lines stop it.
 *  `s` < 0 (off the map): true. */
export function discVisible(g: PortalGraph, s: number, x: number, z: number, r: number, visible: Uint8Array,
  scratch: number[] = []): boolean {
  if (s < 0 || s >= g.sectorCount) return true;
  if (visible[s]) return true;
  const stack = scratch; stack.length = 0; stack.push(s);
  const seen = new Set<number>([s]);
  while (stack.length > 0) {
    const c = stack.pop()!;
    for (const e of g.edges[c]!) {
      if (seen.has(e.to) || segDist(x, z, e.ax, e.az, e.bx, e.bz) >= r) continue;
      if (visible[e.to]) return true;
      seen.add(e.to); stack.push(e.to);
    }
  }
  return false;
}

/** Zones with at least one visible sector: `zoneOut[z]` 1, else 0. */
export function visibleZones(g: PortalGraph, sectors: Uint8Array, zoneOut: Uint8Array): void {
  zoneOut.fill(0);
  for (let s = 0; s < g.sectorCount; s++) if (sectors[s]) zoneOut[g.zone[s]!] = 1;
}
