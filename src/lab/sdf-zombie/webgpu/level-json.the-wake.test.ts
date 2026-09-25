// src/lab/sdf-zombie/webgpu/level-json.the-wake.test.ts
//
// The committed Wake: it parses, the web engine can load it, every beat is
// reachable through the enemy navigation grid, and the crypt stays shut until
// its gate opens.

// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { createEncounterNavigation } from './encounter-navigation';
import { gateColliders, layoutColliders, roomAtPoint } from './level-def';
import { parseLevelJson } from './level-json';

const wake = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/the-wake.level.json', 'utf8')));

describe('the-wake.level.json', () => {
  it('has the rooms, corridors and markers the design calls for', () => {
    expect(wake.rooms.map(r => r.name)).toEqual(['gates', 'lane', 'graveyard', 'crypt', 'ossuary', 'vestibule', 'parlour', 'secret']);
    expect(wake.tunnels).toHaveLength(8);
    expect(wake.loadout).toEqual(['melee']);
    expect(wake.ammo).toBe('finite');
    expect(roomAtPoint(wake, wake.playerStart.x, wake.playerStart.z)?.name).toBe('gates');
    expect(wake.bells).toHaveLength(1);
    expect(wake.gates).toEqual([expect.objectContaining({ id: 'crypt-slab', opensOn: 'bell.toll.1' })]);
    const waves = new Map<number, number>();
    for (const g of wake.graves) waves.set(g.wave, (waves.get(g.wave) ?? 0) + 1);
    expect([...waves.entries()].sort()).toEqual([[0, 2], [1, 3], [2, 4], [3, 5]]);
    for (const item of ['cd', 'shotgun', 'dynamite'] as const) {
      expect(wake.pickups.filter(p => p.item === item), item).toHaveLength(1);
    }
    expect(roomAtPoint(wake, 20.3, -69)?.name).toBe('ossuary'); // the dynamite
    expect(wake.windows).toEqual([expect.objectContaining({ id: 'parlour-window', view: 'train-waiting', room: 7, side: 'n' })]);
    expect(wake.spawns).toHaveLength(20);
    expect(wake.spawns.every(s => s.kind === 'zombie')).toBe(true);
  });

  it('loads in the web engine (flat floor; windows, open sky)', () => {
    expect(wake.requires).toEqual(['windows', 'open-sky']);
    expect(missingCapabilities(wake, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('routes from the start to the CD with the gate open', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    const start: Vec3 = [wake.playerStart.x, 0, wake.playerStart.z];
    expect(nav.canStand(start)).toBe(true);
    expect(nav.route(start, [10, 0, -104]).length).toBeGreaterThan(0);
  });

  it('reaches the secret room through the fence gap', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    expect(nav.route([-11.5, 0, -27.3], [20, 0, -40]).length).toBeGreaterThan(0);
  });

  it('cannot reach the crypt while the crypt slab is closed', () => {
    const closed = [...layoutColliders(wake), ...gateColliders(wake, new Set())];
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, closed);
    expect(nav.route([-11.5, 0, -27.3], [10, 0, -69])).toEqual([]);
  });

  it('is outdoors where the design says (Outdoor v1 §9)', () => {
    const by = new Map(wake.rooms.map(r => [r.name, r]));
    expect(by.get('graveyard')).toMatchObject({ sky: 'night', ground: 'grass', edge: { style: 'wall', height: 2.2 } });
    expect(by.get('lane')).toMatchObject({ sky: 'night', ground: 'gravel', edge: { style: 'hedge' } });
    expect(by.get('gates')).toMatchObject({ sky: 'night', ground: 'gravel', edge: { style: 'wall' } });
    expect(by.get('crypt')).toMatchObject({ sky: null, ground: 'flagstone' });
    expect(wake.skyline).toBe('treeline');
    expect(by.get('graveyard')!.paths.map(q => q.ground).sort()).toEqual(['dirt', 'gravel', 'gravel', 'gravel', 'gravel']);
  });

  it('loops: round the bell tower and through both ossuary doors', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    expect(nav.route([-8, 0, -42], [8, 0, -42]).length).toBeGreaterThan(0);
    expect(nav.route([10, 0, -64], [18, 0, -65]).length).toBeGreaterThan(0);
    expect(nav.route([10, 0, -74.5], [18, 0, -73]).length).toBeGreaterThan(0);
  });

  it('keeps every spawn and grave standable', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    for (const m of [...wake.spawns, ...wake.graves]) expect(nav.canStand([m.pos[0], 0, m.pos[2]]), m.id).toBe(true);
  });
});
