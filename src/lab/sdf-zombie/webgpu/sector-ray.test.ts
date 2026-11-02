// src/lab/sdf-zombie/webgpu/sector-ray.test.ts
//
// sectorSegmentHit against the committed sectors fixture: A (x −4..4, z −8..0, floor 0, ceil 4,
// with the column hole x −1..1, z −5..−3), B (z −8..−12, floor 0.5), C (z −12..−16, floor 1.5),
// D (x 4..8, z −8..0, floor −1, sky ceiling).

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { sectorSegmentHit, type SectorHit } from './sector-ray';

const map = parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;
const ground = buildSectorGround(map);
type P = [number, number, number];
const hit = (a: P, b: P) => sectorSegmentHit(map, ground, a, b);
const expectHit = (h: SectorHit | null, kind: SectorHit['kind'], t: number, point: P) => {
  expect(h).not.toBeNull();
  expect(h!.kind).toBe(kind);
  expect(h!.t).toBeCloseTo(t, 9);
  for (let k = 0; k < 3; k++) expect(h!.point[k]).toBeCloseTo(point[k]!, 9);
};

describe('sectorSegmentHit: walls', () => {
  it('stops at A\'s north wall', () => {
    const h = hit([0, 1, -1], [0, 1, 1]);
    expectHit(h, 'wall', 0.5, [0, 1, 0]);
    expect(h!.line).toBe(0);
    expect(h!.sector).toBe(0);
  });
  it('hits the A→B riser below B\'s floor, passes over it', () => {
    expectHit(hit([0, 0.25, -7], [0, 0.25, -9]), 'wall', 0.5, [0, 0.25, -8]);
    expect(hit([0, 0.75, -7], [0, 0.75, -9])).toBeNull();
  });
  it('hits the B→C riser below C\'s floor, passes over it', () => {
    expectHit(hit([0, 1, -11], [0, 1, -13]), 'wall', 0.5, [0, 1, -12]);
    expect(hit([0, 1.8, -11], [0, 1.8, -13])).toBeNull();
  });
  it('hits the column face', () => {
    const h = hit([0, 1, -1.5], [0, 1, -6]);
    expectHit(h, 'wall', 1 / 3, [0, 1, -3]);
    expect(h!.line).toBe(4);
  });
  it('a drop into D is open; D→A below A\'s floor is the riser', () => {
    expect(hit([6, 1, -4], [2, 1, -4])).toBeNull();
    expectHit(hit([6, -0.5, -4], [2, -0.5, -4]), 'wall', 0.5, [4, -0.5, -4]);
  });
});

describe('sectorSegmentHit: floors and ceilings', () => {
  it('hits A\'s floor and ceiling', () => {
    expectHit(hit([0, 1, -1], [0, -1, -1]), 'floor', 0.5, [0, 0, -1]);
    expectHit(hit([0, 1, -1], [0, 5, -1]), 'ceil', 0.75, [0, 4, -1]);
  });
  it('ending exactly on the floor is not a hit', () => {
    expect(hit([0, 1, -1], [0, 0, -1])).toBeNull();
  });
  it('uses the neighbour\'s floor after crossing into a lower sector', () => {
    // Crosses x = 4 at t 0.1, y 0.4 (over A's floor 0), then meets D's floor −1 at t 0.75, x 5.3 —
    // not A's floor 0 (t 0.25, x 4.3).
    const h = hit([3.8, 0.5, -4], [5.8, -1.5, -4]);
    expectHit(h, 'floor', 0.75, [5.3, -1, -4]);
    expect(h!.sector).toBe(3);
  });
  it('the sky over D is open; walls still stand above it', () => {
    expect(hit([6, 1, -4], [6, 10, -4])).toBeNull();
    expectHit(hit([6, 5, -4], [10, 5, -4]), 'wall', 0.5, [8, 5, -4]);   // D's one-sided east wall
    expectHit(hit([6, 5, -4], [2, 5, -4]), 'wall', 0.5, [4, 5, -4]);    // A's ceiling is not sky: the upper part
  });
});

describe('sectorSegmentHit: open space and edge cases', () => {
  it('a segment wholly in open space returns null', () => {
    expect(hit([-2, 1, -1], [2, 2, -2])).toBeNull();
    expect(hit([-3, 1, -1], [-3, 2, -11])).toBeNull();   // A into B over the riser, west of the column
  });
  it('a start outside every sector (the void, the column) is a wall hit at t 0', () => {
    expectHit(hit([20, 1, 20], [0, 1, -1]), 'wall', 0, [20, 1, 20]);
    const h = hit([0, 1, -4], [0, 1, -1]);
    expectHit(h, 'wall', 0, [0, 1, -4]);
    expect(h!.sector).toBe(-1);
    expect(h!.line).toBe(-1);
  });
  it('a start under the floor or over a solid ceiling is a hit at t 0', () => {
    expectHit(hit([0, -0.5, -1], [0, 1, -1]), 'floor', 0, [0, -0.5, -1]);
    expectHit(hit([0, 4.5, -1], [0, 1, -1]), 'ceil', 0, [0, 4.5, -1]);
  });
  it('through a vertex: D→B diagonally through (4, −8)', () => {
    expect(hit([5, 1, -7], [3, 1, -9])).toBeNull();
    expectHit(hit([5, 0.25, -7], [3, 0.25, -9]), 'wall', 0.5, [4, 0.25, -8]);   // under B's floor
  });
  it('through a vertex into the void is a wall', () => {
    expectHit(hit([3, 1, -7], [5, 1, -9]), 'wall', 0.5, [4, 1, -8]);
  });
  it('grazing the column\'s corner passes; aiming into it hits', () => {
    expect(hit([0, 1, -2], [2, 1, -4])).toBeNull();
    expectHit(hit([2, 1, -2], [0, 1, -4]), 'wall', 0.5, [1, 1, -3]);
  });
  it('a zero-length segment: null in open space, a t 0 hit in solid', () => {
    expect(hit([0, 1, -1], [0, 1, -1])).toBeNull();
    expectHit(hit([0, 1, -4], [0, 1, -4]), 'wall', 0, [0, 1, -4]);
    expectHit(hit([0, -0.5, -1], [0, -0.5, -1]), 'floor', 0, [0, -0.5, -1]);
  });
  it('fills and returns the out record without allocating one', () => {
    const out: SectorHit = { t: 0, point: [0, 0, 0], kind: 'wall', line: -1, sector: -1 };
    const pt = out.point;
    const h = sectorSegmentHit(map, ground, [0, 1, -1], [0, 1, 1], out);
    expect(h).toBe(out);
    expect(h!.point).toBe(pt);
    expect(h!.t).toBeCloseTo(0.5, 9);
    expect(sectorSegmentHit(map, ground, [0, 1, -1], [0, 1, -2], out)).toBeNull();
  });
});
