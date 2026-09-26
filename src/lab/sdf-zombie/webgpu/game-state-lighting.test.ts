// src/lab/sdf-zombie/webgpu/game-state-lighting.test.ts
//
// The lighting slice is a bag of mutable fields with no logic of its own, so
// the test pins the contract the codemod leans on: the factory hands out
// private objects (no shared arrays or maps), the literal boot defaults are
// exactly what game-main.ts declares, and every old binding name resolves to a
// field that exists on the state.

import { describe, expect, it } from 'vitest';
import { LIGHTING_BINDINGS, makeLightingState } from './game-state-lighting';

describe('makeLightingState', () => {
  it('gives each call its own object', () => {
    expect(makeLightingState()).not.toBe(makeLightingState());
  });

  it('gives each call its own nested arrays and maps', () => {
    const a = makeLightingState();
    const b = makeLightingState();
    expect(a.flickerLights).not.toBe(b.flickerLights);
    expect(a.levelProbeNodes).not.toBe(b.levelProbeNodes);
  });

  it('starts at the declared defaults', () => {
    const s = makeLightingState();
    // Literal initializers in game-main.ts: dungeonOn = true,
    // bodyFlashGain = 0.06, lightClockFrozen = false,
    // flickerClockFrozenAt = 0, levelProbeGain = -1.
    expect(s.dungeonOn).toBe(true);
    expect(s.bodyFlashGain).toBe(0.06);
    expect(s.clockFrozen).toBe(false);
    expect(s.flickerClockFrozenAt).toBe(0);
    expect(s.levelProbeGain).toBe(-1);
  });
});

describe('LIGHTING_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    // `object` (not `Record<string, unknown>`) so the interface needs no index
    // signature: `toHaveProperty` accepts any object.
    const s: object = makeLightingState();
    for (const [oldName, path] of Object.entries(LIGHTING_BINDINGS)) {
      expect(path.startsWith('lighting.'), `${oldName} must map into the lighting slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('lighting.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(LIGHTING_BINDINGS)).toHaveLength(22);
  });
});
