// src/lab/sdf-zombie/webgpu/level-json.test.ts
//
// Spec §4–§8. Valid cases read the shared fixtures (the Rust loader will read
// the same files); invalid cases mutate a copy.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLevelJson } from './level-json';

const fixture = (name: string): any =>
  JSON.parse(readFileSync(`public/assets/levels/fixtures/${name}.level.json`, 'utf8'));

describe('parseLevelJson: two-rooms fixture', () => {
  it('builds a LevelDef in its default state', () => {
    const L = parseLevelJson(fixture('two-rooms'));
    expect(L).toMatchObject({ id: 'two-rooms', ammo: 'finite', loadout: ['melee'], state: 'combat',
      states: ['combat', 'quiet'] });
    expect(L.rooms.map(r => [r.id, r.name, r.minX, r.maxX, r.minZ, r.maxZ, r.floor, r.height]))
      .toEqual([[1, 'west', 0, 8, 0, 8, 0, 3], [2, 'east', 9.6, 17.6, 0, 8, 0, 3]]);
    expect(L.tunnels[0]).toMatchObject({ name: 'tunnel-1-2', axis: 'x', minX: 8, maxX: 9.6, floor: 0 });
    expect(L.furniture[0]).toMatchObject({ room: 1, minX: 1, maxX: 2, height: 0.9 });
    expect(L.rooms[0]!.accents).toEqual([{ pos: [1, 1.2, 7], color: [1, 0.5, 0.2], power: 9 }]);
    expect(L.playerStart).toEqual({ x: 4, y: 0, z: 4, yaw: 1.5708, pitch: 0 });
    expect(L.triggers[0]!.once).toBe(true);
    expect(L.windows[0]).toMatchObject({ id: 'w1', view: 'night-fields', room: 1, side: 'n' });
    expect(L.requires).toEqual(['windows']);
    expect(L.spawns.map(s => s.id)).toEqual(['z1']);
    expect(L.rooms[1]).toMatchObject({ zombies: 1, soldiers: 0 });
  });

  it('filters to another state', () => {
    const L = parseLevelJson(fixture('two-rooms'), { state: 'quiet' });
    expect(L.state).toBe('quiet');
    expect(L.spawns).toEqual([]);
    expect(L.rooms[1]).toMatchObject({ zombies: 0 });
  });

  it('rejects an unknown state', () => {
    expect(() => parseLevelJson(fixture('two-rooms'), { state: 'party' })).toThrow('state party');
  });
});

describe('parseLevelJson: two-floors fixture', () => {
  it('reads floor heights and stairs, and derives multi-floor', () => {
    const L = parseLevelJson(fixture('two-floors'));
    expect(L.rooms[1]).toMatchObject({ floor: 2.5, height: 3 });
    expect(L.stairs).toEqual([{ id: 'steps', up: '-z', box: { min: [3, 0, 0.5], max: [5, 2.5, 5] } }]);
    expect(L.requires).toEqual(['multi-floor']);
    expect(L.states).toEqual(['default']);
    expect(L.playerStart.y).toBe(0);
  });
});

describe('parseLevelJson: rejections', () => {
  it.each([
    ['a tunnel that does not touch its rooms', (f: any) => { f.tunnels[0].min = [8.5, 3.2]; }, 'tunnel-1-2'],
    ['a tunnel narrower than 1.4 m', (f: any) => { f.tunnels[0].min = [8, 3.5]; f.tunnels[0].max = [9.6, 4.5]; }, 'narrower than 1.4'],
    ['a start outside every room', (f: any) => { f.start.pos = [30, 0, 30]; }, 'start'],
    ['a spawn in a corridor', (f: any) => { f.spawns[0].pos = [8.8, 0, 4]; }, 'spawn z1'],
    ['a duplicate marker id', (f: any) => { f.graves[0].id = 'cd'; }, 'duplicate id cd'],
    ['a raised furniture box', (f: any) => { f.furniture[0].min = [1, 0.5, 1]; }, 'furniture'],
    ['an unknown pickup item', (f: any) => { f.pickups[0].item = 'rocket'; }, 'pickup cd'],
    ['a wrong version', (f: any) => { f.version = 2; }, 'version'],
    ['an inverted box', (f: any) => { f.gates[0].max = [8, 2.2, 4.8]; }, 'gate door'],
    ['an unknown key', (f: any) => { f.rooms[0].colour = 'red'; }, 'unknown key colour'],
    ['an undeclared state on an element', (f: any) => { f.spawns[0].states = ['party']; }, 'spawn z1'],
    ['a window off every wall', (f: any) => { f.windows[0].min = [3, 1, 3]; f.windows[0].max = [5, 2, 3.1]; }, 'window w1'],
  ])('rejects %s', (_label, mutate, needle) => {
    const f = fixture('two-rooms');
    mutate(f);
    expect(() => parseLevelJson(f)).toThrow(needle);
  });

  it('reports every problem at once', () => {
    const f = fixture('two-rooms');
    f.start.pos = [30, 0, 30];
    f.spawns[0].pos = [8.8, 0, 4];
    expect(() => parseLevelJson(f)).toThrow(/start.*spawn z1/s);
  });
});

