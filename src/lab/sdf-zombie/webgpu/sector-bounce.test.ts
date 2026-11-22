// src/lab/sdf-zombie/webgpu/sector-bounce.test.ts
//
// Glow bounce (hand-off 2026-10-24 item 2b): falloff, occlusion by walls and lips, refinement.

import { describe, expect, it } from 'vitest';
import {
  BOUNCE_CUTOFF_M, bounceFalloff, createGlowBounce, glowSources, nearestOnPool, nearGlow, REFINE_MAX_M, refineFaces, refineNearGlow, wallRows, wallStrip,
} from './sector-bounce';
import type { SectorDef, SectorMap } from './sector-def';
import { loopArea, sectorPolygons, wallQuads } from './sector-geometry';
import { wallU } from './sector-materials';

const sector = (floor: number, ceil: number, glow: SectorDef['glow'] = null): SectorDef => ({
  floor, ceil, light: 1, special: 'none', hurtPerSec: 0, glow, zone: 0,
  materials: { floor: 'default', ceil: 'default', wall: 'default' },
});
const line = (a: number, b: number, front: number, back = -1) => ({ v: [a, b] as [number, number], front, back, door: null, exit: false });

/** Room A (x 0..10, z 0..10, sector 0) round a sunken nukage pool (x 4..6, z 4..6, sector 1, floor -0.5);
 *  room B (x 10.5..20, sector 2) behind A's solid east wall. */
function twoRooms(): SectorMap {
  return {
    vertices: [[0, 0], [10, 0], [10, 10], [0, 10], [4, 4], [6, 4], [6, 6], [4, 6], [10.5, 0], [20, 0], [20, 10], [10.5, 10]],
    sectors: [sector(0, 4), sector(-0.5, 4, 'nukage'), sector(0, 4)],
    lines: [
      line(0, 1, 0), line(1, 2, 0), line(2, 3, 0), line(3, 0, 0),
      line(4, 5, 1, 0), line(5, 6, 1, 0), line(6, 7, 1, 0), line(7, 4, 1, 0),
      line(8, 9, 2), line(9, 10, 2), line(10, 11, 2), line(11, 8, 2),
    ],
  };
}

describe('wallRows', () => {
  it('cuts on the world grid, keeping both ends', () => {
    expect(wallRows(0, 4, 1.5)).toEqual([0, 1.5, 3, 4]);
    expect(wallRows(-2.5, -1.75, 1.5)).toEqual([-2.5, -1.75]);
    expect(wallRows(1.5, 3, 1.5)).toEqual([1.5, 3]);
    expect(wallRows(-2, 2, 1.5)).toEqual([-2, -1.5, 0, 1.5, 2]);
  });
});

describe('bounceFalloff', () => {
  it('is 1 at the pool, 1/2 at the falloff distance, 0 at the cutoff, and never rises', () => {
    expect(bounceFalloff(0)).toBe(1);
    expect(bounceFalloff(3)).toBeCloseTo(0.5, 6);
    expect(bounceFalloff(BOUNCE_CUTOFF_M)).toBe(0);
    let prev = Infinity;
    for (let d = 0; d <= BOUNCE_CUTOFF_M; d += 0.05) { const f = bounceFalloff(d); expect(f).toBeLessThanOrEqual(prev + 1e-12); prev = f; }
  });
});

describe('glowSources and nearestOnPool', () => {
  const [src] = glowSources(twoRooms());
  it('finds the pool with its area, floor and kind', () => {
    expect(glowSources(twoRooms())).toHaveLength(1);
    expect(src).toMatchObject({ sector: 1, kind: 'nukage', floor: -0.5 });
    expect(src!.targetY).toBeCloseTo(0.1, 9);                       // aimed just over the rim (room A's floor)
    expect(src!.area).toBeCloseTo(4, 6);
  });
  it('the nearest point is the point itself inside, the edge outside', () => {
    expect(nearestOnPool(src!, 5, 5).d).toBe(0);
    const o = nearestOnPool(src!, 1, 5);
    expect(o.d).toBeCloseTo(3, 6);
    expect(o.p).toEqual([4, 5]);
  });
});

