// src/lab/sdf-zombie/webgpu/game-state-panels.test.ts
//
// The panels slice is a data shape, so the contract worth pinning is the one
// the codemod relies on: a fresh object per call, the declared defaults, and a
// binding map that covers every old closure name and resolves onto the state.

import { describe, expect, it } from 'vitest';
import { PANELS_BINDINGS, makePanelsState } from './game-state-panels';

describe('makePanelsState', () => {
  it('gives each call its own object', () => {
    expect(makePanelsState()).not.toBe(makePanelsState());
  });

  it('starts at the declared defaults', () => {
    const s = makePanelsState();
    // Three fields whose game-main.ts initializers are literals (`null`).
    expect(s.gooPanel).toBeNull();
    expect(s.impactSplashLayer).toBeNull();
    expect(s.shutterGame).toBeNull();
    // And the two boolean literals.
    expect(s.hidden).toBe(false);
    expect(s.impactSplashEnabled).toBe(false);
  });
});

describe('PANELS_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makePanelsState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(PANELS_BINDINGS)) {
      expect(path.startsWith('panels.'), `${oldName} must map into the panels slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('panels.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(PANELS_BINDINGS)).toHaveLength(9);
  });

  it('renames panelsHidden to the de-prefixed hidden field', () => {
    expect(PANELS_BINDINGS.panelsHidden).toBe('panels.hidden');
  });
});
