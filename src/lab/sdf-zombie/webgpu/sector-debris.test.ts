// src/lab/sdf-zombie/webgpu/sector-debris.test.ts — the sector debris ground on the committed sectors fixture
// (A floor 0 with the column hole x −1..1 z −5..−3; B z −8..−12 floor 0.5; C z −12..−16 floor 1.5; D x 4..8 floor −1).
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { clampSpawnInsideMap, seatBurstInsideMap, seatSpawnInsideMap, sectorDebrisGround, WALL_SKIN_M } from './sector-debris';
import { burstVolume, createBloodSim } from '../blood-sim';
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

describe('sectorDebrisGround: review fixes', () => {
  it('a piece above its ceiling or below its floor still meets the walls', () => {
    // Above A's 4 m ceiling, sliding into A's north wall: probed at the ceiling, still a wall.
    const up = g.bounce([0, 4.5, -0.5], [0, 4.5, 0.5], [0, 0, 60], 0.5, 0.7)!;
    expect(up).not.toBeNull();
    expect(up.pos[2]).toBeCloseTo(-WALL_SKIN_M, 9);
    // Sunk under B's 0.5 m floor, sliding into the 1.5 m riser to C: probed at B's floor, still a wall.
    const down = g.bounce([0, 0.3, -11.5], [0, 0.3, -12.5], [0, 0, -3], 0.5, 0.7)!;
    expect(down).not.toBeNull();
    expect(down.pos[2]).toBeCloseTo(-12 + WALL_SKIN_M, 9);
  });
  it('a radius stops the centre that far from the wall, and catches a leading edge the centre never crossed', () => {
    const r = g.bounce([1, 0.2, -7.5], [1, 0.2, -8.5], [0, 0, -3], 0.5, 0.7, 0.1)!;
    expect(r.pos[2]).toBeCloseTo(-8 + 0.1, 9);
    const edge = g.bounce([1, 0.2, -7.5], [1, 0.2, -7.95], [0, 0, -3], 0.5, 0.7, 0.1)!;
    expect(edge).not.toBeNull();
    expect(edge.pos[2]).toBeCloseTo(-8 + 0.1, 9);
    expect(edge.vel[2]).toBeCloseTo(1.5, 9);
    expect(g.bounce([1, 0.2, -7.5], [1, 0.2, -7.95], [0, 0, -3], 0.5, 0.7)).toBeNull();   // radius 0: open
  });
  it('a slanted approach with a radius ends exactly radius off the line', () => {
    const r = g.bounce([1, 0.2, -7.5], [2, 0.2, -8.5], [2, 0, -2], 0.5, 1, 0.1)!;
    expect(r.pos[2]).toBeCloseTo(-8 + 0.1, 9);
    expect(r.pos[0]).toBeCloseTo(1.4, 9);                           // on the centre's path
    expect(r.vel[0]).toBeCloseTo(2, 9);
  });
  it('the normal comes from the side the piece is on (column faces, from outside)', () => {
    const n = g.bounce([0, 0.2, -5.5], [0, 0.2, -4.5], [0, 0, 3], 0.5, 0.7)!;   // the column's south face, z −5
    expect(n.normal[2]).toBeCloseTo(-1, 9);
    expect(n.pos[2]).toBeCloseTo(-5 - WALL_SKIN_M, 9);
    const e = g.bounce([1.5, 0.2, -4], [0.5, 0.2, -4], [-3, 0, 0], 0.5, 0.7)!;
    expect(e.normal[0]).toBeCloseTo(1, 9);
  });
  it('ceilAt: the sector ceiling, Infinity under sky, NaN off the map', () => {
    expect(g.ceilAt!(0, -2)).toBe(4);
    expect(g.ceilAt!(6, -4)).toBe(Infinity);
    expect(Number.isNaN(g.ceilAt!(0, -4))).toBe(true);
  });
});

describe('clampSpawnInsideMap: spawns start inside the level (plan 3b)', () => {
  const ground = buildSectorGround(map);
  it('a spawn point past the north wall is pulled back skin + radius toward the body', () => {
    const p = clampSpawnInsideMap(map, ground, [0, 1, -1], [0, 1, 0.3], 0.1);
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(1, 9);
    expect(p[2]).toBeCloseTo(-(WALL_SKIN_M + 0.1), 9);
  });
  it('a spawn point inside the column stops at its face', () => {
    const p = clampSpawnInsideMap(map, ground, [0, 1, -2], [0, 1, -3.5], 0);
    expect(p[2]).toBeCloseTo(-3 + WALL_SKIN_M, 9);
  });
  it('a spawn point under the floor is pulled back up toward the body', () => {
    const p = clampSpawnInsideMap(map, ground, [1, 1, -2], [1, -0.3, -2], 0.05);
    expect(p[1]).toBeCloseTo(WALL_SKIN_M + 0.05, 9);
  });
  it('an open spawn point is returned as is', () => {
    const to: Vec3 = [1, 1.2, -2.5];
    expect(clampSpawnInsideMap(map, ground, [1, 1, -2], to, 0.1)).toBe(to);
  });
  it('a hit closer than skin + radius puts the piece at the body centre', () => {
    const p = clampSpawnInsideMap(map, ground, [0, 1, -0.05], [0, 1, 0.5], 0.1);
    expect(p).toEqual([0, 1, -0.05]);
  });
  it('a body centre off the map (or out of its band) is not judged', () => {
    const to: Vec3 = [0, 1, -2];
    expect(clampSpawnInsideMap(map, ground, [0, 1, -4], to, 0.1)).toBe(to);
    expect(clampSpawnInsideMap(map, ground, [0, -1, -2], to, 0.1)).toBe(to);
  });
});

