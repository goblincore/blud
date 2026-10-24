// src/lab/sdf-zombie/webgpu/sector-geometry.test.ts
//
// Spec §6.4: floors/ceilings as polygons with holes, walls as quads facing into their sector.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loopArea, sectorPolygons, wallQuads } from './sector-geometry';
import { buildSectorGround } from './sector-ground';
import { parseSectorLevel } from './sector-json';

const map = () => parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;

describe('sectorPolygons', () => {
  const polys = sectorPolygons(map());
  it('gives one polygon per sector here', () => {
    expect(polys.map(p => p.sector)).toEqual([0, 1, 2, 3]);
  });
  it('finds the column as a hole in A', () => {
    const a = polys.find(p => p.sector === 0)!;
    expect(Math.abs(loopArea(a.outer))).toBeCloseTo(64, 6);
    expect(a.holes).toHaveLength(1);
    expect(Math.abs(loopArea(a.holes[0]!))).toBeCloseTo(4, 6);
  });
  it('B has no holes and the right area', () => {
    const b = polys.find(p => p.sector === 1)!;
    expect(b.holes).toHaveLength(0);
    expect(Math.abs(loopArea(b.outer))).toBeCloseTo(32, 6);
  });
});

describe('wallQuads', () => {
  const m = map();
  const quads = wallQuads(m);
  it('makes full-height walls for one-sided lines', () => {
    const north = quads.find(q => q.a[1] === 0 && q.b[1] === 0 && q.sector === 0)!;   // line 0-1 at z = 0
    expect([north.y0, north.y1, north.part]).toEqual([0, 4, 'mid']);
  });
  it('makes the step riser between A and B, seen from A', () => {
    const riser = quads.find(q => q.a[1] === -8 && q.b[1] === -8 && q.part === 'lower')!;
    expect([riser.y0, riser.y1, riser.sector]).toEqual([0, 0.5, 0]);
  });
  it('makes the pit wall between A and D, seen from D', () => {
    const pit = quads.find(q => q.a[0] === 4 && q.b[0] === 4 && q.part === 'lower')!;
    expect([pit.y0, pit.y1, pit.sector]).toEqual([-1, 0, 3]);
  });
  it('makes no quad where both sides match', () => {
    expect(quads.some(q => q.a[0] === 4 && q.b[0] === 4 && q.part === 'upper')).toBe(false);
  });
  it('faces every quad into its sector (left of a -> b)', () => {
    const g = buildSectorGround(m);
    for (const q of quads) {
      const mx = (q.a[0] + q.b[0]) / 2, mz = (q.a[1] + q.b[1]) / 2;
      const dx = q.b[0] - q.a[0], dz = q.b[1] - q.a[1], n = Math.hypot(dx, dz);
      expect(g.sectorAt(mx + (-dz / n) * 0.05, mz + (dx / n) * 0.05)).toBe(q.sector);
    }
  });
});

// --- pinch vertices: the loops must not depend on line order -----------------------------------
import type { SectorDef, SectorLine, SectorMap, XZ } from './sector-def';

const sec = (): SectorDef => ({ floor: 0, ceil: 4, light: 1, special: 'none', hurtPerSec: 0, glow: null, zone: 0, materials: { floor: 'f', ceil: 'c', wall: 'w' } });
/** Sector 0 on the left of each directed loop (CCW outer = positive, CW hole = negative). */
function mapOf(loops: XZ[][]): SectorMap {
  const vertices: XZ[] = [], lines: SectorLine[] = [];
  const idx = (p: XZ) => { let i = vertices.findIndex(v => v[0] === p[0] && v[1] === p[1]); if (i < 0) { i = vertices.length; vertices.push(p); } return i; };
  for (const loop of loops) loop.forEach((p, i) => lines.push({ v: [idx(p), idx(loop[(i + 1) % loop.length]!)], front: 0, back: -1, door: null, exit: false }));
  return { vertices, sectors: [sec()], lines };
}
function shuffled(map: SectorMap, seed: number): SectorMap {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const lines = [...map.lines];
  for (let i = lines.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [lines[i], lines[j]] = [lines[j]!, lines[i]!]; }
  return { ...map, lines };
}
const areas = (ls: readonly (readonly XZ[])[]) => ls.map(l => Math.abs(loopArea(l))).sort((a, b) => a - b);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe('sectorPolygons at pinch vertices', () => {
  const ccw = (x: number, z: number, w: number, h: number): XZ[] => [[x, z], [x + w, z], [x + w, z + h], [x, z + h]];
  const cw = (x: number, z: number, w: number, h: number): XZ[] => ccw(x, z, w, h).reverse();

  it('a hole touching the outer wall at a vertex', () => {
    const base = mapOf([ccw(0, 0, 10, 10), [[0, 0], [1, 3], [3, 1]]]);
    // the hole's corner (0,0) is the outer's corner (0,0): a vertex with 4 edges
    for (const seed of SEEDS) {
      const polys = sectorPolygons(shuffled(base, seed));
      expect(polys).toHaveLength(1);
      expect(areas([polys[0]!.outer])).toEqual([100]);
      expect(areas(polys[0]!.holes)).toEqual([4]);
    }
  });
  it('two pillars touching at a corner', () => {
    const base = mapOf([ccw(-10, -10, 20, 20), cw(1, 1, 2, 2), cw(-1, -1, 2, 2)]);
    for (const seed of SEEDS) {
      const polys = sectorPolygons(shuffled(base, seed));
      expect(polys).toHaveLength(1);
      expect(areas([polys[0]!.outer])).toEqual([400]);
      expect(areas(polys[0]!.holes)).toEqual([4, 4]);
    }
  });
  it('two lobes of one sector touching at a point', () => {
    const base = mapOf([ccw(0, 0, 4, 4), ccw(4, 4, 3, 3)]);
    for (const seed of SEEDS) {
      const polys = sectorPolygons(shuffled(base, seed));
      expect(polys).toHaveLength(2);
      expect(areas(polys.map(p => p.outer))).toEqual([9, 16]);
      expect(polys.every(p => p.holes.length === 0)).toBe(true);
    }
  });
});
