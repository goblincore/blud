// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-flashlight-toggle.test.ts
//
// The F key toggles the flashlight, but only once the player has it: a level with a flashlight pickup (Night Train's coat-check) starts it
// dark and unowned, and the key must not skip that; a level without one starts it on and owned.

import { describe, expect, it } from 'vitest';
import { switchOnFlashlight, toggleFlashlight } from './game-dynamic-light';
import type { GameContext } from './game-context';

function fakeCtx(f: { level: number; target: number; owned: boolean }, time = 5) {
  const shadow = () => ({ shadow: { autoUpdate: false } });
  const rt = { time, flashlight: { base: 90, level: f.level, target: f.target, since: -1, owned: f.owned } };
  const ctx = { world: { light: rt }, lighting: { flashlight: { spot: shadow(), levelShadow: shadow() } } } as unknown as GameContext;
  return { ctx, fl: rt.flashlight };
}

describe('toggleFlashlight', () => {
  it('does nothing before the flashlight is owned (the pickup is not skipped)', () => {
    const { ctx, fl } = fakeCtx({ level: 0, target: 0, owned: false });
    toggleFlashlight(ctx);
    expect(fl.target).toBe(0);
    expect(fl.level).toBe(0);
  });

  it('turns an owned, lit flashlight off at once', () => {
    const { ctx, fl } = fakeCtx({ level: 1, target: 1, owned: true });
    toggleFlashlight(ctx);
    expect(fl.target).toBe(0);
    expect(fl.level).toBe(0);
  });

  it('turns an owned, dark flashlight on with the stuttering ramp (since = the light clock)', () => {
    const { ctx, fl } = fakeCtx({ level: 0, target: 0, owned: true }, 7.5);
    toggleFlashlight(ctx);
    expect(fl.target).toBe(1);
    expect(fl.since).toBe(7.5);
  });

  it('picking the flashlight up owns it, so the key then works', () => {
    const { ctx, fl } = fakeCtx({ level: 0, target: 0, owned: false });
    switchOnFlashlight(ctx);
    expect(fl.owned).toBe(true);
    toggleFlashlight(ctx);
    expect(fl.target).toBe(0);
  });

  it('is a no-op on a level with no dynamic light runtime', () => {
    const ctx = { world: { light: null } } as unknown as GameContext;
    expect(() => toggleFlashlight(ctx)).not.toThrow();
  });
});
