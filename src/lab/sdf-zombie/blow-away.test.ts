// src/lab/sdf-zombie/blow-away.test.ts
import { describe, expect, it } from 'vitest';
import { addToVolley, BLOW_AWAY, blowAwayChance, EMPTY_VOLLEY, planBlowAway, type KillVolley } from './blow-away';
import { makeRng } from './wander';
import type { Vec3 } from './types';

const FWD: Vec3 = [0, 0, -1];
const pellets = (n: number, upper = true): KillVolley => {
  let v = EMPTY_VOLLEY;
  for (let i = 0; i < n; i++) v = addToVolley(v, 'pellet', FWD, upper);
  return v;
};

describe('blowAwayChance', () => {
  it('grows with the shotgun group and caps at the pellet chance', () => {
    expect(blowAwayChance(pellets(2))).toBe(0);
    expect(blowAwayChance(pellets(6))).toBeGreaterThan(0);
    expect(blowAwayChance(pellets(6))).toBeLessThan(blowAwayChance(pellets(10)));
    expect(blowAwayChance(pellets(16))).toBeCloseTo(BLOW_AWAY.pellets, 9);
  });

  it('a slug often throws, an explosion always, a leg volley never', () => {
    expect(blowAwayChance(addToVolley(EMPTY_VOLLEY, 'slug', FWD, true))).toBeCloseTo(BLOW_AWAY.slug, 9);
    expect(blowAwayChance(addToVolley(EMPTY_VOLLEY, 'blast', FWD, false))).toBe(1);
    expect(blowAwayChance(pellets(16, false))).toBe(0);
  });

  it('the panel scale multiplies it; 0 turns it off', () => {
    expect(blowAwayChance(pellets(16), { ...BLOW_AWAY, scale: 0 })).toBe(0);
    expect(blowAwayChance(pellets(8), { ...BLOW_AWAY, scale: 2 })).toBeCloseTo(Math.min(1, 2 * blowAwayChance(pellets(8))), 9);
  });
});

describe('range', () => {
  const at = (m: number) => {
    let v = EMPTY_VOLLEY;
    for (let i = 0; i < 14; i++) v = addToVolley(v, 'pellet', FWD, true, m);
    return v;
  };
  it('point blank throws at the full chance; it fades with range and is gone at farM', () => {
    expect(blowAwayChance(at(1.5))).toBeCloseTo(BLOW_AWAY.pellets, 9);
    expect(blowAwayChance(at(5))).toBeGreaterThan(0);
    expect(blowAwayChance(at(5))).toBeLessThan(blowAwayChance(at(3)));
    expect(blowAwayChance(at(BLOW_AWAY.farM))).toBe(0);
  });
  it('the closest round sets the range; a round with no muzzle does not', () => {
    expect(addToVolley(addToVolley(EMPTY_VOLLEY, 'pellet', FWD, true, 6), 'pellet', FWD, true, 2).rangeM).toBe(2);
    expect(blowAwayChance(addToVolley(EMPTY_VOLLEY, 'slug', FWD, true))).toBeCloseTo(BLOW_AWAY.slug, 9);
  });
});

describe('planBlowAway', () => {
  it('throws about as often as the chance says, along the shot with lift', () => {
    const rng = makeRng(7);
    const v = pellets(14);
    let thrown = 0;
    for (let i = 0; i < 400; i++) {
      const t = planBlowAway(v, rng);
      if (t) { thrown++; expect(t.lift).toBeGreaterThan(0); expect(t.tilt).toBeGreaterThan(0); }
    }
    expect(thrown / 400).toBeGreaterThan(BLOW_AWAY.pellets - 0.1);
    expect(thrown / 400).toBeLessThan(BLOW_AWAY.pellets + 0.1);
  });

  it('replays from the same seed', () => {
    const a = makeRng(3), b = makeRng(3);
    const v = addToVolley(EMPTY_VOLLEY, 'slug', FWD, true);
    for (let i = 0; i < 20; i++) expect(planBlowAway(v, a)).toEqual(planBlowAway(v, b));
  });
});
