// src/lab/sdf-zombie/webgpu/game-state-bake.test.ts
//
// The bake slice is a bag of mutable fields, so there is little logic to test.
// What matters is the contract the codemod leans on: the factory hands out
// private objects (no shared arrays or rig), the literal boot defaults are what
// game-main.ts declares, and every old binding name resolves to a field that
// actually exists on the state.

import { describe, expect, it } from 'vitest';
import { BAKE_BINDINGS, makeBakeState } from './game-state-bake';

describe('makeBakeState', () => {
  it('gives each call its own object', () => {
    expect(makeBakeState()).not.toBe(makeBakeState());
  });

  it('gives each call its own arrays and rig', () => {
    const a = makeBakeState();
    const b = makeBakeState();
    expect(a.chunks).not.toBe(b.chunks);
    expect(a.views).not.toBe(b.views);
    expect(a.spareViews).not.toBe(b.spareViews);
    expect(a.liveChunks).not.toBe(b.liveChunks);
    expect(a.bundleProps).not.toBe(b.bundleProps);
    expect(a.spareBundles).not.toBe(b.spareBundles);
    expect(a.liveBundles).not.toBe(b.liveBundles);
    expect(a.bundleRig).not.toBe(b.bundleRig);
  });

  it('starts at the declared defaults', () => {
    const s = makeBakeState();
    // Literal initializers in game-main.ts: bakedChunkReference = false,
    // bakedChunks = [], totalBakes/lastBakeMs/carvedBuildMs = 0,
    // bakeSubmitFrame/lastBakeSwapFrame = -1, nextChunkId = 1,
    // chunksHidden = false, bundleReady = false.
    expect(s.reference).toBe(false);
    expect(s.chunks).toEqual([]);
    expect(s.totalBakes).toBe(0);
    expect(s.lastBakeMs).toBe(0);
    expect(s.carvedBuildMs).toBe(0);
    expect(s.submitFrame).toBe(-1);
    expect(s.lastSwapFrame).toBe(-1);
    expect(s.nextId).toBe(1);
    expect(s.hidden).toBe(false);
    expect(s.bundleReady).toBe(false);
  });
});

describe('BAKE_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeBakeState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(BAKE_BINDINGS)) {
      expect(path.startsWith('bake.'), `${oldName} must map into the bake slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('bake.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(BAKE_BINDINGS)).toHaveLength(33);
  });
});
