// src/sim/runner.test.ts
import { describe, it, expect } from 'vitest';
import { SimRunner } from './runner';
import { EMPTY_INPUT } from './types';

describe('SimRunner heads', () => {
  it('spawns a head and reports interpolated renders that fall under gravity', () => {
    const r = new SimRunner(1, 0, 0);
    r.spawnHead(0, 5, 0, 0, 0, 0); // 5 m up, no initial velocity
    // Advance by a fractional tic so the accumulator retains a remainder (alpha > 0).
    // A whole-tic advance leaves alpha=0, which renders the prev position (5 m);
    // the head has fallen in `cur` but isn't visible until alpha > 0.
    r.advance(1.5 / 120, () => EMPTY_INPUT);
    const renders = r.headRenders();
    expect(renders).toHaveLength(1);
    expect(renders[0]!.yMeters).toBeLessThan(5); // gravity pulled it down a touch
  });
});

describe('SimRunner dudes', () => {
  it('spawnDude + advance + dudeRenders returns the spawned cultist', () => {
    const r = new SimRunner(1, 0, 0);
    r.spawnDude(3, 3, 512);
    r.advance(1.5 / 120, () => EMPTY_INPUT);
    const renders = r.dudeRenders();
    expect(renders).toHaveLength(1);
    // One tic ran at most; movement is < ~0.03 m, so position stays near spawn (3,3).
    expect(renders[0]!.xMeters).toBeCloseTo(3, 1);
    expect(renders[0]!.zMeters).toBeCloseTo(3, 1);
    expect(renders[0]!.health).toBe(40);
  });

  it('playerHp reflects state.player.hp and drops as a cultist fires at the player', () => {
    // Mirrors the determinism harness's known-good fire setup: player parked at
    // (4,4), cultist at (3,3) — well within hear/fire range with clear LOS.
    const r = new SimRunner(2026, 4, 4);
    r.spawnDude(3, 3, 0);
    expect(r.playerHp()).toBe(100); // full health before contact
    for (let i = 0; i < 300; i++) r.advance(1 / 120, () => EMPTY_INPUT);
    expect(r.playerHp()).toBeLessThan(100); // the cultist acquired + fired + hit
  });
});
