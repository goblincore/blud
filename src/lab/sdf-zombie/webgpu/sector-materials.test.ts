// src/lab/sdf-zombie/webgpu/sector-materials.test.ts
import { describe, expect, it } from 'vitest';
import { emittersOn, FAMILY_KINDS, isStone, lineSeedTiles, sectorMaterialsOn, surfaceKind, SURFACE_LOOKS, wallFit, wallU } from './sector-materials';

describe('surfaceKind', () => {
  it('maps the converter families to their panel kinds', () => {
    expect(surfaceKind('tech', 'wall')).toBe('techPanel');
    expect(surfaceKind('rust', 'wall')).toBe('rustBrick');
    expect(surfaceKind('door', 'wall')).toBe('door');
    expect(surfaceKind('light-panel', 'ceil')).toBe('lightPanel');
    expect(surfaceKind('metal-plate', 'floor')).toBe('metalPlate');
    expect(surfaceKind('tile', 'floor')).toBe('floorTile');
    expect(surfaceKind('concrete', 'ceil')).toBe('concreteSlab');
    expect(surfaceKind('metal', 'wall')).toBe('metalSheet');
  });
  it('unknown families, default and glow names keep the stone of their role', () => {
    expect(surfaceKind('default', 'wall')).toBe('stoneWall');
    expect(surfaceKind('nukage', 'floor')).toBe('stoneFloor');
    expect(surfaceKind('marble', 'ceil')).toBe('stoneCeil');
  });
  it('off (?sectormat=0) is the old stone set whatever the family', () => {
    expect(surfaceKind('tech', 'wall', false)).toBe('stoneWall');
    expect(surfaceKind('tile', 'floor', false)).toBe('stoneFloor');
    expect(sectorMaterialsOn(new URLSearchParams('sectormat=0'))).toBe(false);
    expect(sectorMaterialsOn(new URLSearchParams(''))).toBe(true);
  });
  it('every kind has a look; stone keeps the 2 m tile and no glow, only the light panel glows', () => {
    for (const k of Object.values(FAMILY_KINDS)) expect(SURFACE_LOOKS[k].glow > 0).toBe(k === 'lightPanel');
    for (const k of Object.values(FAMILY_KINDS)) expect(SURFACE_LOOKS[k].emit !== undefined).toBe(['screenBank', 'viewscreen', 'fluorescent', 'exitSign'].includes(k));
    for (const k of ['stoneWall', 'stoneFloor', 'stoneCeil'] as const) {
      expect(isStone(k)).toBe(true);
      expect(SURFACE_LOOKS[k]).toMatchObject({ tileM: 2, gain: 1, glow: 0 });
    }
  });
});

describe('wallU', () => {
  it('a door stretches to whole tiles along its whole line, pieces included', () => {
    // A 4.4 m door cut into two pieces: one tile across, continuous at the cut.
    expect(wallU('door', [0, 0], [0, 2.2, 4.4], 1, 0, 2.2, 4)).toEqual([0, 0.5]);
    expect(wallU('door', [2.2, 0], [2.2, 4.4, 4.4], 1, 0, 2.2, 4)).toEqual([0.5, 1]);
  });
  it('a narrow door keeps the natural scale (no squashed 4 m tile)', () => {
    const [u0, u1] = wallU('door', [0, 0], [0, 1.5, 1.5], 1, 0, 1.5, 4);
    expect(u0).toBe(0);
    expect(u1).toBeCloseTo(1.5 / 4, 9);
  });
  it('other kinds project world position, so split pieces tile on', () => {
    const [a0, a1] = wallU('techPanel', [2, 0], [2, 4, 8], 2, 0, 2, 4);   // dx, dz: b - a (unnormalised)
    expect([a0, a1]).toEqual([0.5, 1]);
  });
});

