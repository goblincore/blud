// src/lab/sdf-zombie/webgpu/level-json.the-void.test.ts
//
// The committed Void (spec 2026-09-24-void-portal-design.md §4).

// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, missingCapabilities } from './active-level';
import { parseLevelJson } from './level-json';
import { portalFrame } from './void-portal';

const v = parseLevelJson(JSON.parse(readFileSync('public/assets/levels/the-void.level.json', 'utf8')));

describe('the-void.level.json', () => {
  it('one void room, one portal to the first level, nothing to fight', () => {
    expect(v.rooms).toHaveLength(1);
    expect(v.rooms[0]!.void).toBe(true);
    expect(v.portals).toHaveLength(1);
    expect(v.portals[0]!.target).toBe('the-wake');
    expect(v.spawns).toEqual([]);
    expect(missingCapabilities(v, ENGINE_CAPABILITIES)).toEqual([]);
  });
  it('the player starts about 12 m out, facing the portal, on its viewer side', () => {
    const p = v.portals[0]!, s = v.playerStart;
    const dist = Math.hypot(s.x - p.pos[0], s.z - p.pos[2]);
    expect(dist).toBeGreaterThan(11); expect(dist).toBeLessThan(13);
    const f = portalFrame(p);
    expect((s.x - p.pos[0]) * f.facing[0] + (s.z - p.pos[2]) * f.facing[2]).toBeGreaterThan(0);
    const look = [Math.sin(s.yaw), -Math.cos(s.yaw)];
    expect(look[0]! * (p.pos[0] - s.x) + look[1]! * (p.pos[2] - s.z)).toBeGreaterThan(11);
  });
  it('a red light sits at the portal', () => {
    expect(v.rooms[0]!.accents).toHaveLength(1);
    expect(v.rooms[0]!.accents[0]!.color[0]).toBeGreaterThan(v.rooms[0]!.accents[0]!.color[1]);
  });
});
