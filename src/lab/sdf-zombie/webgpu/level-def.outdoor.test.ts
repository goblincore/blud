// src/lab/sdf-zombie/webgpu/level-def.outdoor.test.ts
//
// Outdoor v1 §5: an edged open room draws its walls only to the edge height while
// its colliders still reach full height; paths and grounds are tagged; the body
// enclosure's top face is the sky's ambient in an open room.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPEN_SKY_CEILING_M, enclosureOfIn, layoutColliders, layoutSurfaces, roomCeilingM } from './level-def';
import { parseLevelJson } from './level-json';
import { SKY_PRESETS } from './outdoor-presets';

const L = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/fixtures/open-sky.level.json', 'utf8')));
const S = layoutSurfaces(L);
const yard = L.rooms[0]!, hall = L.rooms[1]!;
const inRect = (p: { min: readonly number[]; max: readonly number[] }, r: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  p.min[0]! >= r.minX - 1e-6 && p.max[0]! <= r.maxX + 1e-6 && p.min[2]! >= r.minZ - 1e-6 && p.max[2]! <= r.maxZ + 1e-6;

describe('layoutSurfaces: outdoor', () => {
  it('an edged room: walls stop at the edge and are tagged with its style; no ceiling', () => {
    const walls = S.planes.filter(p => p.axis !== 1 && inRect(p, yard));
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) {
      expect(w.max[1]).toBeLessThanOrEqual(2.2 + 1e-9);
      expect(w.surface).toBe('edge:wall');
    }
    expect(S.planes.some(p => p.axis === 1 && p.facing < 0 && inRect(p, yard))).toBe(false);
  });

  it('colliders still reach the full room height', () => {
    const tall = layoutColliders(L).filter(b => b.max[1] >= 6 - 1e-9 && b.min[0] <= 0 && b.max[0] >= -0.3 + 1e-9);
    expect(tall.length).toBeGreaterThan(0);
  });

  it('floors carry their ground; paths are lifted strips of theirs', () => {
    const floors = S.planes.filter(p => p.axis === 1 && p.facing > 0);
    expect(floors.find(p => inRect(p, yard) && p.surface === 'ground:grass')).toBeTruthy();
    expect(floors.find(p => inRect(p, hall) && p.surface === 'ground:flagstone')).toBeTruthy();
    const path = floors.find(p => p.surface === 'path:gravel')!;
    expect(path.min).toEqual([5, 0.005, 0]);
    expect(path.max).toEqual([7, 0.005, 10]);
  });

  it('a closed room keeps plain walls to full height and a ceiling', () => {
    const walls = S.planes.filter(p => p.axis !== 1 && inRect(p, hall));
    expect(walls.every(w => w.surface === 'wall')).toBe(true);
    expect(Math.max(...walls.map(w => w.max[1]!))).toBeCloseTo(3, 9);
    expect(S.planes.some(p => p.axis === 1 && p.facing < 0 && inRect(p, hall) && p.surface === 'ceiling')).toBe(true);
  });

  it('the doorway between them draws no lintel above the lower edge side', () => {
    // tunnel 2.6 m; display top = max(edge 2.2, hall 3) = 3 -> a 0.4 m lintel, not 6 m
    const lintels = S.boxes.filter(b => b.min[0] >= 12 - 1e-9 && b.max[0] <= 12.6 + 1e-9);
    expect(lintels).toHaveLength(1);
    expect(lintels[0]!.max[1]).toBeCloseTo(3, 9);
  });

  it('reports the skyline and the level bounds for it', () => {
    expect(S.skyline).toEqual({ preset: 'treeline', min: [0, 0], max: [20.6, 10] });
  });
});

describe('sky enclosure and ceiling', () => {
  it('the body enclosure top of an open room is the sky ambient', () => {
    expect(enclosureOfIn(L, 'yard')!.walls.posY).toEqual(SKY_PRESETS.night.ambient);
  });
  it('an open room has a high ceiling for thrown things; a closed one its height', () => {
    expect(roomCeilingM(yard)).toBe(6 + OPEN_SKY_CEILING_M);
    expect(roomCeilingM(hall)).toBe(3);
  });
});
