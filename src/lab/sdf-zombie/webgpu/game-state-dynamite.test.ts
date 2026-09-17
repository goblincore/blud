// src/lab/sdf-zombie/webgpu/game-state-dynamite.test.ts
//
// The dynamite slice is a bag of mutable fields with no logic of its own, so
// the test pins the contract the codemod leans on: the factory hands out
// private objects (no shared arrays), the literal boot defaults are exactly what
// game-main.ts declares, and every old binding name resolves to a field that
// exists on the state.

import { describe, expect, it } from 'vitest';
import { DYNAMITE_BINDINGS, makeDynamiteState } from './game-state-dynamite';

describe('makeDynamiteState', () => {
  it('gives each call its own object', () => {
    expect(makeDynamiteState()).not.toBe(makeDynamiteState());
  });

  it('gives each call its own nested arrays', () => {
    const a = makeDynamiteState();
    const b = makeDynamiteState();
    expect(a.gibTierLog).not.toBe(b.gibTierLog);
    expect(a.lastGibParts).not.toBe(b.lastGibParts);
  });

  it('starts at the declared defaults', () => {
    const s = makeDynamiteState();
    // Literal initializers in game-main.ts: dynNow = 0, dynPress = false,
    // dynRelease = false, dynLastGibTier = 'parts', dynGibTierLog = [].
    expect(s.now).toBe(0);
    expect(s.press).toBe(false);
    expect(s.release).toBe(false);
    expect(s.lastGibTier).toBe('parts');
    expect(s.gibTierLog).toEqual([]);
  });
});

describe('DYNAMITE_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    // `object` (not `Record<string, unknown>`) so the interface needs no index
    // signature: `toHaveProperty` accepts any object.
    const s: object = makeDynamiteState();
    for (const [oldName, path] of Object.entries(DYNAMITE_BINDINGS)) {
      expect(path.startsWith('dynamite.'), `${oldName} must map into the dynamite slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('dynamite.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(DYNAMITE_BINDINGS)).toHaveLength(21);
  });
});
