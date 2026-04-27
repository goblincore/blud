import { describe, it, expect, vi } from 'vitest';
import { LaunchedCorpseManager, LAUNCHED_CORPSE } from './launched-corpse';

describe('LAUNCHED_CORPSE tuning', () => {
  it('has expected values', () => {
    expect(LAUNCHED_CORPSE.impulseThreshold).toBe(8.0);
    expect(LAUNCHED_CORPSE.linearDamping).toBe(0.1);
    expect(LAUNCHED_CORPSE.angularDamping).toBe(0.3);
    expect(LAUNCHED_CORPSE.restingVelocityMps).toBe(0.2);
    expect(LAUNCHED_CORPSE.settleFrames).toBe(60);
    expect(LAUNCHED_CORPSE.spriteScale).toBe(1.5);
    expect(LAUNCHED_CORPSE.minAgeSec).toBe(0.5);
    expect(LAUNCHED_CORPSE.maxAgeSec).toBe(15.0);
  });

  it('impulseThreshold is above typical falloff but below point-blank explosion', () => {
    // At point-blank, EXPLOSION_STANDARD impulse = 900 * 1.0 = 900.
    // LAUNCHED_CORPSE threshold = 8.0 — easily met at close range.
    expect(LAUNCHED_CORPSE.impulseThreshold).toBeGreaterThan(0);
    expect(LAUNCHED_CORPSE.impulseThreshold).toBeLessThan(900);
  });

  it('settleFrames gives ~1 second at 60fps', () => {
    expect(LAUNCHED_CORPSE.settleFrames / 60).toBeCloseTo(1.0, 1);
  });
});

describe('LaunchedCorpseManager', () => {
  it('starts empty', () => {
    const mgr = new LaunchedCorpseManager();
    expect(mgr.aliveCount()).toBe(0);
  });

  it('clear is a no-op on empty manager', () => {
    const mgr = new LaunchedCorpseManager();
    // Should not throw
    mgr.clear({ world: {} as any, scene: {} as any, getTileTexture: () => null });
    expect(mgr.aliveCount()).toBe(0);
  });
});
