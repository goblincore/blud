// src/lab/sdf-zombie/webgpu/game-state-probes.test.ts
//
// The probes slice is a bag of mutable fields, so there is little logic to
// test. What matters is the contract the codemod leans on: the factory hands
// out private objects (no shared nested arrays), the literal boot defaults are
// what game-main.ts declares, and every old binding name resolves to a field
// that actually exists on the state.

import { describe, expect, it } from 'vitest';
import { PROBES_BINDINGS, makeProbesState } from './game-state-probes';

describe('makeProbesState', () => {
  it('gives each call its own object', () => {
    expect(makeProbesState()).not.toBe(makeProbesState());
  });

  it('gives each call its own nested objects', () => {
    const a = makeProbesState();
    const b = makeProbesState();
    expect(a.capsuleArrays).not.toBe(b.capsuleArrays);
    expect(a.capsuleArrays.ab).not.toBe(b.capsuleArrays.ab);
  });

  it('starts at the declared defaults', () => {
    const s = makeProbesState();
    // Literal initializers in game-main.ts: frame = 0, gatherErrors = 0,
    // flashBoost = 4, gatherRate = 2, gather/pendingGather = null.
    expect(s.frame).toBe(0);
    expect(s.gatherErrors).toBe(0);
    expect(s.flashBoost).toBe(4);
    expect(s.gatherRate).toBe(2);
    expect(s.gather).toBeNull();
    expect(s.pendingGather).toBeNull();
  });
});

describe('PROBES_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeProbesState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(PROBES_BINDINGS)) {
      expect(path.startsWith('probes.'), `${oldName} must map into the probes slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('probes.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(PROBES_BINDINGS)).toHaveLength(24);
  });
});
