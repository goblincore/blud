// src/lab/sdf-zombie/webgpu/sector-navigation.test.ts
//
// Navigation over sector ground (spec §6.3) on the committed sectors fixture: A floor 0 with a
// column (x -1..1, z -5..-3), B a 0.5 m step north, C a 1.5 m ledge beyond B, D a -1 m pit east.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { createSectorNavigation } from './sector-navigation';
import type { Vec3 } from '../types';

const level = () => parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8')));
const L = level();
const map = L.sectors!;
const nav = createSectorNavigation(map, buildSectorGround(map), L.rooms, []);
const A: Vec3 = [-2.5, 0, -6], A2: Vec3 = [0, 0, -1.5], B: Vec3 = [0, 0.5, -10], C: Vec3 = [0, 1.5, -14], D: Vec3 = [6, -1, -4];

describe('createSectorNavigation: standing', () => {
  it('stands in the middle of every sector', () => {
    for (const p of [A, A2, B, C, D]) expect(nav.canStand(p)).toBe(true);
  });
  it('does not stand in the column, off the map, or against a one-sided wall', () => {
    expect(nav.canStand([0, 0, -4])).toBe(false);
    expect(nav.canStand([20, 0, 20])).toBe(false);
    expect(nav.canStand([0, 0, -0.2])).toBe(false);                         // A's north wall, z = 0
    expect(nav.canStand([-3.8, 0, -6])).toBe(false);                        // A's west wall, x = -4
    expect(nav.canStand([0, 0, -2.8])).toBe(false);                         // the column's face, z = -3
    expect(nav.canStand([0, 0, -0.5])).toBe(true);
  });
  it('a box in the body\'s height range blocks; one overhead does not', () => {
    const boxed = createSectorNavigation(map, buildSectorGround(map), L.rooms,
      [{ min: [-3, 0, -7], max: [-2, 1, -6] }, { min: [2, 2.5, -7], max: [3, 3, -6] }]);
    expect(boxed.canStand([-2.5, 0, -6.5])).toBe(false);
    expect(boxed.canStand([-2.5, 0, -7.2])).toBe(false);                    // inside the inflated box
    expect(boxed.canStand([2.5, 0, -6.5])).toBe(true);
  });
  it('a ceiling under the headroom closes a sector', () => {
    const m = level().sectors!;
    m.sectors[1]!.ceil = 2.3;                                               // B: 2.3 - 0.5 = 1.8 m
    const low = createSectorNavigation(m, buildSectorGround(m), L.rooms, []);
    expect(low.canStand(B)).toBe(false);
    expect(low.canStand(A)).toBe(true);
  });
});

describe('createSectorNavigation: a body overhanging a ledge stands on the ledge', () => {
  it('stands just over the pit\'s lip (on A\'s floor), so a drop is travellable', () => {
    expect(nav.canStand([4.2, -1, -4])).toBe(true);                         // centre over D, disc on A
    expect(nav.floorAt([4.2, -1, -4])).toBe(-1);                            // floorAt: the sector's own floor
    expect(nav.canTravel([4.2, 0, -4], [4.2, 0, -6])).toBe(true);           // along the lip
    expect(nav.canTravel([5, -1, -4], [4.2, 0, -4])).toBe(false);           // back onto the lip is a 1 m climb
  });
  it('the foot of the 1 m ledge is on the ledge: reachable from C, not from B', () => {
    expect(nav.canStand([0, 0.5, -11.8])).toBe(true);
    expect(nav.canTravel([0, 1.5, -13], [0, 0.5, -11.8])).toBe(true);
    expect(nav.canTravel([0, 0.5, -10], [0, 0.5, -11.8])).toBe(false);
  });
});

describe('createSectorNavigation: travel and routes', () => {
  it('walks up a 0.5 m step, not a 1.0 m ledge; drops are fine, climbs out of the pit are not', () => {
    expect(nav.canTravel([0, 0, -7], [0, 0.5, -9])).toBe(true);            // A -> B
    expect(nav.canTravel([0, 0.5, -11], [0, 1.5, -13])).toBe(false);       // B -> C
    expect(nav.canTravel([3, 0, -4], [5, -1, -4])).toBe(true);             // A -> D
    expect(nav.canTravel([5, -1, -4], [3, 0, -4])).toBe(false);            // D -> A
  });
  it('routes A -> B round the column, and every leg is travellable', () => {
    const path = nav.route(A2, B);
    expect(path.length).toBeGreaterThan(1);
    let last = A2;
    for (const p of path) { expect(nav.canTravel(last, p)).toBe(true); last = p; }
    expect(path.at(-1)).toEqual(B);
  });
  it('routes A -> D (down) but not A -> C (up the ledge) or D -> A (out of the pit)', () => {
    expect(nav.route(A2, D).length).toBeGreaterThan(0);
    expect(nav.route(A2, C)).toEqual([]);
    expect(nav.route(D, A2)).toEqual([]);
  });
  it('waypoints sit on their sector floors', () => {
    const path = nav.route(A2, B);
    for (const p of path.slice(0, -1)) expect(p[1]).toBe(nav.floorAt(p));
  });
});

describe('createSectorNavigation: rooms and floors', () => {
  it('gives the zone room id, 0 off the map', () => {
    expect([A, B, C].map(p => nav.roomAt(p))).toEqual([1, 1, 1]);
    expect(nav.roomAt(D)).toBe(2);
    expect(nav.roomAt([0, 0, -4])).toBe(0);
  });
  it('floorAt is the sector floor', () => {
    expect([A, B, C, D].map(p => nav.floorAt(p))).toEqual([0, 0.5, 1.5, -1]);
  });
  it('bounds are the vertices\' extent', () => {
    expect(nav.bounds).toEqual({ minX: -4, maxX: 8, minZ: -16, maxZ: 0 });
  });
});