describe('createGlowBounce', () => {
  const b = createGlowBounce(twoRooms());
  const at = (p: [number, number, number], n: [number, number, number]) => b.at(p, n, [n[0], n[2]]);
  it('a wall facing the pool goes green', () => {
    const c = at([0, 1, 5], [1, 0, 0]);                              // A's west wall
    expect(c[1]).toBeGreaterThan(0.01);
    expect(c[1]).toBeGreaterThan(c[0] * 3);
    expect(c[1]).toBeGreaterThan(c[2] * 3);
  });
  it('nearer is brighter', () => {
    expect(at([0, 1, 5], [1, 0, 0])[1]).toBeGreaterThan(at([0, 3.9, 0.1], [1, 0, 0])[1]);
  });
  it('the ceiling over the pool catches it', () => {
    expect(at([5, 4, 5], [0, -1, 0])[1]).toBeGreaterThan(0.01);
  });
  it('nothing through a solid wall: room B stays dark on either side of its walls', () => {
    expect(at([20, 1, 5], [-1, 0, 0])).toEqual([0, 0, 0]);          // B's east wall, facing the pool through A's wall
    expect(at([10.5, 1, 5], [1, 0, 0])).toEqual([0, 0, 0]);         // B's west wall, the back of the solid wall
    expect(at([15, 0, 5], [0, 1, 0])).toEqual([0, 0, 0]);           // B's floor
  });
  it('the back of a wall gets nothing (A\'s east wall seen from inside does)', () => {
    expect(at([10, 1, 5], [-1, 0, 0])[1]).toBeGreaterThan(0);
    expect(at([10, 1, 5], [1, 0, 0])).toEqual([0, 0, 0]);
  });
  it('the pool\'s own rim does not shade it: the floor round the pit catches a little, the riser a lot', () => {
    const floor = at([2, 0, 5], [0, 1, 0]);
    expect(floor[1]).toBeGreaterThan(0);
    expect(floor[1]).toBeLessThan(at([0, 1, 5], [1, 0, 0])[1] * 1.5);
    expect(b.at([4, -0.25, 5], [1, 0, 0], [1, 0])[1]).toBeGreaterThan(0.1);
  });
  it('nothing past the cutoff', () => {
    expect(at([19.9, 1, 5], [-1, 0, 0])).toEqual([0, 0, 0]);       // 13.9 m off, even with no wall between
    expect(createGlowBounce({ ...twoRooms(), lines: twoRooms().lines.filter((_, i) => i !== 1) }).sources).toHaveLength(1);
  });
});

describe('refineNearGlow', () => {
  const map = twoRooms();
  const r = refineNearGlow(map);
  const len = (m: SectorMap, i: number) => {
    const [a, b] = m.lines[i]!.v.map(v => m.vertices[v]!);
    return Math.hypot(b![0] - a![0], b![1] - a![1]);
  };
  it('splits the lines near a pool to at most REFINE_MAX_M and leaves far ones alone', () => {
    for (let i = 0; i < r.lines.length; i++) {
      const [a, b] = r.lines[i]!.v.map(v => r.vertices[v]!);
      const far = Math.min(a![0], b![0]) >= 20;                  // B's east wall: 14 m from the pool box
      if (!far) expect(len(r, i)).toBeLessThanOrEqual(REFINE_MAX_M + 1e-9);
    }
    expect(r.lines.some(l => l.v.every(v => r.vertices[v]![0] === 20) && Math.abs(r.vertices[l.v[0]]![1] - r.vertices[l.v[1]]![1]) === 10)).toBe(true);
  });
  it('keeps every sector\'s area, and walls on both sides of a split line share their split points', () => {
    const area = (m: SectorMap) => sectorPolygons(m).map(p => loopArea(p.outer) + p.holes.reduce((s, h) => s + loopArea(h), 0));
    expect(area(r).map(a => +a.toFixed(6))).toEqual(area(map).map(a => +a.toFixed(6)));
    const key = (p: readonly number[]) => `${p[0]},${p[1]}`;
    const lowerFromA = new Set(wallQuads(r).filter(q => q.sector === 1).flatMap(q => [key(q.a), key(q.b)]));
    const poolEdge = new Set(sectorPolygons(r).find(p => p.sector === 0)!.holes.flat().map(key));
    expect([...lowerFromA].sort()).toEqual([...poolEdge].sort());
  });
  it('pieces carry their original line (start and length); unsplit lines carry none', () => {
    for (const l of r.lines) {
      if (!l.origin) continue;
      const [a, b] = l.v.map(v => r.vertices[v]!);
      for (const p of [a!, b!]) expect(Math.hypot(p[0] - l.origin.a[0], p[1] - l.origin.a[1])).toBeLessThanOrEqual(l.origin.len + 1e-9);
    }
    expect(r.lines.some(l => l.origin && l.origin.len > REFINE_MAX_M)).toBe(true);
    expect(map.lines.every(l => l.origin === undefined)).toBe(true);
    // A door near a pool: its pieces' u (wallU) runs 0..1 tile across the whole line, not per piece.
    const pieces = wallQuads(r).filter(q => q.along[2] > REFINE_MAX_M + 1e-9 && q.along[2] <= 6);
    const ends = pieces.map(q => wallU('door', q.a, q.along, q.b[0] - q.a[0], q.b[1] - q.a[1], Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), 4));
    for (const [u0, u1] of ends) { expect(u0).toBeGreaterThanOrEqual(-1e-9); expect(u1).toBeLessThanOrEqual(Math.max(1, Math.round(6 / 4)) + 1e-9); }
  });
  it('a map with no glow comes back as is', () => {
    const plain: SectorMap = { ...map, sectors: map.sectors.map(s => ({ ...s, glow: null })) };
    expect(refineNearGlow(plain)).toBe(plain);
  });
});

