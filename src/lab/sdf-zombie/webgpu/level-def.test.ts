// src/lab/sdf-zombie/webgpu/level-def.test.ts
//
// Hand-worked gates for spec §6: two 8x8 rooms joined by an x-axis corridor.
// If walls, openings or lintels are wrong, the walk test or the
// corridor-clear test fails before anything reaches the renderer.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import {
  DEFAULT_PALETTE, LEVEL_WALL_T, enclosureKeyIn, enclosureOfIn, gateColliders,
  layoutColliders, layoutSurfaces, roomAtPoint, roomMouths, type LevelDef, type LevelRoom,
} from './level-def';
import { stepPlayer, type PlayerState } from './game-player';

function twoRooms(): LevelDef {
  const P = DEFAULT_PALETTE;
  const room = (id: number, name: string, minX: number, maxX: number): LevelRoom => ({
    id, name, minX, maxX, minZ: 0, maxZ: 8, height: 3, floor: 0, sky: null, ground: 'stone', paths: [], edge: null, void: false,
    wallColor: P.wall, floorColor: P.floor, ceilColor: P.ceil, accents: [], zombies: 0, soldiers: 0,
  });
  return {
    id: 'two', name: 'Two rooms', ammo: 'infinite', palette: P, loadout: [], completeOn: 'pickup.cd',
    state: 'default', states: ['default'], requires: [], skyline: null,
    rooms: [room(1, 'west', 0, 8), room(2, 'east', 9.6, 17.6)],
    tunnels: [{ name: 'tunnel-1-2', a: 1, b: 2, minX: 8, maxX: 9.6, minZ: 3.2, maxZ: 4.8,
      height: 2.2, color: P.tunnel, axis: 'x', floor: 0 }],
    stairs: [], furniture: [], solids: [],
    gates: [{ id: 'door', opensOn: 'open.door', box: { min: [8.6, 0, 3.2], max: [9.0, 2.2, 4.8] } }],
    triggers: [],
    windows: [{ id: 'w1', view: 'night', room: 1, side: 'n', box: { min: [3, 1, -0.05], max: [5, 2, 0.05] } }],
    playerStart: { x: 4, y: 0, z: 4, yaw: Math.PI / 2, pitch: 0 },
    spawns: [], graves: [], pickups: [], bells: [], portals: [],
  };
}

const hitsPoint = (boxes: readonly { min: Vec3; max: Vec3 }[], p: Vec3) =>
  boxes.some(b => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1]
    && p[2] > b.min[2] && p[2] < b.max[2]);

describe('roomMouths', () => {
  it('finds the corridor on the east wall of room 1 and the west wall of room 2 only', () => {
    const L = twoRooms();
    expect(roomMouths(L, L.rooms[0]!, 'e').map(m => [m.lo, m.hi])).toEqual([[3.2, 4.8]]);
    expect(roomMouths(L, L.rooms[0]!, 'w')).toEqual([]);
    expect(roomMouths(L, L.rooms[1]!, 'w').map(m => [m.lo, m.hi])).toEqual([[3.2, 4.8]]);
    expect(roomMouths(L, L.rooms[1]!, 'n')).toEqual([]);
  });

  it('ignores a corridor on a different floor', () => {
    const L = twoRooms();
    L.tunnels[0]!.floor = 3;
    expect(roomMouths(L, L.rooms[0]!, 'e')).toEqual([]);
  });
});

