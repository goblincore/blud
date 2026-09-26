// src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts
//
// The committed Night Train first slice, built from the approved layout
// (docs/game/levels/01-night-train/layout.md).

// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { createEncounterNavigation } from './encounter-navigation';
import { layoutColliders, roomAtPoint } from './level-def';
import { parseLevelJson } from './level-json';

const t = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/night-train.level.json', 'utf8')));
const room = (name: string) => t.rooms.find(r => r.name === name)!;

describe('night-train.level.json', () => {
  it('five art-shelled carriages in order, at the layout\'s sizes', () => {
    expect(t.rooms.map(r => r.name)).toEqual(['guards-van', 'dining-car', 'sleeper', 'party-carriage', 'cab']);
    expect(t.rooms.every(r => r.shell === 'art')).toBe(true);
    for (let i = 1; i < t.rooms.length; i++) expect(t.rooms[i]!.maxZ).toBeLessThan(t.rooms[i - 1]!.minZ);
    expect(t.rooms.map(r => +(r.maxX - r.minX).toFixed(2))).toEqual([3.6, 4.2, 4.0, 4.2, 3.0]);
    expect(t.rooms.map(r => r.height)).toEqual([2.8, 3.0, 2.8, 3.4, 2.6]);
    expect(t.art).toBe('night-train.art.glb');
    expect(missingCapabilities(t, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('four vestibules, each at least 1.4 m wide', () => {
    expect(t.tunnels).toHaveLength(4);
    for (const v of t.tunnels) expect(v.maxX - v.minX).toBeGreaterThanOrEqual(1.4 - 1e-6);
  });

  it('19 zombies and 5 cultists; the pickups the layout places', () => {
    expect(t.spawns.filter(s => s.kind === 'zombie')).toHaveLength(19);
    expect(t.spawns.filter(s => s.kind === 'cultist')).toHaveLength(5);
    const at = (item: string) => t.pickups.filter(p => p.item === item).map(p => roomAtPoint(t, p.pos[0], p.pos[2])?.name);
    expect(at('shotgun')).toEqual(['guards-van']);
    expect(at('dynamite').sort()).toEqual(['party-carriage', 'sleeper']);
    expect(at('cd')).toEqual(['party-carriage']);
  });

  it('the sleeper has its compartments and the locked C5', () => {
    const s = room('sleeper');
    const inSleeper = t.solids.filter(b => b.min[2] >= s.minZ - 1e-6 && b.max[2] <= s.maxZ + 1e-6);
    expect(inSleeper.length).toBeGreaterThanOrEqual(12);
    expect(t.gates).toEqual([expect.objectContaining({ id: 'c5-door' })]);
  });

  it('starts in the guard\'s van facing the cab', () => {
    expect(roomAtPoint(t, t.playerStart.x, t.playerStart.z)?.name).toBe('guards-van');
    expect(Math.abs(t.playerStart.yaw)).toBeLessThan(1e-3);
  });

  it('enemy navigation reaches every room from the start', () => {
    const nav = createEncounterNavigation(t.rooms, t.tunnels, layoutColliders(t));
    const start: [number, number, number] = [t.playerStart.x, 0, t.playerStart.z];
    const z = (name: string, u: number) => room(name).maxZ - u;
    const points: Record<string, [number, number, number]> = {
      'van cage': [0, 0, z('guards-van', 8)], 'van office': [0, 0, z('guards-van', 13.5)],
      'lounge west lane': [-1.35, 0, z('dining-car', 12.5)], 'lounge east lane': [1.35, 0, z('dining-car', 12.5)],
      'galley': [0, 0, z('dining-car', 16.8)], 'sleeper corridor': [-1.3, 0, z('sleeper', 9)],
      'C1': [0.8, 0, z('sleeper', 3.1)], 'C3': [0.8, 0, z('sleeper', 9)], 'C4': [0.8, 0, z('sleeper', 12)],
      'party': [0, 0, z('party-carriage', 10)], 'cab': [0, 0, z('cab', 5)],
    };
    for (const [name, p] of Object.entries(points)) expect(nav.route(start, p).length, name).toBeGreaterThan(0);
  });
});
