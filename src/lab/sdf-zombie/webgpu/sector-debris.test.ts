// src/lab/sdf-zombie/webgpu/sector-debris.test.ts — the sector debris ground on the committed sectors fixture
// (A floor 0 with the column hole x −1..1 z −5..−3; B z −8..−12 floor 0.5; C z −12..−16 floor 1.5; D x 4..8 floor −1).
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { sectorDebrisGround, WALL_SKIN_M } from './sector-debris';
import { landingFloor } from '../debris-ground';
import type { Vec3 } from '../types';

const map = parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;
const g = sectorDebrisGround(map, buildSectorGround(map));

describe('sectorDebrisGround: floors', () => {
  it('reads the sector floor under a point, NaN in the column', () => {
    expect(g.floorAt(0, -2)).toBe(0);
    expect(g.floorAt(0, -10)).toBe(0.5);
    expect(g.floorAt(0, -14)).toBe(1.5);
    expect(g.floorAt(6, -4)).toBe(-1);
    expect(Number.isNaN(g.floorAt(0, -4))).toBe(true);
  });
  it('landingFloor keeps the last floor off the map', () => {
    expect(landingFloor(g, 0, -4, 0.25)).toBe(0.25);
    expect(landingFloor(g, 0, -10, 0.25)).toBe(0.5);
  });
  it('is cached per map', () => {
    expect(sectorDebrisGround(map, buildSectorGround(map))).toBe(g);
  });
});

describe('sectorDebrisGround: walls', () => {
  it('a piece low in A sliding into the 0.5 m riser stops 1 cm short and reflects', () => {
    const b = g.bounce([1, 0.2, -7.5], [1, 0.2, -8.5], [0.4, 0, -3], 0.5, 0.7)!;
    expect(b).not.toBeNull();
    expect(b.pos[2]).toBeCloseTo(-8 + WALL_SKIN_M, 9);
    expect(b.normal[2]).toBeCloseTo(1, 9);                         // back toward A (+z)
    expect(b.vel[2]).toBeCloseTo(1.5, 9);                          // −(−3) × 0.5
    expect(b.vel[0]).toBeCloseTo(0.28, 9);                         // tangential × 0.7
  });
  it('above the step it passes onto B', () => {
    expect(g.bounce([1, 0.7, -7.5], [1, 0.7, -8.5], [0, 0, -3], 0.5, 0.7)).toBeNull();
  });
  it('off the C ledge toward B is open (it falls)', () => {
    expect(g.bounce([0, 1.6, -12.4], [0, 1.6, -11.6], [0, 0, 2], 0.5, 0.7)).toBeNull();
  });
  it('the column face stops it; a fast piece cannot tunnel the north wall', () => {
    const c = g.bounce([0, 0.2, -2], [0, 0.2, -4], [0, 0, -20], 0.5, 0.7)!;
    expect(c.pos[2]).toBeCloseTo(-3 + WALL_SKIN_M, 9);
    const w = g.bounce([0, 1, -0.5], [0, 1, 3.5], [0, 0, 240], 0.5, 0.7)!;   // 4 m in one step
    expect(w.pos[2]).toBeCloseTo(-WALL_SKIN_M, 9);
    expect(w.normal[2]).toBeCloseTo(-1, 9);
  });
  it('a start off the map or a stationary piece is not judged', () => {
    expect(g.bounce([0, 0.2, -4], [0, 0.2, -6], [0, 0, -3], 0.5, 0.7)).toBeNull();
    const p: Vec3 = [1, 0.2, -7];
    expect(g.bounce(p, [1, 0.1, -7], [0, -1, 0], 0.5, 0.7)).toBeNull();
  });
});