describe('nearGlow and wallStrip', () => {
  const src = glowSources(twoRooms());
  it('nearGlow is the pool box grown by the cutoff', () => {
    expect(nearGlow(src, 0, 0)).toBe(true);
    expect(nearGlow(src, 6 + BOUNCE_CUTOFF_M - 0.01, 5)).toBe(true);
    expect(nearGlow(src, 6 + BOUNCE_CUTOFF_M + 0.01, 5)).toBe(false);
  });
  it('a plain quad is two triangles; uneven edges zip into a strip covering both', () => {
    expect(wallStrip([0, 4], [0, 4])).toEqual([[[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 1], [0, 1]]]);
    const tris = wallStrip([0, 1.5, 3, 4], [0, 4]);
    expect(tris).toHaveLength(4);
    const used = (side: number) => new Set(tris.flatMap(t => t.filter(c => c[0] === side).map(c => c[1])));
    expect([...used(0)].sort()).toEqual([0, 1, 2, 3]);
    expect([...used(1)].sort()).toEqual([0, 1]);
    // Area in (side, y) space: the strip covers the trapezoid exactly (no gaps, no overlaps).
    const L = [0, 1.5, 3, 4], R = [0, 4];
    const pt = ([s, r]: [number, number]) => [s, s === 0 ? L[r]! : R[r]!] as const;
    const area = tris.reduce((acc, t) => {
      const [p, q, w] = t.map(pt) as [readonly [number, number], readonly [number, number], readonly [number, number]];
      return acc + Math.abs((q[0] - p[0]) * (w[1] - p[1]) - (w[0] - p[0]) * (q[1] - p[1])) / 2;
    }, 0);
    expect(area).toBeCloseTo(4, 9);
  });
});

