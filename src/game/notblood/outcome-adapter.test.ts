import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../rng';
import { buPerTicToMps } from '../gibs/tuning';
import { gibSpawnToMps } from './outcome-adapter';
import { resolveDeathOutcome, KDamage, type GibSpawn } from './death-outcome';
import { KDude } from './notblood-tables.gen';

const ZOMBIE = KDude.kDudeZombieAxeNormal;

// The raw Build xvel FIELD values that spread() emits (death-outcome.ts):
//   spread(field) = (field << 18) / 120
// gibList[15] (gibHuman, the zombie body set) each thing has atc=300, at10=900:
//   horizontal bound: spread(300)  = (300 << 18) / 120 = 655360
//   vertical   bound: spread(900)  = (900 << 18) / 120 = 1966080
// NotBlood MoveThing (actor.cpp:4429) integrates sprite position by xvel>>12
// (ClipMove at actor.cpp:4449/4460/4464), so true BU/tic = field / 4096. The
// adapter therefore descales by /4096 THEN applies buPerTicToMps (×120/256):
//   655360  / 4096 = 160  BU/tic → ×120/256 =  75 m/s  (horizontal bound)
//   1966080 / 4096 = 480  BU/tic → ×120/256 = 225 m/s  (vertical bound)

describe('gibSpawnToMps', () => {
  it('pins the corrected /4096 MoveThing-integration descale: horizontal 655360 → 75 m/s', () => {
    // spread(300) = 655360 is the Random2 horizontal bound for a gibHuman chunk.
    // Descaled: /4096 = 160 BU/tic → ×120/256 = 75 m/s (within 1e-6).
    const mps = gibSpawnToMps({ tile: 1454, vx: 655360, vy: -655360, vz: 0 });
    expect(mps.vx).toBeCloseTo(75, 6);
    expect(mps.vy).toBeCloseTo(-75, 6); // sign preserved (adapter is pure unit conversion)
    expect(mps.vz).toBeCloseTo(0, 6);
    expect(mps.tile).toBe(1454);
  });

  it('pins the corrected /4096 MoveThing-integration descale: vertical 1966080 → 225 m/s', () => {
    // spread(900) = 1966080 is the Random vertical bound for a gibHuman chunk.
    // Descaled: /4096 = 480 BU/tic → ×120/256 = 225 m/s. (The adapter preserves
    // the raw field sign; gibSpawns emit vz = -random(...) so upward = negative,
    // but here we test the unit conversion on the raw positive magnitude.)
    const up = gibSpawnToMps({ tile: 1267, vx: 0, vy: 0, vz: 1966080 });
    expect(up.vz).toBeCloseTo(225, 6);
    const down = gibSpawnToMps({ tile: 1267, vx: 0, vy: 0, vz: -1966080 });
    expect(down.vz).toBeCloseTo(-225, 6);
  });

  it('equals buPerTicToMps(field / 4096) componentwise (the /4096 MoveThing fix)', () => {
    // The conversion is now: buPerTicToMps(spawn.v? / 4096) on each axis — the
    // ONLY unit conversion in the pipeline, after the MoveThing xvel>>12 descale.
    const field = 655360;
    const mps = gibSpawnToMps({ tile: 1454, vx: field, vy: -field, vz: field * 3 });
    expect(mps.vx).toBeCloseTo(buPerTicToMps(field / 4096), 6);
    expect(mps.vy).toBeCloseTo(buPerTicToMps(-field / 4096), 6);
    expect(mps.vz).toBeCloseTo(buPerTicToMps((field * 3) / 4096), 6);
  });

  it('matches buPerTicToMps(field / 4096) on every real explosion-outcome spawn', () => {
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 240, isCorpse: false, rng: mulberry32(1) });
    expect(o.gibSpawns.length).toBeGreaterThan(0);
    for (const spawn of o.gibSpawns) {
      const mps = gibSpawnToMps(spawn);
      expect(mps.tile).toBe(spawn.tile);
      expect(mps.vx).toBeCloseTo(buPerTicToMps(spawn.vx / 4096), 6);
      expect(mps.vy).toBeCloseTo(buPerTicToMps(spawn.vy / 4096), 6);
      expect(mps.vz).toBeCloseTo(buPerTicToMps(spawn.vz / 4096), 6);
    }
  });

  it('real explosion gibSpawns fall in the source-faithful speed envelope (no more ~300 km/s)', () => {
    // Regression guard for the unit bug: pre-fix, gibSpawnToMps yielded ~300 km/s
    // because it skipped the /4096. After the fix, every gibHuman chunk stays
    // within the spread bounds: |v_horizontal| < 75 m/s, vz ∈ (-225, 0] (upward).
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 240, isCorpse: false, rng: mulberry32(7) });
    for (const spawn of o.gibSpawns) {
      const mps = gibSpawnToMps(spawn);
      expect(Math.abs(mps.vx)).toBeLessThan(75 + 1e-6);
      expect(Math.abs(mps.vy)).toBeLessThan(75 + 1e-6);
      expect(mps.vz).toBeLessThanOrEqual(1e-6);   // upward only (vz ≤ 0 raw)
      expect(mps.vz).toBeGreaterThan(-225 - 1e-6);
    }
  });

  it('preserves the zero vector exactly', () => {
    const zero = gibSpawnToMps({ tile: 0, vx: 0, vy: 0, vz: 0 });
    expect(zero).toEqual({ tile: 0, vx: 0, vy: 0, vz: 0 });
  });
});
