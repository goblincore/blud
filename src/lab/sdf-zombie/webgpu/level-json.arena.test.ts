// src/lab/sdf-zombie/webgpu/level-json.arena.test.ts
//
// The TEST ARENA (game-arena.ts): one big room, one enemy spawn in front of the player, every weapon, infinite
// ammo, and the `arena` flag that turns on god mode and the respawn keys. The flag parses only as a boolean.
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { parseLevelJson } from './level-json';
import { arenaCharacters, arenaStep } from './arena-cycle';

const raw = JSON.parse(readFileSync('public/assets/levels/arena.level.json', 'utf8'));
const a = parseLevelJson(raw);

describe('arena.level.json', () => {
  it('is an arena: one room, one zombie-kind spawn (?spawn= picks it), every weapon, infinite ammo', () => {
    expect(a.arena).toBe(true);
    expect(a.rooms).toHaveLength(1);
    expect(a.spawns).toHaveLength(1);
    expect(a.spawns[0]!.kind).toBe('zombie');
    expect(a.ammo).toBe('infinite');
    expect(a.loadout).toEqual(expect.arrayContaining(['melee', 'shotgun', 'dynamite', 'flare']));
    expect(missingCapabilities(a, ENGINE_CAPABILITIES)).toEqual([]);
  });
  it('the enemy stands 5-10 m in front of the player, in the light', () => {
    const s = a.playerStart, e = a.spawns[0]!.pos;
    const look = [Math.sin(s.yaw), -Math.cos(s.yaw)];
    const along = look[0]! * (e[0] - s.x) + look[1]! * (e[2] - s.z);
    expect(along).toBeGreaterThan(5); expect(along).toBeLessThan(10);
  });
  it('the flag is a boolean, and absent on other levels', () => {
    expect(() => parseLevelJson({ ...raw, arena: 'yes' })).toThrow(/arena/);
    const { arena: _drop, ...plain } = raw;
    expect(parseLevelJson(plain).arena).toBeUndefined();
  });
});

describe('arena cycling', () => {
  it('skips the renderer fixtures and wraps both ways', () => {
    const list = arenaCharacters(['zombie', 'box-fixture', 'chair', 'gamer']);
    expect(list).toEqual(['zombie', 'chair', 'gamer']);
    expect(arenaStep(list, 'gamer', 1)).toBe('zombie');
    expect(arenaStep(list, 'zombie', -1)).toBe('gamer');
    expect(arenaStep(list, 'chair', 0)).toBe('chair');
    expect(arenaStep(list, 'nobody', 1)).toBe('zombie');
  });
});
