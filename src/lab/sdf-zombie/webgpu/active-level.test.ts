// src/lab/sdf-zombie/webgpu/active-level.test.ts
//
// The ring adapter must be byte-for-byte the testbed (every gate depends on
// it); the authored adapter must answer the same questions from a LevelDef.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, authoredLevel, missingCapabilities, ringLevel, sectorActiveLevel } from './active-level';
import {
  FURNITURE, PLAYER_START, ROOMS, TUNNELS, enclosureKeyAt, enclosureOf, levelColliders, levelSurfaces, spawnPoints,
} from './game-level';
import { FLAT_GROUND } from './level-ground';
import { parseLevelJson } from './level-json';
import { parseSectorLevel } from './sector-json';

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

  it('lists spawns in spawnAll order: per room, soldiers first, then juggernauts, then warbulls', () => {
    const expected = ROOMS.flatMap(room => spawnPoints(room).map((pos, index) => ({
      kind: index < (room.soldiers ?? 0) ? 'soldier'
        : index < (room.soldiers ?? 0) + (room.juggernauts ?? 0) ? 'juggernaut'
          : index < (room.soldiers ?? 0) + (room.juggernauts ?? 0) + (room.warbulls ?? 0) ? 'warbull' : 'zombie',
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
    expect([...ENGINE_CAPABILITIES].sort()).toEqual(['art', 'open-sky', 'portals', 'sectors', 'void', 'windows']);
    expect(missingCapabilities(two(), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(floors(), ENGINE_CAPABILITIES)).toEqual(['multi-floor']);
  });
});

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('sectorActiveLevel', () => {
  const def = parseSectorLevel(read('public/assets/levels/fixtures/sectors.level.json'));
  const L = sectorActiveLevel(def);
  it('is loadable by the engine', () => expect(missingCapabilities(def, ENGINE_CAPABILITIES)).toEqual([]));
  it('answers keyAt from the sector under the point', () => {
    expect(L.keyAt(0, -1)).toBe('zone-0');
    expect(L.keyAt(6, -4)).toBe('zone-1');
    expect(L.keyAt(0, -4)).toBe('void');                                // the column
  });
  it('has sector ground and no room walls in its colliders', () => {
    expect(L.ground.floorAt(0, -10)).toBe(0.5);
    expect(L.staticColliders).toEqual([]);
  });
  it('puts a spawn in its sector zone even when the zone boxes overlap', () => {
    const raw = read('public/assets/levels/fixtures/sectors.level.json');
    raw.sectors[1].zone = 1;                                            // zone 1's box now sits inside zone 0's
    raw.spawns = [
      { id: 'in-1', kind: 'zombie', pos: [0, 0.5, -10] },
      { id: 'in-0', kind: 'zombie', pos: [0, 0, -2] },
    ];
    const level = sectorActiveLevel(parseSectorLevel(raw));
    expect(level.spawnList().map(s => [s.id, s.room.name])).toEqual([['in-1', 'zone-1'], ['in-0', 'zone-0']]);
  });
  it('room levels and the ring stand on flat ground', () => {
    expect(ringLevel().ground).toBe(FLAT_GROUND);
    expect(authoredLevel(parseLevelJson(read('public/assets/levels/fixtures/two-rooms.level.json'))).ground).toBe(FLAT_GROUND);
  });
});
