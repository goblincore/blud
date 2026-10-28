// src/lab/sdf-zombie/webgpu/sector-emitters.ts
//
// EMITTER LIGHT (hand-off item 2g, part B1): the self-lit walls and ceilings (screen banks, the
// viewscreen, fluorescents, exit signs) as LIGHT SOURCES. emitterSurfaces lists each emitter wall
// quad and fluorescent ceiling polygon with its area, normal, kind, sector and seed, and its MEAN
// glow: the same per-cell decisions the shader makes (emitter-layout.ts: dead / dim / flickering
// panels, amber or green screens, planets, tube tints), averaged over the cells it shows, times the
// kind's floor-limited sector factor (emitterFactor at the sector's base light). Each surface is cut
// into patches of at most EMIT_PATCH_M.
//
// createEmitterBounce bakes their coloured bounce per vertex, like the pools' (sector-bounce.ts), as
// a disc-like area light per patch:
//
//   radiance × A × cosθe × facing / (π d² + A) × fade(d) × seen
//
// cosθe: the patch's own normal toward the vertex (a wall lights the half-space in front of it, a
// ceiling lights downward); facing: the vertex's wrapped n·L; seen: the share of rays (to the
// surface's two end patches and its middle one) that cross no blocking line (sector-bounce rayClear,
// 2.5D). The bake is split by gain class, so the runtime gains still apply: screens and the
// viewscreen in one RGB channel (× screenGain), fluorescents as a scalar of FLUORO_RGB (× fluoroGain),
// signs as a scalar of SIGN_RGB (× signGain). The renderer multiplies them by emitBounceGain and the
// albedo, beside the pools' glowBounce.
//
// Pure: no three.js, no DOM.

import {
  emitterFactor, fluoroCellMean, FLUORO_RGB, screenCellMean, SIGN_RGB, signMean, viewscreenMean,
} from '../../../game/level/emitter-layout';
import type { PanelKind } from '../../../game/level/panel-textures';
import { occludersNear, rayClear, type Reach } from './sector-bounce';
import type { SectorMap, XZ } from './sector-def';
import { sectorPolygons, wallQuads } from './sector-geometry';
import { DEFAULT_SECTOR_LIGHT, sectorAmbient } from './sector-light';
import { flatFitCells, lineSeedTiles, polyBox, surfaceKind, SURFACE_LOOKS, type EmitterGainKey } from './sector-materials';

type V3 = readonly [number, number, number];
export type RGB = [number, number, number];

/** Past this an emitter adds nothing, metres. */
export const EMIT_CUTOFF_M = 8;
/** A patch is at most this big along and up (a wall) or across (a ceiling), metres. */
export const EMIT_PATCH_M = 2;
/** The receiver's facing wrap: (n·L + w) / (1 + w). Smaller than the pools' 0.5: a screen is a wall. */
const WRAP = 0.25;
/** Rays start this far off the receiver and aim this far in front of the patch. */
const START_OFF_M = 0.05;
const TARGET_OFF_M = 0.05;

export type EmitterClass = 'screen' | 'fluoro' | 'sign';
/** Per class, the bake's art weight over the physical estimate. A screen bank's glass is ~a quarter of
 *  its wall (the rest dark bezel) and a troffer's tubes a third of it, so a physical bake makes the
 *  troffers drown the screens; the computer room should read lit by its screens (owner brief, item 2g),
 *  so screens count 4×, signs 2× (a small sign should still redden its passage). Tuned on the B1 sheet. */
export const EMIT_CLASS_BAKE: Readonly<Record<EmitterClass, number>> = { screen: 4, fluoro: 1, sign: 2 };
const CLASS_OF: Record<EmitterGainKey, EmitterClass> = { screenGain: 'screen', fluoroGain: 'fluoro', signGain: 'sign' };
/** The kinds that are emitters, with their cell size in tile units (the shader's cell: tile × cu, tile × cv). */
const EMIT_KINDS = new Set<PanelKind>(['screenBank', 'viewscreen', 'fluorescent', 'exitSign']);

