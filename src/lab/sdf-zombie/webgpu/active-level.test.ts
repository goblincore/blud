// src/lab/sdf-zombie/webgpu/active-level.test.ts
//
// The ring adapter must be byte-for-byte the testbed (every gate depends on
// it); the authored adapter must answer the same questions from a LevelDef.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, authoredLevel, missingCapabilities, ringLevel } from './active-level';
import {
  FURNITURE, PLAYER_START, ROOMS, TUNNELS, enclosureKeyAt, enclosureOf, levelColliders, levelSurfaces, spawnPoints,
} from './game-level';
import { parseLevelJson } from './level-json';

const two = () => parseLevelJson(JSON.parse(readFileSync('public/assets/levels/fixtures/two-rooms.level.json', 'utf8')));
const floors = () => parseLevelJson(JSON.parse(readFileSync('public/assets/levels/fixtures/two-floors.level.json', 'utf8')));

describe('ringLevel', () => {
  const L = ringLevel();
  it('is the testbed exactly', () => {
    expect(L.id).toBe('ring');
    expect(L.def).toBeNull();
    expect(L.rooms).toBe(ROOMS);
    expect(L.tunnels).toBe(TUNNELS);
    expect(L.furniture).toBe(FURNITURE);
    expect(L.staticColliders).toEqual(levelColliders());
    expect({ planes: L.surfaces.planes, boxes: L.surfaces.boxes }).toEqual(levelSurfaces());
    expect(L.surfaces.gates).toEqual([]);
    expect(L.surfaces.windows).toEqual([]);
    expect(L.playerStart).toEqual({ ...PLAYER_START, y: 0 });
    expect(L.keyAt(-4, -4)).toBe(enclosureKeyAt(-4, -4));
    expect(L.enclosureFor('room1')).toEqual(enclosureOf('room1'));
    expect(L.gateColliders(new Set())).toEqual([]);
  });

  it('lists spawns in spawnAll order: per room, soldiers first, then juggernauts', () => {
    const expected = ROOMS.flatMap(room => spawnPoints(room).map((pos, index) => ({
      kind: index < (room.soldiers ?? 0) ? 'soldier'
        : index < (room.soldiers ?? 0) + (room.juggernauts ?? 0) ? 'juggernaut' : 'zombie',
      roomId: room.id, pos,
    })));
    expect(L.spawnList().map(s => ({ kind: s.kind, roomId: s.room.id, pos: s.pos }))).toEqual(expected);
  });
});

describe('authoredLevel', () => {
  it('answers from the LevelDef', () => {
    const L = authoredLevel(two());
    expect(L.id).toBe('two-rooms');
    expect(L.rooms.map(r => r.name)).toEqual(['west', 'east']);
    expect(L.keyAt(8.8, 4)).toBe('tunnel-1-2');
    expect(L.gateColliders(new Set())).toHaveLength(1);
    expect(L.gateColliders(new Set(['door']))).toHaveLength(0);
    expect(L.surfaces.windows).toHaveLength(1);
    expect(L.spawnList().map(s => [s.kind, s.room.name])).toEqual([['zombie', 'east']]);
    expect(L.playerStart).toMatchObject({ x: 4, z: 4 });
  });
});

describe('capabilities', () => {
  it('web engine v1 supports windows and open sky, not multi-floor', () => {
    expect([...ENGINE_CAPABILITIES].sort()).toEqual(['art', 'open-sky', 'portals', 'void', 'windows']);
    expect(missingCapabilities(two(), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(floors(), ENGINE_CAPABILITIES)).toEqual(['multi-floor']);
  });
});
