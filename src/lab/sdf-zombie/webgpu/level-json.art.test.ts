// src/lab/sdf-zombie/webgpu/level-json.art.test.ts
//
// Mesh key §3: the art file and art-shelled rooms.

// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutColliders, layoutSurfaces } from './level-def';
import { parseLevelJson } from './level-json';

const raw = () => JSON.parse(readFileSync('public/assets/levels/fixtures/art-keys.level.json', 'utf8'));

describe('art and shell keys', () => {
  it('parses the art file and an art-shelled room', () => {
    const d = parseLevelJson(raw());
    expect(d.art).toBe('art-keys.art.glb');
    expect(d.rooms[0]!.shell).toBe('art');
    expect(d.requires).toEqual(['art']);
  });
  it('an art shell draws no generated planes or furniture boxes but keeps all collision', () => {
    const d = parseLevelJson(raw());
    expect(layoutSurfaces(d).planes).toEqual([]);
    expect(layoutSurfaces(d).boxes).toEqual([]);
    expect(layoutColliders(d).length).toBe(5);
  });
  it('rooms default to a generated shell; no art key means no art', () => {
    const j = raw(); delete j.art; delete j.rooms[0].shell;
    const d = parseLevelJson(j);
    expect(d.rooms[0]!.shell).toBe('generated'); expect(d.art).toBeNull(); expect(d.requires).toEqual([]);
  });
  it('rejects a bad art file name, an unknown shell, and shell art with void', () => {
    const a = raw(); a.art = '../x.glb';
    expect(() => parseLevelJson(a)).toThrow(/art: must match/);
    const b = raw(); b.rooms[0].shell = 'mesh';
    expect(() => parseLevelJson(b)).toThrow(/shell: generated or art/);
    const c = raw(); c.rooms[0].void = true;
    expect(() => parseLevelJson(c)).toThrow(/art-shelled rooms are not void and have no paths/);
  });
  it('with art, furniture and solids are collision only; without art they draw', () => {
    const j = raw(); j.solids = [{ min: [0.5, 0, -8], max: [1.2, 1, -7] }]; j.rooms[0].shell = 'generated';
    const withArt = parseLevelJson(j);
    expect(layoutSurfaces(withArt).boxes).toEqual([]);
    expect(layoutColliders(withArt).length).toBe(6);
    delete j.art;
    expect(layoutSurfaces(parseLevelJson(j)).boxes).toHaveLength(2);
  });
});