export interface EmitPatch { c: V3; area: number; rgb: RGB }
export interface EmitterSurface {
  kind: PanelKind;
  cls: EmitterClass;
  role: 'wall' | 'ceil';
  sector: number;
  zone: number;
  /** Unit normal: into the sector for a wall, down for a ceiling. */
  normal: V3;
  centre: V3;
  /** m². */
  area: number;
  /** The wall's per-line tile seed (sector-materials lineSeedTiles); 0 for a ceiling. */
  seed: number;
  /** Mean linear radiance over the surface (colour × mean glow, dead and dim cells included), times `factor`. */
  colour: RGB;
  /** emitterFactor at the sector's base light (the glow's floor-limited share of its sector's light). */
  factor: number;
  min: XZ;
  max: XZ;
  patches: EmitPatch[];
  /** Lines within EMIT_CUTOFF_M that can block it (sector-bounce occludersNear). */
  occluders: Float64Array;
}

function cellMean(kind: PanelKind, wx: number, j: number, sector: number): [number, number, number] {
  switch (kind) {
    case 'screenBank': return screenCellMean(wx, j, sector);
    case 'viewscreen': return viewscreenMean(wx, j, sector);
    case 'fluorescent': return fluoroCellMean(wx, j, sector);
    default: return signMean();
  }
}

const inLoop = (x: number, z: number, loop: readonly XZ[]): boolean => {
  let inside = false;
  for (let i = 0, k = loop.length - 1; i < loop.length; k = i++) {
    const [xi, zi] = loop[i]!, [xk, zk] = loop[k]!;
    if ((zi > z) !== (zk > z) && x < ((xk - xi) * (z - zi)) / (zk - zi) + xi) inside = !inside;
  }
  return inside;
};

/** Accumulates cells into patches and the surface mean. */
class PatchGrid {
  sum: RGB[] = []; n: number[] = []; c: V3[] = []; a: number[] = [];
  constructor(count: number, centre: (k: number) => V3, area: (k: number) => number) {
    for (let k = 0; k < count; k++) { this.sum.push([0, 0, 0]); this.n.push(0); this.c.push(centre(k)); this.a.push(area(k)); }
  }
  add(k: number, rgb: readonly number[]) { const s = this.sum[k]!; s[0] += rgb[0]!; s[1] += rgb[1]!; s[2] += rgb[2]!; this.n[k]!++; }
  patches(factor: number): EmitPatch[] {
    const out: EmitPatch[] = [];
    for (let k = 0; k < this.sum.length; k++) {
      const n = this.n[k]!;
      if (n === 0 || this.a[k]! <= 0) continue;
      const s = this.sum[k]!;
      out.push({ c: this.c[k]!, area: this.a[k]!, rgb: [s[0] / n * factor, s[1] / n * factor, s[2] / n * factor] });
    }
    return out;
  }
}

function meanOf(patches: readonly EmitPatch[]): RGB {
  const out: RGB = [0, 0, 0];
  let a = 0;
  for (const p of patches) { for (let i = 0; i < 3; i++) out[i]! += p.rgb[i]! * p.area; a += p.area; }
  return a > 0 ? [out[0] / a, out[1] / a, out[2] / a] : out;
}

/** Every emitter wall quad and fluorescent ceiling polygon of the map (its ORIGINAL lines: a mesh's
 *  refined pieces show the same cells). `on` false (?emitters=0) has none. */
