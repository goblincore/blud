// src/lab/sdf-zombie/webgpu/sector-portals.test.ts
//
// The portal flood (sector-portals.ts) on small synthetic maps: a row of three rooms joined by full-width portals,
// and a 2x2 grid round one vertex (a portal cycle).

import { describe, expect, it } from 'vitest';
import { buildPortalGraph, createFloodScratch, discVisible, floodSectors, frustumHalfAngle, visibleZones, type FloodView } from './sector-portals';
import type { SectorDef, SectorMap } from './sector-def';

const sector = (zone: number, ceil = 3, sky = false): SectorDef => ({
  floor: 0, ceil, light: 1, special: 'none', hurtPerSec: 0, glow: null, zone,
  materials: { floor: 'stone', ceil: sky ? 'sky' : 'stone', wall: 'stone' },
});
const line = (a: number, b: number, front: number, back = -1) => ({ v: [a, b] as const, front, back, door: null, exit: false });

/** Rooms 0 | 1 | 2 along x (x 0..4, 4..8, 8..12; z -2..2); portals are lines 1 (x = 4) and 5 (x = 8). */
function row(sectors: SectorDef[] = [sector(0), sector(1), sector(2)]): SectorMap {
  return {
    vertices: [[0, -2], [4, -2], [8, -2], [12, -2], [12, 2], [8, 2], [4, 2], [0, 2]],
    sectors,
    lines: [
      line(0, 1, 0), line(1, 6, 0, 1), line(6, 7, 0), line(7, 0, 0),
      line(1, 2, 1), line(2, 5, 1, 2), line(5, 6, 1),
      line(2, 3, 2), line(3, 4, 2), line(4, 5, 2),
    ],
  };
}

const view = (x: number, z: number, fx: number, fz: number, half: number): FloodView => ({ x, z, fx, fz, half });
function flood(map: SectorMap, v: FloodView, eye: number, closed?: (l: number) => boolean) {
  const g = buildPortalGraph(map);
  const out = new Uint8Array(g.sectorCount);
  const stats = floodSectors(g, v, eye, out, closed ? { closed } : {});
  return { seen: [...out], stats, g, out };
}

