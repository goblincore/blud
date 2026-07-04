import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H, bakeSimGeometry, floorplanFingerprint } from '../floorplan';
import { cellsInRing } from './rings';
import { maxRunAt, MAX_WALL_RUN } from './cover';
import { generateArena, MAX_ATTEMPTS } from './index';
import { themeIds, DEFAULT_THEME } from './themes';

describe('generateArena — determinism', () => {
  it('same seed → identical plan (grid, cover, pockets, spawns, start)', () => {
    const a = generateArena(2026), b = generateArena(2026);
    expect(Array.from(a.open)).toEqual(Array.from(b.open));
    expect(a.cover).toEqual(b.cover);
    expect(a.pockets).toEqual(b.pockets);
    expect(a.spawns).toEqual(b.spawns);
    expect(a.start).toEqual(b.start);
    expect(a.attempt).toBe(b.attempt);
  });

  it('is Floorplan-compatible: fingerprint + sim geometry bake work unchanged', () => {
    const plan = generateArena(42);
    expect(floorplanFingerprint(plan)).toBe(floorplanFingerprint(generateArena(42)));
    expect(bakeSimGeometry(plan).length).toBeGreaterThan(0);
  });
});

describe('generateArena — 100-seed hard-constraint sweep', () => {
  it('holds every structural guarantee on every seed', () => {
    let passes = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const p = generateArena(seed);
      // Backpedal lane: every perimeter cell open (cover never placed there).
      for (const c of cellsInRing('perimeter'))
        expect(p.open[c.cz * GRID_W + c.cx]).toBe(1);
      // Tall-wall ban.
      for (let cz = 1; cz < GRID_H - 1; cz++)
        for (let cx = 1; cx < GRID_W - 1; cx++)
          if (p.open[cz * GRID_W + cx] === 0)
            expect(maxRunAt(p.open, cx, cz)).toBeLessThanOrEqual(MAX_WALL_RUN);
      // Pockets recorded and open; ≥2 on passing plans.
      for (const pk of p.pockets)
        for (const c of pk.cells) expect(p.open[c.cz * GRID_W + c.cx]).toBe(1);
      // Mid cap; center clean.
      expect(p.cover.filter((q) => q.height === 'mid').length).toBeLessThanOrEqual(4);
      expect(p.grade.centerClean).toBe(true);
      expect(p.attempt).toBeLessThan(MAX_ATTEMPTS);
      expect(p.spawns.length).toBeGreaterThanOrEqual(6);
      if (p.grade.pass) passes++;
    }
    // Retry loop should rescue most seeds; fallback-to-best is the exception.
    expect(passes).toBeGreaterThanOrEqual(85);
  });
});

describe('generateArena — theme × seed independence', () => {
  it('geometry is identical across every theme for the same seed', () => {
    const base = generateArena(2026, DEFAULT_THEME);
    for (const id of themeIds()) {
      const p = generateArena(2026, id);
      expect(Array.from(p.open)).toEqual(Array.from(base.open));
      expect(p.cover).toEqual(base.cover);
      expect(p.pockets).toEqual(base.pockets);
      expect(p.spawns).toEqual(base.spawns);
      expect(p.themeId).toBe(id);
    }
  });

  it('scatters props on open floor per theme density, deterministically', () => {
    const a = generateArena(7, DEFAULT_THEME), b = generateArena(7, DEFAULT_THEME);
    expect(a.props).toEqual(b.props);
    expect(a.props.length).toBeGreaterThan(0);
    for (const pr of a.props)
      expect(a.open[pr.cell.cz * a.gridW + pr.cell.cx]).toBe(1);
  });
});