export function emitterSurfaces(map: SectorMap, on = true): EmitterSurface[] {
  if (!on) return [];
  const out: EmitterSurface[] = [];
  const factorOf = (sector: number, floor: number) =>
    emitterFactor(sectorAmbient(map.sectors[sector]!.light, DEFAULT_SECTOR_LIGHT), DEFAULT_SECTOR_LIGHT.max, floor);

  for (const q of wallQuads(map)) {
    const kind = surfaceKind(q.mat, 'wall') as PanelKind;
    const look = SURFACE_LOOKS[kind];
    if (!EMIT_KINDS.has(kind) || !look.emit || !look.fit) continue;
    const fit = look.fit;
    const dx = q.b[0] - q.a[0], dz = q.b[1] - q.a[1], len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    const full = q.along[2];
    const start: XZ = [q.a[0] - ux * q.along[0], q.a[1] - uz * q.along[0]];
    const seed = lineSeedTiles(start[0], start[1]);
    const h = q.y1 - q.y0;
    // The shader's cells: n along the whole line (wallFit), m up the quad.
    const n = Math.max(1, Math.round(full / fit.u));
    const m = Math.max(1, Math.round(h / fit.v));
    const cellAlong = full / n, cellUp = h / m;
    const pa = Math.max(1, Math.ceil(len / EMIT_PATCH_M - 1e-9)), pv = Math.max(1, Math.ceil(h / EMIT_PATCH_M - 1e-9));
    const grid = new PatchGrid(pa * pv, k => {
      const i = k % pa, j = Math.floor(k / pa);
      const t = q.along[0] + ((i + 0.5) / pa) * len;
      return [start[0] + ux * t, q.y0 + ((j + 0.5) / pv) * h, start[1] + uz * t];
    }, () => (len / pa) * (h / pv));
    const wx0 = Math.round(seed / fit.cu);
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * cellAlong;
        if (t < q.along[0] - 1e-6 || t > q.along[1] + 1e-6) continue;
        const ki = Math.min(pa - 1, Math.floor(((t - q.along[0]) / len) * pa));
        const kj = Math.min(pv - 1, Math.floor((((j + 0.5) * cellUp) / h) * pv));
        grid.add(kj * pa + ki, cellMean(kind, wx0 + i, j, q.sector));
      }
    }
    const factor = factorOf(q.sector, look.emit.floor);
    const patches = grid.patches(factor);
    const min: XZ = [Math.min(q.a[0], q.b[0]), Math.min(q.a[1], q.b[1])], max: XZ = [Math.max(q.a[0], q.b[0]), Math.max(q.a[1], q.b[1])];
    out.push({
      kind, cls: CLASS_OF[look.emit.gain], role: 'wall', sector: q.sector, zone: map.sectors[q.sector]!.zone,
      normal: [-uz, 0, ux], centre: [(q.a[0] + q.b[0]) / 2, (q.y0 + q.y1) / 2, (q.a[1] + q.b[1]) / 2],
      area: len * h, seed, colour: meanOf(patches), factor, min, max, patches,
      occluders: occludersNear(map, min, max, EMIT_CUTOFF_M),
    });
  }

  for (const poly of sectorPolygons(map)) {
    const s = map.sectors[poly.sector]!;
    const kind = surfaceKind(s.materials.ceil, 'ceil') as PanelKind;
    const look = SURFACE_LOOKS[kind];
    if (!EMIT_KINDS.has(kind) || !look.emit || !look.fit) continue;
    const box = polyBox(poly.outer);
    const [nx, nz] = flatFitCells(look.fit, box);
    const w = box.max[0] - box.min[0], d = box.max[1] - box.min[1];
    if (w <= 0 || d <= 0) continue;
    const px = Math.max(1, Math.ceil(w / EMIT_PATCH_M - 1e-9)), pz = Math.max(1, Math.ceil(d / EMIT_PATCH_M - 1e-9));
    const inside = (x: number, z: number) => inLoop(x, z, poly.outer) && !poly.holes.some(hl => inLoop(x, z, hl));
    // A patch's area: its share of the cells inside the polygon (counted below).
    const cellArea = (w / nx) * (d / nz);
    const counts = new Array<number>(px * pz).fill(0);
    const grid = new PatchGrid(px * pz, k => [box.min[0] + ((k % px) + 0.5) / px * w, s.ceil, box.min[1] + (Math.floor(k / px) + 0.5) / pz * d], () => 1);
    let area = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = box.min[0] + ((i + 0.5) / nx) * w, z = box.min[1] + ((j + 0.5) / nz) * d;
        if (!inside(x, z)) continue;
        const k = Math.min(pz - 1, Math.floor(((z - box.min[1]) / d) * pz)) * px + Math.min(px - 1, Math.floor(((x - box.min[0]) / w) * px));
        grid.add(k, cellMean(kind, i, j, poly.sector));
        counts[k]!++;
        area += cellArea;
      }
    }
    for (let k = 0; k < counts.length; k++) grid.a[k] = counts[k]! * cellArea;
    const factor = factorOf(poly.sector, look.emit.floor);
    const patches = grid.patches(factor);
    if (patches.length === 0) continue;
    out.push({
      kind, cls: CLASS_OF[look.emit.gain], role: 'ceil', sector: poly.sector, zone: s.zone,
      normal: [0, -1, 0], centre: [(box.min[0] + box.max[0]) / 2, s.ceil, (box.min[1] + box.max[1]) / 2],
      area, seed: 0, colour: meanOf(patches), factor, min: box.min, max: box.max, patches,
      occluders: occludersNear(map, box.min, box.max, EMIT_CUTOFF_M),
    });
  }
  return out;
}

