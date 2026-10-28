// src/lab/sdf-zombie/webgpu/sector-emitters.test.ts
//
// Emitter surfaces and their baked bounce (hand-off item 2g, part B1).

import { describe, expect, it } from 'vitest';
import { screenCellMean, SIGN_RGB } from '../../../game/level/emitter-layout';
import type { SectorDef, SectorMap } from './sector-def';
import { createEmitterBounce, EMIT_CLASS_BAKE, EMIT_CUTOFF_M, EMIT_PATCH_M, emitFade, emitterSurfaces, type EmitBake } from './sector-emitters';

const sector = (floor: number, ceil: number, wall = 'default', ceilMat = 'default', light = 1): SectorDef => ({
  floor, ceil, light, special: 'none', hurtPerSec: 0, glow: null, zone: 0,
  materials: { floor: 'default', ceil: ceilMat, wall },
});
const line = (a: number, b: number, front: number, back = -1, walls?: { front?: Record<string, string> }) =>
  ({ v: [a, b] as [number, number], front, back, door: null, exit: false, ...(walls ? { walls } : {}) });

/** Room A (x 0..10, z 0..10, sector 0, ceil 4) whose south wall (z 0, x 0..10, facing +z) is a screen bank;
 *  a fluorescent-ceiling room C (sector 1, x 0..4, z 20..24, ceil 3) and room B (x 10.5..20, sector 2) behind A's east wall. */
function rooms(): SectorMap {
  return {
    vertices: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 20], [4, 20], [4, 24], [0, 24], [10.5, 0], [20, 0], [20, 10], [10.5, 10]],
    sectors: [sector(0, 4), sector(0, 3, 'default', 'fluorescent'), sector(0, 4)],
    lines: [
      // The front sector is on the LEFT of v0 -> v1 ((-dz, dx)): (0,0) -> (10,0) keeps A (z > 0) on it.
      line(0, 1, 0, -1, { front: { mid: 'screen-bank' } }), line(1, 2, 0), line(2, 3, 0), line(3, 0, 0),
      line(4, 5, 1), line(5, 6, 1), line(6, 7, 1), line(7, 4, 1),
      line(8, 9, 2), line(9, 10, 2), line(10, 11, 2), line(11, 8, 2),
    ],
  };
}

describe('emitterSurfaces', () => {
  const surfs = emitterSurfaces(rooms());
  const wall = surfs.find(s => s.role === 'wall')!;
  const ceil = surfs.find(s => s.role === 'ceil')!;
  it('finds the screen wall (area, inward normal, class) and the fluorescent ceiling (facing down)', () => {
    expect(surfs).toHaveLength(2);
    expect(wall).toMatchObject({ kind: 'screenBank', cls: 'screen', sector: 0 });
    expect(wall.area).toBeCloseTo(40, 6);
    expect(wall.normal[2]).toBeCloseTo(1, 9);
    expect(ceil).toMatchObject({ kind: 'fluorescent', cls: 'fluoro', sector: 1, normal: [0, -1, 0] });
    expect(ceil.area).toBeCloseTo(16, 6);
  });
  it('patches are at most EMIT_PATCH_M and cover the surface', () => {
    expect(wall.patches.length).toBe(Math.ceil(10 / EMIT_PATCH_M) * Math.ceil(4 / EMIT_PATCH_M));
    expect(wall.patches.reduce((a, p) => a + p.area, 0)).toBeCloseTo(40, 6);
    expect(ceil.patches.reduce((a, p) => a + p.area, 0)).toBeCloseTo(16, 6);
  });
  it('the mean colour is the shader\'s cells averaged (emitter-layout screenCellMean) times the sector factor', () => {
    let g = 0, n = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 10; i++) { g += screenCellMean(Math.round(wall.seed / 0.25) + i, j, 0)[1]; n++; }
    expect(wall.factor).toBe(1);                                             // a full-bright sector
    expect(wall.colour[1]).toBeCloseTo(g / n, 9);
    expect(wall.colour[1]).toBeGreaterThan(wall.colour[2]);
  });
  it('a dark sector dims its emitters only down to the kind\'s floor', () => {
    const m = rooms();
    m.sectors[0] = sector(0, 4, 'default', 'default', 0);
    const dark = emitterSurfaces(m).find(s => s.role === 'wall')!;
    expect(dark.factor).toBe(0.75);
  });
  it('none with emitters off', () => { expect(emitterSurfaces(rooms(), false)).toEqual([]); });
});

describe('createEmitterBounce', () => {
  const b = createEmitterBounce(emitterSurfaces(rooms()));
  const at = (p: [number, number, number], n: [number, number, number]): EmitBake => [...b.at(p, n, [n[0], n[2]])];
  it('the wall facing the screens (inside the cutoff) goes green, nearer brighter; the screen wall itself gets none', () => {
    const far = at([5, 2, 7.5], [0, 0, -1]), mid = at([5, 2, 5], [0, 0, -1]);
    expect(far[1]).toBeGreaterThan(0);
    expect(far[1]).toBeGreaterThan(far[2]);
    expect(at([5, 2, 3], [0, 0, -1])[1]).toBeGreaterThan(mid[1]);
    expect(at([3, 2, 0], [0, 0, 1])[1]).toBe(0);
  });
  it('the floor in front of the screens catches them, the floor at their very foot does not', () => {
    expect(at([5, 0, 1.5], [0, 1, 0])[1]).toBeGreaterThan(0);
    expect(at([5, 0, 0], [0, 1, 0])[1]).toBe(0);
  });
  it('the fluorescent ceiling lights its floor (fluoro channel only) and nothing above it', () => {
    const f = at([2, 0, 22], [0, 1, 0]);
    expect(f[3]).toBeGreaterThan(0.05 * EMIT_CLASS_BAKE.fluoro);
    expect(f[0] + f[1] + f[2] + f[4]).toBe(0);
  });
  it('nothing through a solid wall, nothing behind the emitter, nothing past the cutoff', () => {
    expect(at([12, 2, 5], [-1, 0, 0])).toEqual([0, 0, 0, 0, 0]);             // room B, behind A's east wall
    expect(at([5, 2, -0.5], [0, 0, -1])).toEqual([0, 0, 0, 0, 0]);           // behind the screen wall
    expect(emitFade(EMIT_CUTOFF_M)).toBe(0);
    expect(emitFade(0)).toBe(1);
  });
  it('signs bake into their own scalar of SIGN_RGB', () => {
    const m = rooms();
    m.lines[0] = line(0, 1, 0, -1, { front: { mid: 'exit-sign' } });
    const e = createEmitterBounce(emitterSurfaces(m)).at([5, 2, 4], [0, 0, -1], [0, -1]);
    expect(e[4]).toBeGreaterThan(0);
    expect(e[0] + e[1] + e[2] + e[3]).toBe(0);
    expect(SIGN_RGB[0]).toBeGreaterThan(SIGN_RGB[1]);
  });
});
