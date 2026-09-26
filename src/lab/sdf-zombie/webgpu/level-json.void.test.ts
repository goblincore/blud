// src/lab/sdf-zombie/webgpu/level-json.void.test.ts
//
// Void v1 §3: void rooms (nothing drawn, collision kept) and portals.

// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutColliders, layoutSurfaces, enclosureOfIn } from './level-def';
import { parseLevelJson } from './level-json';

const raw = () => JSON.parse(readFileSync('public/assets/levels/fixtures/void-portal.level.json', 'utf8'));

describe('void rooms and portals', () => {
  it('parses a void room and a portal', () => {
    const d = parseLevelJson(raw());
    expect(d.rooms[0]!.void).toBe(true);
    expect(d.portals).toEqual([{ id: 'first', pos: [0, 0, -18], yaw: 3.1416, width: 2.2, height: 3.4, target: 'the-wake' }]);
    expect(d.requires).toEqual(['void', 'portals']);
  });
  it('draws nothing for a void room but keeps its collision', () => {
    const d = parseLevelJson(raw());
    expect(layoutSurfaces(d).planes).toEqual([]);
    expect(layoutColliders(d).length).toBe(4);
  });
  it('a void room encloses in black', () => {
    const e = enclosureOfIn(parseLevelJson(raw()), 'void')!;
    expect(Object.values(e.walls).every(c => c.every((v: number) => v === 0))).toBe(true);
  });
  it('rejects void with a sky', () => {
    const j = raw(); j.rooms[0].sky = 'night';
    expect(() => parseLevelJson(j)).toThrow(/void rooms have no sky, edge or paths/);
  });
  it('rejects a bad portal target and a portal outside every room', () => {
    const j = raw(); j.portals[0].target = 'The Wake';
    expect(() => parseLevelJson(j)).toThrow(/target must match/);
    const k = raw(); k.portals[0].pos = [0, 0, 50];
    expect(() => parseLevelJson(k)).toThrow(/portal first: outside every room/);
  });
  it('rejects a non-positive portal size', () => {
    const j = raw(); j.portals[0].width = 0;
    expect(() => parseLevelJson(j)).toThrow(/width and height must be > 0/);
  });
  it('spawns may be cultists; unknown kinds are refused', () => {
    const j = raw(); j.spawns = [{ id: 'c', kind: 'cultist', pos: [0, 0, -10], yaw: 0 }];
    expect(parseLevelJson(j).spawns[0]!.kind).toBe('cultist');
    j.spawns[0].kind = 'imp';
    expect(() => parseLevelJson(j)).toThrow(/kind must be zombie, soldier or cultist/);
  });
});