/** The surfaces' boxes and reach (for refineNear / nearAny). */
export const emitterReach = (surfaces: readonly EmitterSurface[]): Reach[] =>
  surfaces.map(s => ({ min: s.min, max: s.max, reach: EMIT_CUTOFF_M }));

/** Smooth 1 → 0 over the last quarter of the cutoff. */
export function emitFade(d: number): number {
  if (d >= EMIT_CUTOFF_M) return 0;
  const t = Math.min(1, Math.max(0, (EMIT_CUTOFF_M - d) / (0.25 * EMIT_CUTOFF_M)));
  return t * t * (3 - 2 * t);
}

/** The baked emitter bounce per vertex: [screen r, g, b, fluoro, sign]. */
export type EmitBake = [number, number, number, number, number];
export interface EmitterBounce {
  surfaces: readonly EmitterSurface[];
  /** As GlowBounce.at: `into` an x/z direction into the vertex's own sector, so a ray starts inside it. */
  at(p: V3, n: V3, into: XZ, out?: EmitBake): EmitBake;
}

export function createEmitterBounce(surfaces: readonly EmitterSurface[]): EmitterBounce {
  const R = EMIT_CUTOFF_M;
  return {
    surfaces,
    at(p, n, into, out = [0, 0, 0, 0, 0]) {
      out.fill(0);
      const il = Math.hypot(into[0], into[1]) || 1;
      const start: V3 = [p[0] + n[0] * START_OFF_M + (into[0] / il) * START_OFF_M, p[1] + n[1] * START_OFF_M,
        p[2] + n[2] * START_OFF_M + (into[1] / il) * START_OFF_M];
      for (const s of surfaces) {
        if (p[0] < s.min[0] - R || p[0] > s.max[0] + R || p[2] < s.min[1] - R || p[2] > s.max[1] + R) continue;
        // In front of the surface at all? (Its plane: a wall's line, a ceiling's height.)
        const ne = s.normal;
        const side = (p[0] - s.centre[0]) * ne[0] + (p[1] - s.centre[1]) * ne[1] + (p[2] - s.centre[2]) * ne[2];
        if (side <= 1e-4) continue;
        let seen = -1;
        for (const pt of s.patches) {
          const dx = p[0] - pt.c[0], dy = p[1] - pt.c[1], dz = p[2] - pt.c[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= R * R) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const ce = (dx * ne[0] + dy * ne[1] + dz * ne[2]) / d;
          if (ce <= 0) continue;
          const cr = (-(dx * n[0] + dy * n[1] + dz * n[2]) / d + WRAP) / (1 + WRAP);
          if (cr <= 0) continue;
          if (seen < 0) {
            // Visibility once per surface: rays to its first, middle and last patch (2.5D, sector-bounce rayClear).
            const ps = s.patches, picks = ps.length <= 2 ? ps : [ps[0]!, ps[ps.length >> 1]!, ps[ps.length - 1]!];
            let ok = 0;
            for (const q of picks) {
              const tgt: V3 = [q.c[0] + ne[0] * TARGET_OFF_M, q.c[1] + ne[1] * TARGET_OFF_M, q.c[2] + ne[2] * TARGET_OFF_M];
              if (rayClear(s.occluders, start, tgt)) ok++;
            }
            seen = ok / picks.length;
            if (seen === 0) break;
          }
          const w = (pt.area * ce * cr) / (Math.PI * d2 + pt.area) * emitFade(d) * seen * EMIT_CLASS_BAKE[s.cls];
          if (s.cls === 'screen') { out[0] += pt.rgb[0] * w; out[1] += pt.rgb[1] * w; out[2] += pt.rgb[2] * w; }
          else if (s.cls === 'fluoro') out[3] += (pt.rgb[1] / FLUORO_RGB[1]) * w;
          else out[4] += (pt.rgb[0] / SIGN_RGB[0]) * w;
        }
      }
      return out;
    },
  };
}
