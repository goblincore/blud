// src/sim/runner.test.ts
import { describe, it, expect } from 'vitest';
import { SimRunner } from './runner';
import { EMPTY_INPUT } from './types';

describe('SimRunner heads', () => {
  it('spawns a head and reports interpolated renders that fall under gravity', () => {
    const r = new SimRunner(1);
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
    const r = new SimRunner(2026);
    const start = r.playerStartMeters();
    // Spawn the cultist 1 m diagonally off the player start — same open room,
    // so it stands on walkable floor with clear LOS to the player.
    const sx = start.x + 1, sz = start.z + 1;
    r.spawnDude(sx, sz, 512);
    r.advance(1.5 / 120, () => EMPTY_INPUT);
    const renders = r.dudeRenders();
    expect(renders).toHaveLength(1);
    // One tic ran at most; movement is < ~0.03 m, so position stays near spawn.
    expect(renders[0]!.xMeters).toBeCloseTo(sx, 1);
    expect(renders[0]!.zMeters).toBeCloseTo(sz, 1);
    expect(renders[0]!.health).toBe(40);
  });

  it('playerHp reflects state.player.hp and drops as a cultist fires at the player', () => {
    // Player starts at the generated start cell; spawn a cultist 1.4 m away in
    // the same open room — within hearing (9 m) + fire range (12 m) with clear
    // LOS, mirroring the determinism harness's known-good fire setup.
    const r = new SimRunner(2026);
    const start = r.playerStartMeters();
    r.spawnDude(start.x + 1, start.z + 1, 0);
    expect(r.playerHp()).toBe(100); // full health before contact
    for (let i = 0; i < 300; i++) r.advance(1 / 120, () => EMPTY_INPUT);
    expect(r.playerHp()).toBeLessThan(100); // the cultist acquired + fired + hit
  });
});

describe('SimRunner — generated level', () => {
  it('exposes a floorplan, a non-empty geometry, and spawn points', () => {
    const sim = new SimRunner(0xb1d);
    expect(sim.floorplan().rooms[0]!.kind).toBe('arena');
    expect(sim.spawnPointsMeters().length).toBeGreaterThan(0);
    const start = sim.playerStartMeters();
    expect(Number.isFinite(start.x)).toBe(true);
    expect(Number.isFinite(start.z)).toBe(true);
  });

  it('places the player at the generated start (not the origin)', () => {
    const sim = new SimRunner(0xb1d);
    const r = sim.playerRender();
    const start = sim.playerStartMeters();
    expect(r.xMeters).toBeCloseTo(start.x, 2);
    expect(r.zMeters).toBeCloseTo(start.z, 2);
  });

  it('reroll changes the map fingerprint', () => {
    const sim = new SimRunner(1);
    const before = sim.floorplan();
    sim.reroll(2);
    expect(sim.floorplan().seed).toBe(2);
    expect(sim.floorplan()).not.toBe(before);
  });
});
