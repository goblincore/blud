// src/lab/sdf-zombie/webgpu/sector-ground.test.ts
//
// Spec §6.1–§6.2 against the committed sectors fixture (see the plan's diagram).

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import type { WallSeg } from './level-ground';

const map = () => parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;

describe('buildSectorGround: lookup', () => {
  const g = buildSectorGround(map());
  it('finds the sector under a point', () => {
    expect(g.sectorAt(0, -1)).toBe(0);
    expect(g.sectorAt(-3, -7)).toBe(0);
    expect(g.sectorAt(0, -10)).toBe(1);
    expect(g.sectorAt(0, -14)).toBe(2);
    expect(g.sectorAt(6, -4)).toBe(3);
  });
  it('says -1 in the column hole and outside the map', () => {
    expect(g.sectorAt(0, -4)).toBe(-1);
    expect(g.sectorAt(20, 20)).toBe(-1);
    expect(g.sectorAt(6, -12)).toBe(-1);
  });
  it('gives floors and ceilings, NaN outside', () => {
    expect([g.floorAt(0, -1), g.floorAt(0, -10), g.floorAt(0, -14), g.floorAt(6, -4)]).toEqual([0, 0.5, 1.5, -1]);
    expect(g.ceilAt(0, -10)).toBe(4);
    expect(g.floorAt(0, -4)).toBeNaN();
  });
});

describe('buildSectorGround: blocking lines', () => {
  it('one-sided walls always block', () => {
    const segs = buildSectorGround(map()).blockingNear(0, -2.8, 0.5, 0);   // the column's near face is z = -3
    expect(segs.some(s => s.az === -3 && s.bz === -3)).toBe(true);
  });
  // Pick lines by both ends: x = 4 also holds B's east wall (2-4), z = -8 also D's south wall (9-2).
  const ab = (s: WallSeg) => s.az === -8 && s.bz === -8 && Math.min(s.ax, s.bx) === -4;   // line 2-3
  const bc = (s: WallSeg) => s.az === -12 && s.bz === -12 && Math.min(s.ax, s.bx) === -4; // line 4-5
  const ad = (s: WallSeg) => s.ax === 4 && s.bx === 4 && Math.max(s.az, s.bz) === 0;      // line 1-2
  it('a 0.5 m step does not block; a 1.0 m step does; a drop does not', () => {
    const g = buildSectorGround(map());
    expect(g.blockingNear(0, -7.9, 0.5, 0).some(ab)).toBe(false);          // A -> B
    expect(g.blockingNear(0, -11.9, 0.5, 0.5).some(bc)).toBe(true);        // B -> C
    expect(g.blockingNear(3.9, -4, 0.5, 0).some(ad)).toBe(false);          // A -> D (down)
    expect(g.blockingNear(4.1, -4, 0.5, -1).some(ad)).toBe(true);          // D -> A (1 m up)
  });
  it('an opening under 1.9 m blocks', () => {
    const m = map();
    m.sectors[1]!.ceil = 2.3;                                               // opening min(4, 2.3) - max(0, 0.5) = 1.8
    expect(buildSectorGround(m).blockingNear(0, -7.9, 0.5, 0).some(ab)).toBe(true);
  });
  it('only returns lines near the point', () => {
    const segs = buildSectorGround(map()).blockingNear(-2, -1, 0.5, 0);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.length).toBeLessThan(17);
  });
});