describe('emitter families', () => {
  it('map to the emitter kinds, and ?emitters=0 to the kinds they had before', () => {
    expect(surfaceKind('screen-bank', 'wall')).toBe('screenBank');
    expect(surfaceKind('viewscreen', 'wall')).toBe('viewscreen');
    expect(surfaceKind('fluorescent', 'ceil')).toBe('fluorescent');
    expect(surfaceKind('exit-sign', 'wall')).toBe('exitSign');
    expect(surfaceKind('screen-bank', 'wall', true, false)).toBe('techPanel');
    expect(surfaceKind('viewscreen', 'wall', true, false)).toBe('techPanel');
    expect(surfaceKind('fluorescent', 'ceil', true, false)).toBe('lightPanel');
    expect(surfaceKind('exit-sign', 'wall', true, false)).toBe('door');
    expect(surfaceKind('tech', 'wall', true, false)).toBe('techPanel');
    expect(surfaceKind('screen-bank', 'wall', false, false)).toBe('stoneWall');
    expect(emittersOn(new URLSearchParams('emitters=0'))).toBe(false);
    expect(emittersOn(new URLSearchParams(''))).toBe(true);
  });
  it('emitter floors are high (a powered screen stays lit in a dark room); roughness scalar stays 1', () => {
    for (const k of ['screenBank', 'viewscreen', 'fluorescent', 'exitSign'] as const) {
      expect(SURFACE_LOOKS[k].emit!.floor).toBeGreaterThanOrEqual(0.5);
      expect(SURFACE_LOOKS[k].roughness).toBe(1);
    }
  });
});

describe('wallFit', () => {
  const sb = SURFACE_LOOKS.screenBank.fit!;
  it('stretches a line to whole cells from its start, continuous across split pieces', () => {
    // An 8.4 m line of 1 m screens: 8 cells, 0.25 tile each -> u 0..2 tiles.
    expect(wallFit(sb, 0, 8.4, 1, 1, 2.75)[0]).toBe(0);
    expect(wallFit(sb, 8.4, 8.4, 1, 1, 2.75)[0]).toBeCloseTo(2, 9);
    expect(wallFit(sb, 4.2, 8.4, 1, 1, 2.75)[0]).toBeCloseTo(1, 9);
  });
  it('fits the quad height to whole cells from its bottom', () => {
    // 1.75 m console: round(1.75) = 2 cells -> v 0..0.5 tile.
    expect(wallFit(sb, 0, 4, 1, 1, 2.75)[1]).toBe(0);
    expect(wallFit(sb, 0, 4, 2.75, 1, 2.75)[1]).toBeCloseTo(0.5, 9);
    // The exit sign: one sign per 0.5 m quad, the whole tile.
    const ex = SURFACE_LOOKS.exitSign.fit!;
    expect(wallFit(ex, 1, 1, 2.25, 1.75, 2.25)).toEqual([1, 1]);
    // A fluorescent strip 2.25 m tall: one 2 m troffer stretched to the quad.
    expect(wallFit(SURFACE_LOOKS.fluorescent.fit!, 0, 2, 2.25, 0, 2.25)[1]).toBeCloseTo(0.5, 9);
  });
  it('a line under half a cell keeps the natural scale; the seed offset is whole tiles', () => {
    const ex = SURFACE_LOOKS.exitSign.fit!;
    expect(wallFit(ex, 0.25, 0.25, 2, 1.75, 2.25)[0]).toBeCloseTo(0.25, 9);
    expect(wallFit(sb, 4.2, 8.4, 1, 1, 2.75, 7)[0]).toBeCloseTo(8, 9);
    const k = lineSeedTiles(17.25, -43.5);
    expect(Number.isInteger(k) && k >= 0 && k < 61).toBe(true);
    expect(lineSeedTiles(17.25, -43.5)).toBe(k);
    expect(new Set([[0, 0], [8, 0], [0, 8], [17, -43], [47, -41]].map(([x, z]) => lineSeedTiles(x!, z!))).size).toBeGreaterThan(3);
  });
});