describe('the portal flood', () => {
  it('sees down the row through both portals', () => {
    expect(flood(row(), view(2, 0, 1, 0, 0.8), 0).seen).toEqual([1, 1, 1]);
  });
  it('sees nothing behind the camera', () => {
    expect(flood(row(), view(2, 0, -1, 0, 0.8), 0).seen).toEqual([1, 0, 0]);
  });
  it('a closed door closes its portal (and everything beyond it)', () => {
    expect(flood(row(), view(2, 0, 1, 0, 0.8), 0, l => l === 5).seen).toEqual([1, 1, 0]);
    expect(flood(row(), view(2, 0, 1, 0, 0.8), 0, l => l === 1).seen).toEqual([1, 0, 0]);
  });
  it('the frustum edge: a portal just outside the wedge (margin included) is culled, just inside is kept', () => {
    // From (2, 0) facing +z, the x = 4 portal spans 45..135 deg to the right; its margin at 2 m is atan(0.35 / 2).
    const edge = Math.PI / 4 - Math.atan(0.35 / 2);
    expect(flood(row(), view(2, 0, 0, 1, edge - 0.02), 0).seen).toEqual([1, 0, 0]);
    expect(flood(row(), view(2, 0, 0, 1, edge + 0.02), 0).seen.slice(0, 2)).toEqual([1, 1]);
  });
  it('narrows the wedge portal by portal: a steep look through the first portal misses the second', () => {
    // From (3.5, -1.9) the x = 4 portal spans -11..83 deg off +x (toward +z), the x = 8 one -1..41 deg (+4 margin):
    // a look at 70 deg, +-11 deg wide, goes through the first and misses the second.
    const a = (70 * Math.PI) / 180;
    expect(flood(row(), view(3.5, -1.9, Math.cos(a), Math.sin(a), 0.2), 0).seen).toEqual([1, 1, 0]);
    expect(flood(row(), view(3.5, -1.9, Math.cos(a), Math.sin(a), 0.6), 0).seen).toEqual([1, 1, 1]);
  });
  it('a portal at the eye passes the wedge unchanged (the eye on a threshold)', () => {
    expect(flood(row(), view(3.8, 0, -1, 0, 0.5), 0).seen).toEqual([1, 1, 0]);
  });
  it('a span that wraps behind the camera is still seen with a full wedge', () => {
    expect(flood(row(), view(2, 0, -1, 0, Math.PI), 0).seen).toEqual([1, 1, 1]);
  });
  it('a two-sided line with no vertical opening is a wall', () => {
    const shut = { ...sector(1), floor: 3, ceil: 5 };   // room 1's floor at room 0's ceiling
    expect(flood(row([sector(0), shut, sector(2)]), view(2, 0, 1, 0, 0.8), 0).seen).toEqual([1, 0, 0]);
    const step = { ...sector(1), floor: 1, ceil: 5 };   // a 1 m step up still opens
    expect(flood(row([sector(0), step, sector(2)]), view(2, 0, 1, 0, 0.8), 0).seen).toEqual([1, 1, 1]);
  });
  it('the eye in the void sees everything (fail open)', () => {
    const r = flood(row(), view(-5, 0, 1, 0, 0.8), -1);
    expect(r.seen).toEqual([1, 1, 1]);
    expect(r.stats.failOpen).toBe(true);
  });
  it('a sky sector shows taller sectors over its walls, in the wedge only', () => {
    const m = row([sector(0, 3, true), sector(1, 2.5), sector(2, 6)]);
    // Line 1 shut: only the sky can show room 2 (taller); room 1 (lower) stays hidden.
    expect(flood(m, view(2, 0, 1, 0, 0.8), 0, l => l === 1).seen).toEqual([1, 0, 1]);
    expect(flood(m, view(2, 0, -1, 0, 0.8), 0, l => l === 1).seen).toEqual([1, 0, 0]);
  });
  it('terminates on a portal cycle and sees round it', () => {
    // 2x2 grid round vertex 0 (0, 0): Q0 (-x, -z), Q1 (+x, -z), Q2 (+x, +z), Q3 (-x, +z).
    const map: SectorMap = {
      vertices: [[0, 0], [-2, -2], [0, -2], [2, -2], [2, 0], [2, 2], [0, 2], [-2, 2], [-2, 0]],
      sectors: [sector(0), sector(0), sector(1), sector(1)],
      lines: [
        line(1, 2, 0), line(2, 0, 0, 1), line(0, 8, 0, 3), line(8, 1, 0),
        line(2, 3, 1), line(3, 4, 1), line(4, 0, 1, 2),
        line(4, 5, 2), line(5, 6, 2), line(6, 0, 2, 3),
        line(6, 7, 3), line(7, 8, 3),
      ],
    };
    const r = flood(map, view(-1, -1, 1, 1, Math.PI), 0);
    expect(r.seen).toEqual([1, 1, 1, 1]);
    expect(r.stats.failOpen).toBe(false);
    expect(r.stats.steps).toBeLessThan(40);
    const zones = new Uint8Array(r.g.zoneCount);
    visibleZones(r.g, r.out, zones);
    expect([...zones]).toEqual([1, 1]);
  });
  it('reuses its scratch between frames with the same answer', () => {
    const g = buildPortalGraph(row());
    const sc = createFloodScratch(g), out = new Uint8Array(3);
    floodSectors(g, view(2, 0, 1, 0, 0.8), 0, out, {}, sc);
    expect([...out]).toEqual([1, 1, 1]);
    floodSectors(g, view(2, 0, -1, 0, 0.8), 0, out, {}, sc);
    expect([...out]).toEqual([1, 0, 0]);
  });
});

describe('discVisible', () => {
  it('a disc reaches across portal lines within its radius, not further', () => {
    const g = buildPortalGraph(row());
    const only2 = Uint8Array.from([0, 0, 1]);
    expect(discVisible(g, 1, 7.5, 0, 1, only2)).toBe(true);    // 0.5 m from the x = 8 portal
    expect(discVisible(g, 1, 6, 0, 1, only2)).toBe(false);     // 2 m from it
    expect(discVisible(g, 0, 3.8, 0, 4.5, only2)).toBe(true);  // through room 1 into room 2
    expect(discVisible(g, -1, 0, 0, 1, only2)).toBe(true);     // off the map: never culled
  });
});

describe('frustumHalfAngle', () => {
  it('bounds the horizontal half-angle level, and opens fully looking straight up or down', () => {
    const level = frustumHalfAngle(60, 1.6, 0, 0);
    expect(level).toBeCloseTo(Math.atan(Math.tan(Math.PI / 6) * 1.6), 6);
    expect(frustumHalfAngle(60, 1.6, 0.6, 0)).toBeGreaterThan(level);
    expect(frustumHalfAngle(60, 1.6, 1.4)).toBe(Math.PI);
    expect(frustumHalfAngle(60, 1.6, -1.4)).toBe(Math.PI);
  });
});
