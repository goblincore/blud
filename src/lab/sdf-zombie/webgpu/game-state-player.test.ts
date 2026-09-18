// src/lab/sdf-zombie/webgpu/game-state-player.test.ts
//
// The player slice is a bag of mutable fields with no logic of its own, so the
// test pins the contract the codemod leans on: the factory hands out private
// objects (no shared sets, arrays or nested motion state), the literal boot
// defaults are exactly what game-main.ts declares, and every old binding name
// resolves to a field that exists on the state.

import { describe, expect, it } from 'vitest';
import { PLAYER_BINDINGS, makePlayerState } from './game-state-player';

describe('makePlayerState', () => {
  it('gives each call its own object', () => {
    expect(makePlayerState()).not.toBe(makePlayerState());
  });

  it('gives each call its own nested sets, arrays and objects', () => {
    const a = makePlayerState();
    const b = makePlayerState();
    expect(a.keys).not.toBe(b.keys);
    expect(a.prevInputKeys).not.toBe(b.prevInputKeys);
    expect(a.prevPlayerPos).not.toBe(b.prevPlayerPos);
    expect(a.currentInputFrame).not.toBe(b.currentInputFrame);
    expect(a.currentInputFrame.keys).not.toBe(b.currentInputFrame.keys);
    expect(a.currentInputFrame.look).not.toBe(b.currentInputFrame.look);
    expect(a.player).not.toBe(b.player);
    expect(a.player.pos).not.toBe(b.player.pos);
    expect(a.player.vel).not.toBe(b.player.vel);
  });

  it('starts at the declared defaults', () => {
    const s = makePlayerState();
    // Literal initializers in game-main.ts: freeAimOn = true,
    // holdPlayerPose = false, bobDistance = 0, strafeDir = 1,
    // reticleEl/marker/autopilot/lastWalkPos = null.
    expect(s.freeAimOn).toBe(true);
    expect(s.holdPlayerPose).toBe(false);
    expect(s.bobDistance).toBe(0);
    expect(s.strafeDir).toBe(1);
    expect(s.reticleEl).toBeNull();
    expect(s.marker).toBeNull();
    expect(s.autopilot).toBeNull();
    expect(s.lastWalkPos).toBeNull();
  });
});

describe('PLAYER_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    // `object` (not `Record<string, unknown>`) so the interface needs no index
    // signature: `toHaveProperty` accepts any object.
    const s: object = makePlayerState();
    for (const [oldName, path] of Object.entries(PLAYER_BINDINGS)) {
      expect(path.startsWith('player.'), `${oldName} must map into the player slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('player.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(PLAYER_BINDINGS)).toHaveLength(20);
  });
});
