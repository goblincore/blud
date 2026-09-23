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
    expect(wake.rooms.map(r => r.name)).toEqual(['gates', 'graveyard', 'crypt', 'parlour', 'secret']);
    expect(wake.tunnels).toHaveLength(4);
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
    expect(roomAtPoint(wake, -6.5, -49.5)?.name).toBe('crypt');
    expect(wake.windows).toEqual([expect.objectContaining({ id: 'parlour-window', view: 'train-waiting', room: 4, side: 'n' })]);
    expect(wake.spawns).toHaveLength(17);
  });

  it('loads in the web engine (flat floor; windows only)', () => {
    expect(wake.requires).toEqual(['windows']);
    expect(missingCapabilities(wake, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('routes from the start to the CD with the gate open', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    const start: Vec3 = [wake.playerStart.x, 0, wake.playerStart.z];
    expect(nav.canStand(start)).toBe(true);
    expect(nav.route(start, [0, 0, -78.2]).length).toBeGreaterThan(0);
  });

  it('reaches the secret room through the fence gap', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    expect(nav.route([0, 0, -20], [17, 0, -30]).length).toBeGreaterThan(0);
  });

  it('cannot reach the crypt while the crypt slab is closed', () => {
    const closed = [...layoutColliders(wake), ...gateColliders(wake, new Set())];
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, closed);
    expect(nav.route([0, 0, -30], [0, 0, -54])).toEqual([]);
  });

  it('keeps every spawn and grave standable', () => {
    const nav = createEncounterNavigation(wake.rooms, wake.tunnels, layoutColliders(wake));
    for (const m of [...wake.spawns, ...wake.graves]) expect(nav.canStand([m.pos[0], 0, m.pos[2]]), m.id).toBe(true);
  });
});
