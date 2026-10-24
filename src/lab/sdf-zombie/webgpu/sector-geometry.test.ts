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
  const quads = wallQuads(m, buildSectorGround(m).sectorAt);
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