describe('parseLevelJson: outdoor keys (Outdoor v1 spec §4)', () => {
  it('reads the open-sky fixture', () => {
    const L = parseLevelJson(fixture('open-sky'));
    expect(L.skyline).toBe('treeline');
    const [yard, hall] = L.rooms;
    expect(yard).toMatchObject({ sky: 'night', ground: 'grass', edge: { style: 'wall', height: 2.2 } });
    expect(yard!.paths).toEqual([{ ground: 'gravel', minX: 5, maxX: 7, minZ: 0, maxZ: 10 }]);
    expect(hall).toMatchObject({ sky: null, ground: 'flagstone', edge: null, paths: [] });
    expect(L.requires).toEqual(['open-sky']);
  });

  it('defaults: ground stone, no paths, no edge, no skyline', () => {
    const L = parseLevelJson(fixture('two-rooms'));
    expect(L.skyline).toBeNull();
    for (const r of L.rooms) expect(r).toMatchObject({ ground: 'stone', paths: [], edge: null });
  });

  const bad = (mutate: (j: any) => void): string => {
    const j = fixture('open-sky');
    mutate(j);
    try { parseLevelJson(j); return ''; } catch (e) { return (e as Error).message; }
  };

  it('rejects unknown preset names', () => {
    expect(bad(j => { j.rooms[0].sky = 'noon'; })).toMatch(/rooms\[0\]\.sky: unknown sky noon/);
    expect(bad(j => { j.rooms[0].ground = 'lava'; })).toMatch(/rooms\[0\]\.ground: unknown ground lava/);
    expect(bad(j => { j.rooms[0].paths[0].ground = 'lava'; })).toMatch(/rooms\[0\]\.paths\[0\]\.ground: unknown ground lava/);
    expect(bad(j => { j.rooms[0].edge.style = 'moat'; })).toMatch(/rooms\[0\]\.edge\.style: unknown edge style moat/);
    expect(bad(j => { j.skyline = 'mountains'; })).toMatch(/skyline: unknown skyline mountains/);
  });

  it('rejects an edge without sky, and an edge out of range', () => {
    expect(bad(j => { j.rooms[1].edge = { style: 'wall', height: 2 }; })).toMatch(/rooms\[1\]\.edge: only open-sky rooms have an edge/);
    expect(bad(j => { j.rooms[0].edge.height = 0.1; })).toMatch(/rooms\[0\]\.edge\.height: between 0\.3 and the room height/);
    expect(bad(j => { j.rooms[0].edge.height = 7; })).toMatch(/rooms\[0\]\.edge\.height: between 0\.3 and the room height/);
  });

  it('rejects a path outside its room or with no extent, and unknown keys', () => {
    expect(bad(j => { j.rooms[0].paths[0].max = [13, 10]; })).toMatch(/rooms\[0\]\.paths\[0\]: must lie inside its room/);
    expect(bad(j => { j.rooms[0].paths[0].max = [5, 10]; })).toMatch(/rooms\[0\]\.paths\[0\]: empty path/);
    expect(bad(j => { j.rooms[0].paths[0].width = 2; })).toMatch(/rooms\[0\]\.paths\[0\]: unknown key width/);
    expect(bad(j => { j.rooms[0].edge.colour = 'red'; })).toMatch(/rooms\[0\]\.edge: unknown key colour/);
  });
});

describe('parseLevelJson: dynamic light keys (dynamic light spec §3)', () => {
  it('reads a light mood, cues and the flashlight pickup', () => {
    const f = fixture('two-rooms');
    f.lights[0].mood = 'dying';
    f.cues = [{ on: 'pickup.flashlight', emit: ['light.die.room.1'] }];
    f.pickups.push({ id: 'torch', item: 'flashlight', pos: [2, 1.4, 2] });
    const L = parseLevelJson(f);
    expect(L.rooms.flatMap(r => r.accents).some(a => a.mood === 'dying')).toBe(true);
    expect(L.cues).toEqual([{ on: 'pickup.flashlight', emit: ['light.die.room.1'] }]);
    expect(L.pickups.find(p => p.id === 'torch')?.item).toBe('flashlight');
  });

  it('defaults to no cues and no mood', () => {
    const L = parseLevelJson(fixture('two-rooms'));
    expect(L.cues).toEqual([]);
    expect(L.rooms.flatMap(r => r.accents).every(a => a.mood === undefined)).toBe(true);
  });

  it.each([
    ['an unknown mood', (f: any) => { f.lights[0].mood = 'sad'; }, 'mood'],
    ['a cue without emit', (f: any) => { f.cues = [{ on: 'x' }]; }, 'cues[0].emit'],
    ['a cue without on', (f: any) => { f.cues = [{ emit: ['x'] }]; }, 'cues[0].on'],
  ])('rejects %s', (_label, mutate, needle) => {
    const f = fixture('two-rooms');
    mutate(f);
    expect(() => parseLevelJson(f)).toThrow(needle);
  });
});
