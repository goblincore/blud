import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../rng';
import { buPerTicToMps } from '../gibs/tuning';
import { gibSpawnToMps } from './outcome-adapter';
import { resolveDeathOutcome, KDamage, type GibSpawn } from './death-outcome';
import { KDude } from './notblood-tables.gen';

const ZOMBIE = KDude.kDudeZombieAxeNormal;

describe('gibSpawnToMps', () => {
  it('converts 1 BU/tic on every axis via the × 120 / 256 factor (tile passthrough)', () => {
    // 1 BU/tic × 120 / 256 = 0.46875 m/s — the canonical conversion factor,
    // matching buPerTicToMps(1).
    const mps = gibSpawnToMps({ tile: 1454, vx: 1, vy: 1, vz: -1 });
    expect(mps.tile).toBe(1454); // tile unchanged
    expect(mps.vx).toBeCloseTo(0.46875, 5);
    expect(mps.vy).toBeCloseTo(0.46875, 5);
    expect(mps.vz).toBeCloseTo(-0.46875, 5); // sign preserved (Build -z = up)
  });

  it('a known GIBTHING velocity converts to the expected m/s vector', () => {
    // A plausible gibHuman chunk launch (gibList[15], tile 1454) at known
    // BU/tic velocities. m/s = BU/tic × 120 / 256:
    //   100 → 46.875,  200 → 93.75,  -300 → -140.625
    const spawn: GibSpawn = { tile: 1454, vx: 100, vy: 200, vz: -300 };
    const mps = gibSpawnToMps(spawn);
    expect(mps.vx).toBeCloseTo(buPerTicToMps(100), 6);
    expect(mps.vy).toBeCloseTo(buPerTicToMps(200), 6);
    expect(mps.vz).toBeCloseTo(buPerTicToMps(-300), 6);
    expect(mps.vx).toBeCloseTo(46.875, 3);
    expect(mps.vy).toBeCloseTo(93.75, 3);
    expect(mps.vz).toBeCloseTo(-140.625, 3);
    expect(mps.tile).toBe(1454);
  });

  it('matches buPerTicToMps applied componentwise (the edge = pure unit conversion)', () => {
    // Every spawn from a real explosion outcome converts via buPerTicToMps on
    // each component with no other transformation — this is the only unit
    // conversion in the pipeline.
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 240, isCorpse: false, rng: mulberry32(1) });
    expect(o.gibSpawns.length).toBeGreaterThan(0);
    for (const spawn of o.gibSpawns) {
      const mps = gibSpawnToMps(spawn);
      expect(mps.tile).toBe(spawn.tile);
      expect(mps.vx).toBeCloseTo(buPerTicToMps(spawn.vx), 6);
      expect(mps.vy).toBeCloseTo(buPerTicToMps(spawn.vy), 6);
      expect(mps.vz).toBeCloseTo(buPerTicToMps(spawn.vz), 6);
    }
  });

  it('preserves the zero vector and negative velocities exactly', () => {
    const zero = gibSpawnToMps({ tile: 0, vx: 0, vy: 0, vz: 0 });
    expect(zero).toEqual({ tile: 0, vx: 0, vy: 0, vz: 0 });
    const neg = gibSpawnToMps({ tile: 1267, vx: -50, vy: -50, vz: -50 });
    expect(neg.vx).toBeCloseTo(buPerTicToMps(-50), 6);
    expect(neg.vy).toBe(neg.vx); // symmetric
    expect(neg.vz).toBe(neg.vx);
  });
});
