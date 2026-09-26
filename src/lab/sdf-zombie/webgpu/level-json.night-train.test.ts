// src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts
//
// The committed Night Train, built from the approved layout draft 2
// (docs/game/levels/01-night-train/layout.md, 2026-09-26: eight carriages).

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
  const ORDER = ['guards-van', 'third-class', 'dining-car', 'coat-check', 'sleeper', 'boiler-room', 'tender', 'cab'];
  const inOrder = () => [...t.rooms].sort((a, b) => b.maxZ - a.maxZ);
  it('eight art-shelled carriages in order, at the layout\'s sizes', () => {
    const rs = inOrder();
    expect(rs.map(r => r.name)).toEqual(ORDER);
    expect(t.rooms.every(r => r.shell === 'art')).toBe(true);
    for (let i = 1; i < rs.length; i++) expect(rs[i]!.maxZ).toBeLessThan(rs[i - 1]!.minZ);
    expect(rs.map(r => +(r.maxX - r.minX).toFixed(2))).toEqual([3.6, 3.8, 4.2, 3.8, 4.0, 4.2, 3.4, 3.0]);
    expect(rs.map(r => r.height)).toEqual([2.8, 2.8, 3.0, 2.8, 2.8, 3.4, 2.6, 2.6]);
    expect(t.art).toBe('night-train.art.glb');
    expect(missingCapabilities(t, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('seven vestibules, each at least 1.4 m wide', () => {
    expect(t.tunnels).toHaveLength(7);
    for (const v of t.tunnels) expect(v.maxX - v.minX).toBeGreaterThanOrEqual(1.4 - 1e-6);
  });

  it('24 zombies and 6 soldiers (no cultists yet); the pickups the layout places', () => {
    expect(t.spawns.filter(s => s.kind === 'zombie')).toHaveLength(24);
    expect(t.spawns.filter(s => s.kind === 'soldier')).toHaveLength(6);
    expect(t.spawns.filter(s => s.kind === 'cultist')).toHaveLength(0);
    expect(t.spawns.filter(s => roomAtPoint(t, s.pos[0], s.pos[2])?.name === 'boiler-room' && s.kind === 'zombie')).toHaveLength(4);
    const at = (item: string) => t.pickups.filter(p => p.item === item).map(p => roomAtPoint(t, p.pos[0], p.pos[2])?.name);
    expect(at('shotgun')).toEqual(['guards-van']);
    expect(at('dynamite').sort()).toEqual(['boiler-room', 'sleeper']);
    expect(at('cd')).toEqual(['boiler-room']);
    expect(at('flashlight')).toEqual(['coat-check']);
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
      'third class': [0, 0, z('third-class', 9)], 'third, between benches': [-1.3, 0, z('third-class', 2.4)],
      'coats, west lane': [-1.2, 0, z('coat-check', 6.8)], 'behind the counter': [-1.2, 0, z('coat-check', 12.4)],
      'boiler room': [0, 0, z('boiler-room', 10)], 'DJ deck': [-0.8, 0, z('boiler-room', 18.3)],
      'tender walkway': [0.9, 0, z('tender', 7)], 'cab': [0, 0, z('cab', 5)],
    };
    for (const [name, p] of Object.entries(points)) expect(nav.route(start, p).length, name).toBeGreaterThan(0);
  });
});

describe('night-train dynamic light (dynamic light spec §3)', () => {
  const moods = (name: string) => room(name).accents.map(a => a.mood);
  it('lamp moods and fires per carriage', () => {
    expect(moods('guards-van')).toEqual(expect.arrayContaining(['flicker', 'stutter', 'fire']));
    expect(moods('coat-check')).toEqual(['dead', 'dying']);
    expect(moods('dining-car')).toEqual(expect.arrayContaining(['flicker', 'dead', 'fire']));
    expect(moods('sleeper')).toEqual(expect.arrayContaining(['stutter', 'fire']));
    expect(moods('cab')).toEqual(expect.arrayContaining(['steady', 'fire']));
    expect(t.rooms.flatMap(r => r.accents).every(a => a.mood !== undefined)).toBe(true);
  });
  it('the flashlight hangs behind the coat-check counter, mid-level', () => {
    const torch = t.pickups.find(p => p.item === 'flashlight')!;
    expect(torch.id).toBe('torch');
    expect(roomAtPoint(t, torch.pos[0], torch.pos[2])?.name).toBe('coat-check');
  });
  it('taking it kills the coat-check lamps and wakes the room; blackout, strobe and end triggers', () => {
    expect(t.cues).toEqual([{ on: 'pickup.flashlight', emit: ['light.die.room.6', 'alert.room.6'] }]);
    expect(t.triggers.map(tr => [tr.event, tr.once]).sort()).toEqual([['level.end', true], ['light.blackout.room.4', true], ['light.strobe.room.5', true]]);
    expect(t.completeOn).toBe('level.end');
  });
});
