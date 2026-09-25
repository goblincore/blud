// src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts
//
// The committed Night Train first slice (carriage kit spec §4).

// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { roomAtPoint } from './level-def';
import { parseLevelJson } from './level-json';

const t = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/night-train.level.json', 'utf8')));

describe('night-train.level.json', () => {
  it('four art-shelled carriages in order, back to front', () => {
    expect(t.rooms.map(r => r.name)).toEqual(['guards-van', 'dining-car', 'party-carriage', 'cab']);
    expect(t.rooms.every(r => r.shell === 'art')).toBe(true);
    for (let i = 1; i < t.rooms.length; i++) expect(t.rooms[i]!.maxZ).toBeLessThan(t.rooms[i - 1]!.minZ);
    expect(t.rooms.find(r => r.name === 'party-carriage')!.height).toBeCloseTo(3.2);
    expect(t.art).toBe('night-train.art.glb');
    expect(missingCapabilities(t, ENGINE_CAPABILITIES)).toEqual([]);
  });
  it('vestibules join each pair and are at least 1.4 m wide', () => {
    expect(t.tunnels).toHaveLength(3);
    for (const v of t.tunnels) expect(v.maxX - v.minX).toBeGreaterThanOrEqual(1.4 - 1e-6);
  });
  it('starts at the back of the guard\'s van, facing the cab', () => {
    expect(roomAtPoint(t, t.playerStart.x, t.playerStart.z)?.name).toBe('guards-van');
    expect(Math.abs(t.playerStart.yaw)).toBeLessThan(1e-3);
  });
  it('furniture keeps an aisle of at least 1.4 m in every carriage but the cab', () => {
    for (const r of t.rooms.filter(r => r.name !== 'cab')) {
      const f = t.furniture.filter(b => b.room === r.id);
      expect(f.length).toBeGreaterThan(0);
      const west = Math.max(r.minX, ...f.filter(b => b.maxX < 0.2).map(b => b.maxX));
      const east = Math.min(r.maxX, ...f.filter(b => b.minX > -0.2).map(b => b.minX));
      expect(east - west).toBeGreaterThanOrEqual(1.4 - 1e-6);
    }
  });
});
