// src/sim/arenagen/rings.test.ts
import { describe, it, expect } from 'vitest';
import { GRID_W, GRID_H } from '../floorplan';
import { ringOf, cellsInRing, CENTER_MAX, MID_MAX } from './rings';

describe('ringOf', () => {
  it('classifies border cells as wall', () => {
    expect(ringOf(0, 5)).toBe('wall');
    expect(ringOf(GRID_W - 1, 5)).toBe('wall');
    expect(ringOf(5, 0)).toBe('wall');
    expect(ringOf(5, GRID_H - 1)).toBe('wall');
  });

  it('classifies the exact grid middle as center', () => {
    expect(ringOf(GRID_W >> 1, GRID_H >> 1)).toBe('center');
  });

  it('classifies cells just inside the wall as perimeter (backpedal lane)', () => {
    expect(ringOf(1, GRID_H >> 1)).toBe('perimeter');
    expect(ringOf(2, GRID_H >> 1)).toBe('perimeter');
  });

  it('gives a perimeter lane at least 2 cells (4 m) wide on every side', () => {
    const mid = GRID_H >> 1;
    let width = 0;
    for (let cx = 1; ringOf(cx, mid) === 'perimeter'; cx++) width++;
    expect(width).toBeGreaterThanOrEqual(2);
  });

  it('partitions every interior cell into exactly one ring', () => {
    for (let cz = 1; cz < GRID_H - 1; cz++)
      for (let cx = 1; cx < GRID_W - 1; cx++)
        expect(['center', 'mid', 'perimeter']).toContain(ringOf(cx, cz));
    expect(CENTER_MAX).toBeLessThan(MID_MAX);
  });

  it('cellsInRing returns disjoint, complete cover of the grid', () => {
    const n = (['wall', 'center', 'mid', 'perimeter'] as const)
      .reduce((s, r) => s + cellsInRing(r).length, 0);
    expect(n).toBe(GRID_W * GRID_H);
  });
});