describe('seatSpawnInsideMap: a point spawn (blood) clamped inside with the body floor (plan 3b)', () => {
  const ground = buildSectorGround(map);
  it('a wound point past the north wall is pulled inside and keeps the body floor', () => {
    const s = seatSpawnInsideMap(map, ground, [0, 1, -1], [0, 1, 0.3], 0.02);
    expect(s.pos[2]).toBeCloseTo(-(WALL_SKIN_M + 0.02), 9);
    expect(Number.isFinite(ground.floorAt(s.pos[0], s.pos[2]))).toBe(true);
    expect(s.floorY).toBe(0);
  });
  it('the floor is the BODY floor, not the floor under the spawn (a limb over the B riser)', () => {
    const s = seatSpawnInsideMap(map, ground, [1, 0.9, -7.8], [1, 0.9, -8.2], 0.02);
    expect(s.floorY).toBe(0);
  });
  it('no body centre: the point unclamped, the floor under it (undefined off the map)', () => {
    const to: Vec3 = [0, 1, -10];
    expect(seatSpawnInsideMap(map, ground, null, to)).toEqual({ pos: to, floorY: 0.5 });
    expect(seatSpawnInsideMap(map, ground, null, [0, 1, -4]).floorY).toBeUndefined();
  });
});

describe('seatBurstInsideMap: a head-pop volume beside a wall starts on this side of it (plan 3b follow-up)', () => {
  const ground = buildSectorGround(map);
  const rng = (seed: number) => { let x = seed; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; }; };
  it('every drop of a 0.25 m burst 0.1 m from the north wall starts inside, on the body floor', () => {
    const head: Vec3 = [0, 1.6, -0.1];
    const plain = createBloodSim();
    burstVolume(plain, head, 0.25, [0, 0.5, 1.5], rng(2), 1);
    expect(plain.droplets.some((d) => d.pos[2] > 0)).toBe(true);        // unclamped, part of it is past the wall
    const s = seatBurstInsideMap(map, ground, [0, 0.9, -0.3], head, 0.02);
    const sim = createBloodSim();
    burstVolume(sim, s.pos, 0.25, [0, 0.5, 1.5], rng(2), 1, undefined, { floorY: s.floorY, clamp: s.clamp });
    expect(sim.droplets).toHaveLength(plain.droplets.length);
    for (const d of sim.droplets) {
      expect(d.pos[2]).toBeLessThan(0);                                   // on the room side of the wall
      expect(Number.isFinite(ground.floorAt(d.pos[0], d.pos[2]))).toBe(true);
      expect(d.floorY).toBe(0);
    }
  });
});

describe('sectorDebrisGround: a push-out never leaves the map or crosses a wall (review)', () => {
  // A 0.2 m corridor (sector 0, x 0..0.2, floor 0, one-sided west wall) beside a raised sector (1, x 0.2..2,
  // floor 1): narrower than a gun's 0.3 m radius, so pushing a centre out along either normal overshoots.
  const narrow = parseSectorLevel({
    version: 1, id: 'narrow', name: 'Narrow', geometry: 'sectors', ammo: 'infinite', loadout: ['melee'],
    vertices: [[0, 0], [0.2, 0], [0.2, -4], [0, -4], [2, 0], [2, -4]],
    sectors: [{ floor: 0, ceil: 3, light: 0.6, zone: 0 }, { floor: 1, ceil: 3, light: 0.6, zone: 0 }],
    lines: [
      { v: [1, 0], front: 0 }, { v: [2, 1], front: 0, back: 1 }, { v: [3, 2], front: 0 }, { v: [0, 3], front: 0 },
      { v: [4, 1], front: 1 }, { v: [5, 4], front: 1 }, { v: [2, 5], front: 1 },
    ],
    start: { pos: [0.1, 0, -2], yaw: 0 },
  }).sectors!;
  const ng = buildSectorGround(narrow);
  const n = sectorDebrisGround(narrow, ng);
  it('a push across the riser into the raised sector falls back to the start point', () => {
    const b = n.bounce([0.05, 0.2, -2], [-0.02, 0.2, -2], [-4, 0, 0], 0.5, 0.7, 0.3)!;
    expect(b).not.toBeNull();
    expect(b.normal[0]).toBeCloseTo(1, 9);
    expect(b.pos[0]).toBeCloseTo(0.05, 9);
    expect(ng.sectorAt(b.pos[0], b.pos[2])).toBe(0);
    expect(b.vel[0]).toBeCloseTo(2, 9);                            // still reflected
  });
  it('a push off the map (through the one-sided west wall) falls back to the start point', () => {
    const b = n.bounce([0.15, 0.2, -2], [0.22, 0.2, -2], [4, 0, 0], 0.5, 0.7, 0.3)!;
    expect(b).not.toBeNull();
    expect(b.normal[0]).toBeCloseTo(-1, 9);
    expect(b.pos[0]).toBeCloseTo(0.15, 9);
    expect(ng.sectorAt(b.pos[0], b.pos[2])).toBe(0);
  });
  it('a push-out with room behind it is unchanged (the fixture riser)', () => {
    const b = g.bounce([1, 0.2, -7.95], [1, 0.2, -8.05], [0, 0, -3], 0.5, 0.7, 0.1)!;
    expect(b.pos[2]).toBeCloseTo(-8 + 0.1, 9);
  });
});
