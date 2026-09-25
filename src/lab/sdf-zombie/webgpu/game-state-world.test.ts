// src/lab/sdf-zombie/webgpu/game-state-world.test.ts
//
// The world slice is a bag of mutable fields, so there is little logic to
// test. What matters is the contract the codemod leans on: the factory hands
// out private objects (no shared nested arrays, objects or maps), the literal
// world defaults are what game-main.ts declares, and every old binding name
// resolves to a field that actually exists on the state.

import { describe, expect, it } from 'vitest';
import { WORLD_BINDINGS, makeWorldState } from './game-state-world';

describe('makeWorldState', () => {
  it('gives each call its own object', () => {
    expect(makeWorldState()).not.toBe(makeWorldState());
  });

  it('gives each call its own nested arrays, objects and maps', () => {
    const a = makeWorldState();
    const b = makeWorldState();
    expect(a.actors).not.toBe(b.actors);
    expect(a.colliders).not.toBe(b.colliders);
    expect(a.cullCounts).not.toBe(b.cullCounts);
    expect(a.coverage).not.toBe(b.coverage);
    expect(a.sightA).not.toBe(b.sightA);
    expect(a.lastSeenMs).not.toBe(b.lastSeenMs);
    expect(a.encounterHomes).not.toBe(b.encounterHomes);
    expect(a.surfaces).not.toBe(b.surfaces);
    expect(a.surfaces.planes).not.toBe(b.surfaces.planes);
    expect(a.surfaces.boxes).not.toBe(b.surfaces.boxes);
    expect(a.levelLightLists).not.toBe(b.levelLightLists);
    expect(a.levelNodeMaterials).not.toBe(b.levelNodeMaterials);
    expect(a.litChunkMaterials).not.toBe(b.litChunkMaterials);
    expect(a.openGates).not.toBe(b.openGates);
    expect(a.gateMeshes).not.toBe(b.gateMeshes);
  });

  it('starts at the declared defaults', () => {
    const s = makeWorldState();
    // Literal initializers in game-main.ts: actors = [], cullCounts =
    // { visible: 0, total: 0 }, coverage = { screenFrac: 0, nearestM: 0,
    // biggestFrac: 0 }, sightA = [0, 0, 0], levelNodeMaterials = [],
    // soldierCorpses = null, litChunkMaterials = [].
    expect(s.actors).toEqual([]);
    expect(s.cullCounts).toEqual({ visible: 0, total: 0 });
    expect(s.coverage).toEqual({ screenFrac: 0, nearestM: 0, biggestFrac: 0 });
    expect(s.sightA).toEqual([0, 0, 0]);
    expect(s.levelNodeMaterials).toEqual([]);
    expect(s.soldierCorpses).toBeNull();
    expect(s.litChunkMaterials).toEqual([]);
  });
});

describe('WORLD_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeWorldState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(WORLD_BINDINGS)) {
      expect(path.startsWith('world.'), `${oldName} must map into the world slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('world.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(WORLD_BINDINGS)).toHaveLength(27);
  });
});
