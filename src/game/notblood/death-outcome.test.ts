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
