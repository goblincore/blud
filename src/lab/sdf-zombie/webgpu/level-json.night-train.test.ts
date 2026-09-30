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
  const ORDER = ['guards-van', 'third-class', 'dining-car', 'coat-check', 'sleeper', 'boiler-room', 'tender', 'control-room'];
  const inOrder = () => [...t.rooms].sort((a, b) => b.maxZ - a.maxZ);
  it('eight art-shelled carriages in order, at the layout\'s sizes', () => {
    const rs = inOrder();
    expect(rs.map(r => r.name)).toEqual(ORDER);
    expect(t.rooms.every(r => r.shell === 'art')).toBe(true);
    for (let i = 1; i < rs.length; i++) expect(rs[i]!.maxZ).toBeLessThan(rs[i - 1]!.minZ);
    expect(rs.map(r => +(r.maxX - r.minX).toFixed(2))).toEqual([3.6, 3.8, 4.2, 3.8, 4.0, 8.0, 3.4, 8.0]);   // the Boiler Room at 8 m (resize 2026-09-28)
    expect(rs.map(r => r.height)).toEqual([2.8, 2.8, 3.0, 2.8, 2.8, 3.4, 2.6, 3.4]);
    expect(t.art).toBe('night-train.art.glb');
    expect(missingCapabilities(t, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('seven vestibules, each at least 1.4 m wide', () => {
    expect(t.tunnels).toHaveLength(7);
    for (const v of t.tunnels) expect(v.maxX - v.minX).toBeGreaterThanOrEqual(1.4 - 1e-6);
  });

  it('23 zombies, 6 soldiers and the juggernaut in the tender (no cultists yet); the pickups', () => {
    expect(t.spawns.filter(s => s.kind === 'zombie')).toHaveLength(23);
    expect(t.spawns.filter(s => s.kind === 'juggernaut').map(s => roomAtPoint(t, s.pos[0], s.pos[2])?.name)).toEqual(['tender']);
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

  it('starts in the guard\'s van facing the control room', () => {
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
      'boiler room': [0, 0, z('boiler-room', 14)], 'chill-out': [3.0, 0, z('boiler-room', 22)], 'DJ end': [-2.0, 0, z('boiler-room', 27.2)],
      'tender walkway': [0.9, 0, z('tender', 7)], 
      'control room, door': [0, 0, z('control-room', 2)],
      'control room, west of the egg': [-2.2, 0, z('control-room', 6.3)],
      'control room, east of the egg': [2.2, 0, z('control-room', 6.3)],
      'control room, before the CRT wall': [0, 0, z('control-room', 8.8)],
    };
    for (const [name, p] of Object.entries(points)) expect(nav.route(start, p).length, name).toBeGreaterThan(0);
  });

  it('the control room: 8 x 10 m, no enemies, the egg in the middle, completion at the egg', () => {
    const r = room('control-room');
    expect(r.id).toBe(8);
    expect([r.minX, r.maxX, r.minZ, r.maxZ].map(v => +v.toFixed(2))).toEqual([-4, 4, -140.4, -130.4]);
    expect(t.spawns.filter(s => roomAtPoint(t, s.pos[0], s.pos[2])?.name === 'control-room')).toHaveLength(0);
    // The egg and plinth: one collision box 2.4 m square, taller than the player, centred on z -136.7.
    const egg = t.furniture.filter(f => f.room === r.id).find(f => Math.abs(f.minX + 1.2) < 1e-6 && Math.abs(f.maxX - 1.2) < 1e-6);
    expect(egg).toBeDefined();
    expect(egg!.height).toBeGreaterThan(2.8);
    expect((egg!.minZ + egg!.maxZ) / 2).toBeCloseTo(-136.7, 1);
    // Completion: the existing level.end trigger, now a 3.2 m box around the egg.
    const end = t.triggers.find(tr => tr.event === 'level.end')!;
    expect(end.box.min[0]).toBeCloseTo(-1.6, 2);
    expect(end.box.max[0]).toBeCloseTo(1.6, 2);
    expect(roomAtPoint(t, 0, (end.box.min[2] + end.box.max[2]) / 2)?.name).toBe('control-room');
  });
});

describe('night-train dynamic light (dynamic light spec §3)', () => {
  const moods = (name: string) => room(name).accents.map(a => a.mood);
  it('lamp moods and fires per carriage', () => {
    expect(moods('guards-van')).toEqual(expect.arrayContaining(['flicker', 'stutter', 'fire']));
    expect(moods('coat-check')).toEqual(['dead', 'dying']);
    expect(moods('dining-car')).toEqual(expect.arrayContaining(['flicker', 'dead', 'fire']));
    expect(moods('sleeper')).toEqual(expect.arrayContaining(['stutter', 'fire']));
    expect(moods('control-room')).toEqual(expect.arrayContaining(['dying', 'fire']));
    expect(t.rooms.flatMap(r => r.accents).every(a => a.mood !== undefined)).toBe(true);
  });
  it('the Boiler Room has two rows of tubes but no more shadow casters than one row (2026-09-29)', () => {
    // WebGPU's default is 16 sampled textures per fragment stage; each shadow-casting tube spends one.
    // Eight casters measured 18 and no pipeline compiled, so the second row only lights.
    const tubes = room('boiler-room').accents.filter(a => a.fixture === 'tube');
    expect(tubes).toHaveLength(8);
    expect(new Set(tubes.map(a => a.pos[0]))).toEqual(new Set([-2, 2]));
    expect(tubes.filter(a => a.shadow !== false)).toHaveLength(4);
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
  it('two red emergency beacons in the Boiler Room (room 5), dead until the strobe ends', () => {
    const b = room('boiler-room');
    expect(b.id).toBe(5);
    const beacons = t.rooms.flatMap(r => r.accents.filter(a => a.fixture === 'beacon').map(a => ({ a, r: r.name })));
    expect(beacons.map(x => x.r)).toEqual(['boiler-room', 'boiler-room']);
    expect(beacons.map(x => x.a.spin).sort()).toEqual([-0.7, 0.7]);
    expect(beacons.every(x => x.a.mood === 'dead')).toBe(true);
    // Below the carriage's centre pipe (build_train_kit ceiling_bay: radius 0.13 at h - 0.2), so
    // the housing and the beam's apex are not buried in it.
    expect(beacons.every(x => x.a.pos[1] <= b.height - 0.33)).toBe(true);
  });
});
