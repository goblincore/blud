import { describe, expect, it } from 'vitest';
import { BLAST_PROFILES, blastFalloffFor, blastToPlayer, playerBlastDamage } from './blast-player';
import { ROCKET, blastPlayerDamage } from './rockets';

describe('playerBlastDamage', () => {
  it('is the rocket rule exactly with the rocket numbers', () => {
    const rocket = { maxDamage: ROCKET.blastPlayerDamage, radiusM: ROCKET.blastPlayerRadius };
    for (let d = 0; d <= 4; d += 0.05) expect(playerBlastDamage(d, rocket)).toBe(blastPlayerDamage(d));
  });
  it('a barrel: 55 at the centre, quadratic, 0 from 4 m', () => {
    expect(playerBlastDamage(0, BLAST_PROFILES.barrel)).toBe(55);
    expect(playerBlastDamage(2, BLAST_PROFILES.barrel)).toBe(Math.round(55 * 0.25));
    expect(playerBlastDamage(4, BLAST_PROFILES.barrel)).toBe(0);
    expect(blastFalloffFor(9, BLAST_PROFILES.barrel)).toBe(0);
  });
  it('measures to the capsule centre', () => {
    expect(blastToPlayer([0, 1, 0], [3, 0, 4], 2)).toBe(5);
    // a blast at the feet: the centre rule gives √26 (the capsule's nearest point would give 5)
    expect(blastToPlayer([0, 0, 0], [3, 0, 4], 2)).toBeCloseTo(Math.sqrt(26), 12);
  });
});
