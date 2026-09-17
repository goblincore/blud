// src/lab/sdf-zombie/webgpu/game-state-gibs.test.ts
//
// The gibs slice is a bag of mutable fields, so there is little logic to test.
// What matters is the contract the codemod leans on: the factory hands out
// private containers (no shared Set/array between calls), the literal boot
// defaults are what game-main.ts declares, and every old binding name resolves
// to a field that actually exists on the state.

import { describe, expect, it } from 'vitest';
import { GIBS_BINDINGS, makeGibsState } from './game-state-gibs';

describe('makeGibsState', () => {
  it('gives each call its own object', () => {
    expect(makeGibsState()).not.toBe(makeGibsState());
  });

  it('gives each call its own nested containers', () => {
    const a = makeGibsState();
    const b = makeGibsState();
    expect(a.blurPrevKeys).not.toBe(b.blurPrevKeys);
    expect(a.pendingGibImpulses).not.toBe(b.pendingGibImpulses);
    expect(a.pendingGibs).not.toBe(b.pendingGibs);
  });

  it('starts at the declared defaults', () => {
    const s = makeGibsState();
    // Literal initializers in game-main.ts: gibOccluderEnabled = true,
    // gibAtlasSource = 'placeholder', gibSpriteAtlasWarned = false, and the
    // nullable handles (gibShutter / gibAtlas / gibAssetMaterial) = null.
    expect(s.occluderEnabled).toBe(true);
    expect(s.atlasSource).toBe('placeholder');
    expect(s.spriteAtlasWarned).toBe(false);
    expect(s.shutter).toBeNull();
    expect(s.atlas).toBeNull();
    expect(s.assetMaterial).toBeNull();
  });

  it('is not a frozen or accessor-backed object', () => {
    const s = makeGibsState();
    s.atlasSource = 'sheet';
    expect(s.atlasSource).toBe('sheet');
    const desc = Object.getOwnPropertyDescriptor(s, 'atlasSource');
    expect(desc?.value).toBe('sheet');
    expect(desc?.get).toBeUndefined();
  });
});

describe('GIBS_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeGibsState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(GIBS_BINDINGS)) {
      expect(path.startsWith('gibs.'), `${oldName} must map into the gibs slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('gibs.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(GIBS_BINDINGS)).toHaveLength(29);
  });
});
