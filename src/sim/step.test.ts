// src/sim/step.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { EMPTY_INPUT } from './types';
import { buildArenaGeometry } from './geometry';
import { spawnHead } from './head';
import { spawnDude } from './dude';
import { spawnProjectile } from './projectile';
import { fpFromMeters } from './fp';

const GEO = buildArenaGeometry();

describe('createSimState', () => {
  it('starts at tic 0 with a seeded rng and no bodies', () => {
    const s = createSimState(42);
    expect(s.tic).toBe(0);
    expect(s.rng.a).toBe(42);
    expect(s.bodies).toEqual([]);
  });
});

describe('stepSim', () => {
  it('advances the tic counter by one', () => {
    const s = createSimState(1);
    stepSim(s, EMPTY_INPUT, GEO);
    expect(s.tic).toBe(1);
    stepSim(s, EMPTY_INPUT, GEO);
    expect(s.tic).toBe(2);
  });

  it('integrates each body by its velocity (BU/tic)', () => {
    const s = createSimState(1);
    s.bodies.push({ x: 0, y: 100, z: 0, vx: 3, vy: -2, vz: 5 });
    stepSim(s, EMPTY_INPUT, GEO);
    expect(s.bodies[0]).toEqual({ x: 3, y: 98, z: 5, vx: 3, vy: -2, vz: 5 });
    stepSim(s, EMPTY_INPUT, GEO);
    expect(s.bodies[0]).toEqual({ x: 6, y: 96, z: 10, vx: 3, vy: -2, vz: 5 });
  });

  it('returns an array of events (empty in the foundation)', () => {
    const s = createSimState(1);
    const events = stepSim(s, EMPTY_INPUT, GEO);
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(0);
  });

  it('steps and kicks heads inside stepSim', () => {
    const s = createSimState(1);
    spawnHead(s.heads, fpFromMeters(0.3), 0, 0, 0, 0, 0, s.tic);
    // Facing comes from aimYaw (stepPlayer overwrites yaw from input every tic).
    // 1536 -> forward +X (x = -sin(1536) = +1 in the yaw frame).
    stepSim(s, { ...EMPTY_INPUT, aimYaw: 1536 }, GEO);
    expect(s.heads.length).toBe(1);
    expect(s.heads[0]!.vx).toBeGreaterThan(0); // kicked toward +X this tic
  });

  it('steps dudes inside stepSim (idle cultist near the player starts thinking)', () => {
    const s = createSimState(1);
    // Place the cultist a few meters in front of the player so aiThinkTarget runs.
    spawnDude(s.dudes, fpFromMeters(3), fpFromMeters(3), 0, 0);
    // Park the player within sight+hearing radius of the cultist.
    s.player.x = fpFromMeters(4);
    s.player.z = fpFromMeters(4);
    for (let i = 0; i < 50; i++) stepSim(s, EMPTY_INPUT, GEO);
    expect(s.dudes.length).toBe(1);
    // With the player in range and LOS clear, the cultist should have acquired a
    // target (transitioned out of Idle) within a handful of alertChance rolls.
    expect(s.dudes[0]!.hasTarget).toBe(true);
  });
});

describe('explosion-vs-player damage (wired through stepSim)', () => {
  // A dynamite placed at (dx,dz) from the player with a 1-tic fuse + zero
  // velocity detonates on the first stepSim, emitting an `explosion` event that
  // applyExplosionToPlayer consumes. Radius ≈ 4.69 m; falloff = 1 - d/radius;
  // damage = round(240 * falloff).
  function detonateNextToPlayer(distM: number, seed: number): number {
    const s = createSimState(seed);
    s.player.x = fpFromMeters(0);
    s.player.z = fpFromMeters(0);
    // fuse = 1 → detonates on the first stepSim. impactMode false so fuse alone
    // triggers it (no velocity needed to travel away from spawn).
    spawnProjectile(
      s.projectiles, fpFromMeters(distM), 0, 0,
      { vx: 0, vy: 0, vz: 0 }, 1, false, 0,
    );
    stepSim(s, EMPTY_INPUT, GEO);
    return s.player.hp;
  }

  it('a projectile detonating next to the player reduces player.hp (partial, not clamped)', () => {
    // 4 m away: damage = round(240 * (1 - 4/4.6875)) = 35 → hp 100 → 65.
    expect(detonateNextToPlayer(4, 7)).toBe(65);
  });

  it('closer detonations hurt more (falloff is monotonic with distance)', () => {
    expect(detonateNextToPlayer(2, 7)).toBeLessThan(detonateNextToPlayer(4, 7));
  });

  it('a projectile detonating far away leaves player.hp unchanged', () => {
    // 10 m is beyond the ~4.69 m radius → no damage.
    expect(detonateNextToPlayer(10, 7)).toBe(100);
  });

  it('is deterministic: same seed → same hp', () => {
    expect(detonateNextToPlayer(3, 42)).toBe(detonateNextToPlayer(3, 42));
  });
});