describe('layoutColliders', () => {
  it('leaves the corridor clear at walking height', () => {
    const boxes = layoutColliders(twoRooms());
    for (let x = 7.9; x <= 9.7; x += 0.1) expect(hitsPoint(boxes, [x, 1.0, 4.0])).toBe(false);
  });

  it('closes every other stretch of wall', () => {
    const boxes = layoutColliders(twoRooms());
    expect(hitsPoint(boxes, [8.15, 1.0, 1.0])).toBe(true);
    expect(hitsPoint(boxes, [4.0, 1.0, -0.15])).toBe(true);
    expect(hitsPoint(boxes, [8.15, 2.6, 4.0])).toBe(true);
    expect(hitsPoint(boxes, [8.8, 1.0, 3.2 - LEVEL_WALL_T / 2])).toBe(true);
  });

  it('raises walls with the room floor', () => {
    const L = twoRooms();
    L.rooms[0]!.floor = 2;
    L.tunnels = [];
    const boxes = layoutColliders(L);
    expect(hitsPoint(boxes, [4.0, 4.5, -0.15])).toBe(true);   // floor 2 + 2.5
    expect(hitsPoint(boxes, [4.0, 5.5, -0.15])).toBe(false);  // above floor 2 + height 3
  });

  it('lets the player walk from room 1 through the corridor into room 2', () => {
    const boxes = layoutColliders(twoRooms());
    const s: PlayerState = { pos: [4, 0, 4], vel: [0, 0, 0], yaw: Math.PI / 2, pitch: 0, grounded: true };
    for (let i = 0; i < 240; i++) stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, boxes);
    expect(s.pos[0]).toBeGreaterThan(10.5);
    expect(Math.abs(s.pos[2] - 4)).toBeLessThan(0.05);
  });

  it('stops the player at a solid wall', () => {
    const boxes = layoutColliders(twoRooms());
    const s: PlayerState = { pos: [4, 0, 4], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true };
    for (let i = 0; i < 240; i++) stepPlayer(s, { x: 0, z: 1, jump: false }, 1 / 60, boxes);
    expect(s.pos[2]).toBeGreaterThan(0.3);
  });
});

describe('gateColliders', () => {
  it('returns closed gates and drops opened ones', () => {
    const L = twoRooms();
    expect(gateColliders(L, new Set())).toHaveLength(1);
    expect(gateColliders(L, new Set(['door']))).toHaveLength(0);
  });
});

describe('layoutSurfaces', () => {
  it('gives each room a floor and a ceiling, and a sky room no ceiling', () => {
    const L = twoRooms();
    expect(layoutSurfaces(L).planes.filter(p => p.axis === 1 && p.facing === -1)).toHaveLength(2);
    L.rooms[1]!.sky = 'night';
    expect(layoutSurfaces(L).planes.filter(p => p.axis === 1 && p.facing === -1)).toHaveLength(1);
  });

  it('puts a header over the opening; every wall plane has extent on its span axis', () => {
    const { planes } = layoutSurfaces(twoRooms());
    expect(planes.find(p => p.axis === 0 && p.min[0] === 8 && p.min[1] === 2.2)).toBeDefined();
    for (const p of planes) {
      if (p.axis === 0) expect(p.max[2] - p.min[2]).toBeGreaterThan(1e-3);
      if (p.axis === 2) expect(p.max[0] - p.min[0]).toBeGreaterThan(1e-3);
    }
  });

  it('returns gates and windows separately', () => {
    const s = layoutSurfaces(twoRooms());
    expect(s.gates.map(g => g.id)).toEqual(['door']);
    expect(s.windows).toHaveLength(1);
    const w = s.windows[0]!;
    expect(w).toMatchObject({ id: 'w1', view: 'night' });
    expect(w.plane).toMatchObject({ axis: 2, facing: 1 });
    expect(w.plane.min[0]).toBe(3);
    expect(w.plane.max[0]).toBe(5);
    expect(w.plane.min[2]).toBeGreaterThan(0);          // nudged inward off the wall
  });
});

describe('enclosure lookups', () => {
  it('names the corridor, the rooms and the void', () => {
    const L = twoRooms();
    expect(enclosureKeyIn(L, 8.8, 4)).toBe('tunnel-1-2');
    expect(enclosureKeyIn(L, 2, 2)).toBe('west');
    expect(enclosureKeyIn(L, 30, 30)).toBe('void');
    expect(roomAtPoint(L, 12, 1)?.id).toBe(2);
    expect(roomAtPoint(L, 8.8, 4)).toBeNull();
  });

  it('builds bounce uniforms for a room and a tunnel', () => {
    const L = twoRooms();
    expect(enclosureOfIn(L, 'west')?.box).toEqual({ min: [0, 0, 0], max: [8, 3, 8] });
    expect(enclosureOfIn(L, 'tunnel-1-2')?.walls.negX).toEqual(DEFAULT_PALETTE.tunnel);
    expect(enclosureOfIn(L, 'nope')).toBeNull();
  });
});
