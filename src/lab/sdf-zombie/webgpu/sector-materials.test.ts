// src/lab/sdf-zombie/webgpu/sector-materials.test.ts
import { describe, expect, it } from 'vitest';
import { FAMILY_KINDS, isStone, sectorMaterialsOn, surfaceKind, SURFACE_LOOKS } from './sector-materials';

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
    for (const k of ['stoneWall', 'stoneFloor', 'stoneCeil'] as const) {
      expect(isStone(k)).toBe(true);
      expect(SURFACE_LOOKS[k]).toMatchObject({ tileM: 2, gain: 1, glow: 0 });
    }
  });
});