describe('occlusion by lips, closed doors, soffits and tall risers', () => {
  /** twoRooms with an island sector 3 (x 2..3, z 3..7) in room A between its west wall and the pool. */
  const withIsland = (floor: number, ceil: number): SectorMap => {
    const m = twoRooms();
    const v = m.vertices.length;
    return {
      vertices: [...m.vertices, [2, 3], [3, 3], [3, 7], [2, 7]],
      sectors: [...m.sectors, sector(floor, ceil)],
      lines: [...m.lines, line(v, v + 1, 3, 0), line(v + 1, v + 2, 3, 0), line(v + 2, v + 3, 3, 0), line(v + 3, v, 3, 0)],
    };
  };
  const west = (m: SectorMap) => createGlowBounce(m).at([0, 1, 5], [1, 0, 0], [1, 0]);
  it('a raised block (a lip) between the wall and the pool shades the wall', () => {
    expect(west(twoRooms())[1]).toBeGreaterThan(0);
    expect(west(withIsland(3, 4))).toEqual([0, 0, 0]);
  });
  it('a closed door (ceil == floor) blocks', () => {
    expect(west(withIsland(0, 0))).toEqual([0, 0, 0]);
  });
  it('the pool\'s own soffit blocks: a low pool ceiling under a tall room keeps the room\'s ceiling dark', () => {
    const m = twoRooms();
    const tall: SectorMap = { ...m, sectors: [sector(0, 8), sector(-0.5, 1, 'nukage'), sector(0, 4)] };
    expect(createGlowBounce(m).at([3.9, 4, 5], [0, -1, 0], [-1, 0])[1]).toBeGreaterThan(0);
    expect(createGlowBounce(tall).at([3.9, 8, 5], [0, -1, 0], [-1, 0])).toEqual([0, 0, 0]);
  });
  it('a riser taller than the rim allowance blocks: a pool 3 m down does not light the room above', () => {
    const m = twoRooms();
    const deep: SectorMap = { ...m, sectors: [sector(2.5, 6), sector(-0.5, 6, 'nukage'), sector(2.5, 6)] };
    expect(createGlowBounce(deep).at([0, 2.6, 5], [1, 0, 0], [1, 0])).toEqual([0, 0, 0]);
  });
});

describe('refineFaces (flats near emitters, item 2g B1)', () => {
  const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const faces = [[0, 1, 2], [0, 2, 3]];
  const edgeLens = (p: readonly (readonly number[])[], f: readonly (readonly number[])[]) => {
    const owners = new Map<string, number>();
    for (const t of f) for (let e = 0; e < 3; e++) { const a = t[e]!, b = t[(e + 1) % 3]!; const k = a < b ? `${a},${b}` : `${b},${a}`; owners.set(k, (owners.get(k) ?? 0) + 1); }
    return [...owners].map(([k, n]) => { const [a, b] = k.split(',').map(Number); return { n, len: Math.hypot(p[a!]![0]! - p[b!]![0]!, p[a!]![1]! - p[b!]![1]!) }; });
  };
  const area = (p: readonly (readonly number[])[], f: readonly (readonly number[])[]) =>
    f.reduce((s, [a, b, c]) => s + Math.abs((p[b!]![0]! - p[a!]![0]!) * (p[c!]![1]! - p[a!]![1]!) - (p[c!]![0]! - p[a!]![0]!) * (p[b!]![1]! - p[a!]![1]!)) / 2, 0);
  it('with a cut boundary (refineNear\'s pieces) every edge ends up at most maxLen; area kept; no T-junctions', () => {
    // The square's sides already in 2 m pieces, as refineNear leaves lines near an emitter.
    const ring: [number, number][] = [];
    for (let i = 0; i < 5; i++) ring.push([i * 2, 0]);
    for (let i = 0; i < 5; i++) ring.push([10, i * 2]);
    for (let i = 0; i < 5; i++) ring.push([10 - i * 2, 10]);
    for (let i = 0; i < 5; i++) ring.push([0, 10 - i * 2]);
    const fan = ring.slice(1, -1).map((_, i) => [0, i + 1, i + 2]);
    const r = refineFaces(ring, fan, 2.5, () => true);
    expect(r.faces.length).toBeGreaterThan(fan.length);
    expect(area(r.pts, r.faces)).toBeCloseTo(100, 6);
    for (const e of edgeLens(r.pts, r.faces)) { expect(e.n).toBeLessThanOrEqual(2); expect(e.len).toBeLessThanOrEqual(2.5 + 1e-9); }
    expect(edgeLens(r.pts, r.faces).filter(e => e.n === 1)).toHaveLength(20);   // the boundary pieces, unsplit
  });
  it('terminates on a long boundary edge (that triangle just stops)', () => {
    const r = refineFaces(pts, faces, 3, () => true);
    expect(area(r.pts, r.faces)).toBeCloseTo(100, 6);
    expect(edgeLens(r.pts, r.faces).filter(e => e.n === 1).map(e => e.len).sort()).toEqual([10, 10, 10, 10]);
  });
  it('leaves triangles far from emitters alone', () => {
    const r = refineFaces(pts, faces, 3, () => false);
    expect(r.faces).toEqual(faces);
  });
});
