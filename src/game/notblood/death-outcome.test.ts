import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../rng';
import { resolveDeathOutcome, KDamage } from './death-outcome';
import { KDude } from './notblood-tables.gen';

const ZOMBIE = KDude.kDudeZombieAxeNormal;

describe('resolveDeathOutcome', () => {
  it('explosion ≥160 damage → gib with body chunks + head', () => {
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 240, isCorpse: false, rng: mulberry32(1) });
    expect(o.gibbed).toBe(true);
    expect(o.gibSpawns.length).toBeGreaterThan(0);     // gibHuman chunks
    expect(o.spawnsHead).toBe(true);                   // GIBTYPE_27 head
    expect(o.becomesCorpse).toBe(false);
  });

  it('explosion <160 damage → converted to fall (no gib, intact corpse)', () => {
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 120, isCorpse: false, rng: mulberry32(1) });
    expect(o.gibbed).toBe(false);
    expect(o.damageTypeResolved).toBe(KDamage.kDamageFall);
    expect(o.becomesCorpse).toBe(true);
  });

  it('corpse re-gib bursts unconditionally (no threshold), no head', () => {
    const o = resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 10, isCorpse: true, rng: mulberry32(1) });
    expect(o.gibbed).toBe(true);
    expect(o.spawnsHead).toBe(false);
  });

  it('normal death head-pop fires ~25% (seeded, deterministic)', () => {
    let pops = 0;
    for (let s = 0; s < 400; s++) {
      const o = resolveDeathOutcome(
        { dudeType: ZOMBIE, damageType: KDamage.kDamageBullet, damage: 50, isCorpse: false, rng: mulberry32(s) });
      if (o.headPop) pops++;
    }
    expect(pops / 400).toBeGreaterThan(0.18);
    expect(pops / 400).toBeLessThan(0.32);
  });
});

describe('resolveDeathOutcome — DeathOutcomeConfig (Blud deviations)', () => {
  const burnInput = (rng = mulberry32(1)) => ({
    dudeType: ZOMBIE, damageType: KDamage.kDamageBurn, damage: 50, isCorpse: false, rng,
  });

  it('default (omitted config) is source-faithful: burn death never pops a head', () => {
    // deathSeq(kDamageBurn) === 3 → no head-pop path in source.
    for (let s = 0; s < 200; s++) {
      const o = resolveDeathOutcome(
        { dudeType: ZOMBIE, damageType: KDamage.kDamageBurn, damage: 50, isCorpse: false, rng: mulberry32(s) });
      expect(o.headPop).toBe(false);
    }
  });

  it('burnHeadChance: 0.5 → burn death head-pop fires ~50%', () => {
    let pops = 0;
    const N = 400;
    for (let s = 0; s < N; s++) {
      const o = resolveDeathOutcome(burnInput(mulberry32(s)), { burnHeadChance: 0.5 });
      if (o.headPop) pops++;
    }
    expect(pops / N).toBeGreaterThan(0.40);
    expect(pops / N).toBeLessThan(0.60);
  });

  it('burnHeadChance: 1 → burn death ALWAYS pops a head', () => {
    for (let s = 0; s < 50; s++) {
      const o = resolveDeathOutcome(burnInput(mulberry32(s)), { burnHeadChance: 1 });
      expect(o.headPop).toBe(true);
    }
  });

  it('config alters ONLY the burn head-pop — non-burn normal death is unchanged', () => {
    // Bullet death head-pop stays source-faithful (~25%) regardless of config.
    // Each call gets a fresh rng seeded with `s`: for a bullet death both paths
    // draw `chance(rng, 0x4000)` exactly once (config adds no burn draw since
    // damageTypeResolved !== kDamageBurn), so identical seed ⇒ identical result.
    let popsWithCfg = 0;
    let popsDefault = 0;
    const mk = (s: number) => ({
      dudeType: ZOMBIE, damageType: KDamage.kDamageBullet, damage: 50, isCorpse: false, rng: mulberry32(s),
    });
    for (let s = 0; s < 400; s++) {
      if (resolveDeathOutcome(mk(s)).headPop) popsDefault++;
      if (resolveDeathOutcome(mk(s), { burnHeadChance: 0.5 }).headPop) popsWithCfg++;
    }
    expect(popsWithCfg).toBe(popsDefault); // identical draws → identical counts
    expect(popsWithCfg / 400).toBeGreaterThan(0.18);
    expect(popsWithCfg / 400).toBeLessThan(0.32);
  });

  it('config does not alter explosion / corpse outcomes', () => {
    // Explosion gib outcome is identical with or without config.
    const explode = (cfg?: Parameters<typeof resolveDeathOutcome>[1]) => resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 240, isCorpse: false, rng: mulberry32(1) }, cfg);
    const a = explode();
    const b = explode({ burnHeadChance: 0.5 });
    expect(b.gibbed).toBe(a.gibbed);
    expect(b.spawnsHead).toBe(a.spawnsHead);
    expect(b.becomesCorpse).toBe(a.becomesCorpse);
    expect(b.gibSpawns.length).toBe(a.gibSpawns.length);
    expect(b.gibSpawns).toEqual(a.gibSpawns);

    // Corpse re-gib is identical with or without config.
    const corpse = (cfg?: Parameters<typeof resolveDeathOutcome>[1]) => resolveDeathOutcome(
      { dudeType: ZOMBIE, damageType: KDamage.kDamageExplode, damage: 10, isCorpse: true, rng: mulberry32(1) }, cfg);
    expect(corpse({ burnHeadChance: 0.5 })).toEqual(corpse());
  });

  it('burnHeadChance: 0 is identical to omitted config', () => {
    const explicit = resolveDeathOutcome(burnInput(mulberry32(7)), { burnHeadChance: 0 });
    const omitted = resolveDeathOutcome(burnInput(mulberry32(7)));
    expect(explicit).toEqual(omitted);
  });
});
