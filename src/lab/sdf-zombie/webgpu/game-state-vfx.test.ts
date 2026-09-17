// src/lab/sdf-zombie/webgpu/game-state-vfx.test.ts
//
// The vfx slice is a bag of mutable fields with no logic of its own, so the
// test pins the contract the codemod leans on: the factory hands out private
// objects (no shared arrays, maps or weak maps), the literal boot defaults are
// exactly what game-main.ts declares, and every old binding name resolves to a
// field that actually exists on the state.

import { describe, expect, it } from 'vitest';
import { VFX_BINDINGS, makeVfxState } from './game-state-vfx';

describe('makeVfxState', () => {
  it('gives each call its own object', () => {
    expect(makeVfxState()).not.toBe(makeVfxState());
  });

  it('gives each call its own nested arrays, maps and weak maps', () => {
    const a = makeVfxState();
    const b = makeVfxState();
    expect(a.explosionLightPool).not.toBe(b.explosionLightPool);
    expect(a.smokePuffs).not.toBe(b.smokePuffs);
    expect(a.spriteBenchSprites).not.toBe(b.spriteBenchSprites);
    expect(a.explosionLights).not.toBe(b.explosionLights);
    expect(a.faceCache).not.toBe(b.faceCache);
    expect(a.gutRopes).not.toBe(b.gutRopes);
    expect(a.woundStreamIds).not.toBe(b.woundStreamIds);
    expect(a.lastSplashShot).not.toBe(b.lastSplashShot);
  });

  it('starts at the declared defaults', () => {
    const s = makeVfxState();
    // Literal initializers in game-main.ts: beamTuning = { gain: 4,
    // shoulder: 0.35, keyFloor: 0 }, woundCullRequested = true,
    // bleedEnabled = true, cook = { phase: 'idle', phaseAt: 0, cookStart: 0 },
    // bleedClock = 0.
    expect(s.beamTuning).toEqual({ gain: 4, shoulder: 0.35, keyFloor: 0 });
    expect(s.woundCullRequested).toBe(true);
    expect(s.bleedEnabled).toBe(true);
    expect(s.cook).toEqual({ phase: 'idle', phaseAt: 0, cookStart: 0 });
    expect(s.bleedClock).toBe(0);
  });

  it('is not a frozen or accessor-backed object', () => {
    const s = makeVfxState();
    s.bleedClock = 7;
    expect(s.bleedClock).toBe(7);
    const desc = Object.getOwnPropertyDescriptor(s, 'bleedClock');
    expect(desc?.value).toBe(7);
    expect(desc?.get).toBeUndefined();
  });
});

describe('VFX_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    // `unknown` first: the interface has no index signature, so a direct cast
    // to Record<string, unknown> is a TS2352 "insufficient overlap" error.
    const s = makeVfxState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(VFX_BINDINGS)) {
      expect(path.startsWith('vfx.'), `${oldName} must map into the vfx slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('vfx.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(VFX_BINDINGS)).toHaveLength(49);
  });
});
