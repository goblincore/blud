// src/lab/sdf-zombie/webgpu/game-state-crowd.test.ts
//
// The crowd slice is a bag of mutable fields with no logic of its own, so the
// test pins the contract the codemod leans on: the factory hands out private
// objects (no shared maps or set), the literal boot defaults are exactly what
// game-main.ts declares, and every old binding name resolves to a field that
// exists on the state.

import { describe, expect, it } from 'vitest';
import { CROWD_BINDINGS, makeCrowdState } from './game-state-crowd';

describe('makeCrowdState', () => {
  it('gives each call its own object', () => {
    expect(makeCrowdState()).not.toBe(makeCrowdState());
  });

  it('gives each call its own nested maps and set', () => {
    const a = makeCrowdState();
    const b = makeCrowdState();
    expect(a.types).not.toBe(b.types);
    expect(a.sourceView).not.toBe(b.sourceView);
    expect(a.volumeBound).not.toBe(b.volumeBound);
  });

  it('starts at the declared defaults', () => {
    const s = makeCrowdState();
    // Literal initializers in game-main.ts: crowdFallbackReason = null,
    // crowdSegMetaWarned = false, crowdRefineWarned = false.
    expect(s.fallbackReason).toBeNull();
    expect(s.segMetaWarned).toBe(false);
    expect(s.refineWarned).toBe(false);
  });
});

describe('CROWD_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    // `object` (not `Record<string, unknown>`) so the interface needs no index
    // signature: `toHaveProperty` accepts any object.
    const s: object = makeCrowdState();
    for (const [oldName, path] of Object.entries(CROWD_BINDINGS)) {
      expect(path.startsWith('crowd.'), `${oldName} must map into the crowd slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('crowd.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(CROWD_BINDINGS)).toHaveLength(10);
  });
});
