// src/lab/sdf-zombie/webgpu/game-state-goo.test.ts
//
// The goo slice is state, so it is tested as state: fresh objects per call,
// the literal game-main defaults, and a binding map that covers every assigned
// binding and points at a field that actually exists.

import { describe, expect, it } from 'vitest';
import { GOO_BINDINGS, makeGooState } from './game-state-goo';

describe('makeGooState', () => {
  it('gives each call its own object', () => {
    expect(makeGooState()).not.toBe(makeGooState());
  });

  it('starts at the declared defaults', () => {
    const s = makeGooState();
    // Literal initializers in game-main.ts: true, 'smooth', false.
    expect(s.enabled).toBe(true);
    expect(s.reconstruction).toBe('smooth');
    expect(s.connectionsEnabled).toBe(false);
    // The remaining literals, for completeness.
    expect(s.layer).toBeNull();
    expect(s.strandsEnabled).toBe(true);
    expect(s.sheetsEnabled).toBe(false);
    // Computed in game-main (`actors[0]?.view`) -> placeholder.
    expect(s.rigView).toBeUndefined();
  });
});

describe('GOO_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeGooState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(GOO_BINDINGS)) {
      expect(path.startsWith('goo.'), `${oldName} must map into the goo slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('goo.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(GOO_BINDINGS)).toHaveLength(7);
  });
});
