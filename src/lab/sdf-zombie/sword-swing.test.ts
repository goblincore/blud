// src/lab/sdf-zombie/sword-swing.test.ts
import { describe, it, expect } from 'vitest';
import { makeBrain, stepBrain, BRAIN_TUNING, type Brain, type BrainTuning } from './brain';
import {
  SWORD_TUNING, SWORD_KEYS, swordCarryAt, lungeAdvance, swordContact, isSwordVariant, SWORD_CONTACT,
  jawGapeAt, JAW_GAPE,
} from './sword-swing';
import { ATTACK_TUNING } from './attack';
import type { CarrySpec } from './carry';

const TEST_TUNING: BrainTuning = {
  ...BRAIN_TUNING,
  meleeRadius: 1.8,
  engageRange: 3.2,
  releaseRange: 3.8,
  lungeBand: { min: 2.2, max: 3.1 },
  pickVariant: (roll) => (roll < 0.5 ? 'cleave' : 'sweep'),
  swingSecFor: { cleave: 1.25, sweep: 0.9, lunge: 1.0 },
};

/** Step an alert brain holding a token, player at `dist` m straight ahead. */
function swingAt(dist: number, roll: number) {
  let brain: Brain = { ...makeBrain(), alert: true, state: 'engage' };
  const out = stepBrain(brain, {
    dt: 1 / 60, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: dist, room: 1 },
    alerted: false, hasToken: true, drift: 0, roll,
  }, TEST_TUNING);
  brain = out.brain;
  return out;
}

describe('BrainTuning — sword extensions', () => {
  it('picks the variant through pickVariant inside reach', () => {
    expect(swingAt(1.5, 0.2).attack?.variant).toBe('cleave');
    expect(swingAt(1.5, 0.8).attack?.variant).toBe('sweep');
  });

  it('lunges inside the lunge band, beyond reach', () => {
    expect(swingAt(2.6, 0.2).attack?.variant).toBe('lunge');
  });

  it('does not swing outside both', () => {
    expect(swingAt(3.15, 0.2).attack).toBeNull();
  });

  it('times the swing by swingSecFor', () => {
    let out = swingAt(1.5, 0.2);        // cleave starts, phase 0
    out = stepBrain(out.brain, {
      dt: 0.625, self: { x: 0, z: 0, yaw: 0, room: 1 }, player: { x: 0, z: 1.5, room: 1 },
      alerted: false, hasToken: true, drift: 0, roll: 0.2,
    }, TEST_TUNING);
    expect(out.attack?.phase).toBeCloseTo(0.5, 5); // 0.625 / 1.25
  });
});

const GUARD: CarrySpec = { right: { pitch: 1.9, yaw: 0.3, fold: 1.6 }, gunPitch: 0.6, leftPole: [0.5, -0.3, 0.2] };

describe('swordCarryAt — the phase-keyed carry track', () => {
  it('starts and ends EXACTLY on the guard (no step into or out of the gait)', () => {
    for (const v of ['cleave', 'sweep', 'lunge'] as const) {
      expect(swordCarryAt(0, v, GUARD)).toEqual(GUARD);
      expect(swordCarryAt(1, v, GUARD)).toEqual(GUARD);
    }
  });

  it('hits the wind-up key at windupEnd and the strike key through the hold', () => {
    const w = swordCarryAt(ATTACK_TUNING.windupEnd, 'cleave', GUARD);
    expect(w.right).toEqual(SWORD_KEYS.cleave.windup.arm);
    const s = swordCarryAt((ATTACK_TUNING.strikeEnd + ATTACK_TUNING.holdEnd) / 2, 'cleave', GUARD);
    expect(s.right).toEqual(SWORD_KEYS.cleave.strike.arm);
    expect(s.gunPitch).toBe(SWORD_KEYS.cleave.strike.gunPitch);
  });

  it('is continuous: no angle jumps more than 0.35 rad between 1% phase steps', () => {
    for (const v of ['cleave', 'sweep', 'lunge'] as const) {
      let prev = swordCarryAt(0, v, GUARD);
      for (let i = 1; i <= 100; i++) {
        const cur = swordCarryAt(i / 100, v, GUARD);
        for (const k of ['pitch', 'yaw', 'fold'] as const)
          expect(Math.abs(cur.right[k] - prev.right[k]), `${v} ${k} @${i}`).toBeLessThan(0.35);
        prev = cur;
      }
    }
  });

  it('keeps the sword two-handed (never oneHanded) and the guard pole', () => {
    const s = swordCarryAt(0.4, 'sweep', GUARD);
    expect(s.oneHanded).toBeUndefined();
    expect(s.leftPole).toEqual(GUARD.leftPole);
  });

  it('cleave strikes DOWN: strike pitch below wind-up pitch', () => {
    expect(SWORD_KEYS.cleave.strike.arm.pitch).toBeLessThan(SWORD_KEYS.cleave.windup.arm.pitch);
  });

  it('sweep crosses the body: yaw changes sign from wind-up to strike', () => {
    expect(Math.sign(SWORD_KEYS.sweep.windup.arm.yaw)).not.toBe(Math.sign(SWORD_KEYS.sweep.strike.arm.yaw));
  });
});

describe('lungeAdvance', () => {
  it('sums to the full lunge distance over a swing when the player is far', () => {
    let total = 0, prev = 0;
    for (let i = 1; i <= 120; i++) { const p = i / 120; total += lungeAdvance(prev, p, 10); prev = p; }
    expect(total).toBeCloseTo(SWORD_TUNING.lungeDistance, 3);
  });

  it('moves only between windupEnd and strikeEnd', () => {
    expect(lungeAdvance(0, ATTACK_TUNING.windupEnd, 10)).toBe(0);
    expect(lungeAdvance(ATTACK_TUNING.strikeEnd, 1, 10)).toBe(0);
  });

  it('stops short of the player', () => {
    expect(lungeAdvance(ATTACK_TUNING.windupEnd, ATTACK_TUNING.strikeEnd, 1.2))
      .toBeCloseTo(1.2 - SWORD_TUNING.lungeStopShort, 6);
    expect(lungeAdvance(ATTACK_TUNING.windupEnd, ATTACK_TUNING.strikeEnd, 0.5)).toBe(0);
  });
});

describe('swordContact', () => {
  const self = { x: 0, z: 0, yaw: 0 };
  const hitPhase = SWORD_CONTACT.phase.cleave;

  it('fires exactly once, on the frame the phase crosses the hit instant', () => {
    let fired = 0, prev = 0;
    for (let i = 1; i <= 100; i++) {
      const p = i / 100;
      if (swordContact({ prevPhase: prev, phase: p, variant: 'cleave', self, player: { x: 0, z: 1.5 } })) fired++;
      prev = p;
    }
    expect(fired).toBe(1);
    expect(swordContact({ prevPhase: hitPhase - 0.01, phase: hitPhase, variant: 'cleave', self, player: { x: 0, z: 1.5 } })).toBe(true);
  });

  it('misses out of reach and outside the cone; sweep has the wider cone', () => {
    const at = (variant: 'cleave' | 'sweep', x: number, z: number) =>
      swordContact({ prevPhase: SWORD_CONTACT.phase[variant] - 0.01, phase: SWORD_CONTACT.phase[variant], variant, self, player: { x, z } });
    expect(at('cleave', 0, 2.6)).toBe(false);          // too far
    expect(at('cleave', 1.2, 0.9)).toBe(false);        // ~53 deg off — outside the cleave cone
    expect(at('sweep', 1.2, 0.9)).toBe(true);          // inside the sweep cone
  });

  it('hits on the strike beat, before the hold, for every variant', () => {
    for (const v of ['cleave', 'sweep', 'lunge'] as const) {
      expect(SWORD_CONTACT.phase[v]).toBeGreaterThan(ATTACK_TUNING.windupEnd);
      expect(SWORD_CONTACT.phase[v]).toBeLessThan(ATTACK_TUNING.holdEnd);
    }
  });

  it('a lunge from the top of its band has advanced into reach by its hit instant', () => {
    const band = SWORD_TUNING.brain.lungeBand!;
    const advanced = lungeAdvance(0, SWORD_CONTACT.phase.lunge, 10);
    expect(band.max - advanced).toBeLessThanOrEqual(SWORD_CONTACT.reach.lunge);
  });

  it('isSwordVariant', () => {
    expect(isSwordVariant('lunge')).toBe(true);
    expect(isSwordVariant('hook')).toBe(false);
  });
});

describe('SWORD_TUNING', () => {
  it('lunges from beyond reach, inside the ring', () => {
    expect(SWORD_TUNING.brain.lungeBand!.min).toBeGreaterThan(SWORD_TUNING.brain.meleeRadius);
    expect(SWORD_TUNING.brain.lungeBand!.max).toBeLessThan(SWORD_TUNING.brain.engageRange);
  });

  it('winds the cleave up slower than the sweep (the readable one hits hardest)', () => {
    expect(SWORD_TUNING.brain.swingSecFor!.cleave!).toBeGreaterThan(SWORD_TUNING.brain.swingSecFor!.sweep!);
  });
});

describe('jawGapeAt — the wind-up gape', () => {
  it('is shut at rest, peaks at windupEnd, holds to mid-strike and is shut by strikeEnd', () => {
    const T = ATTACK_TUNING;
    for (const v of ['cleave', 'sweep', 'lunge'] as const) {
      expect(jawGapeAt(0, v)).toBe(0);
      expect(jawGapeAt(T.windupEnd, v)).toBeCloseTo(JAW_GAPE.peak[v], 6);
      expect(jawGapeAt((T.windupEnd + T.strikeEnd) / 2 - 1e-3, v)).toBeCloseTo(JAW_GAPE.peak[v], 6);
      expect(jawGapeAt(T.strikeEnd, v)).toBe(0);
      expect(jawGapeAt(1, v)).toBe(0);
      expect(jawGapeAt(T.windupEnd / 2, v)).toBeGreaterThan(0);
    }
  });
  it('the cleave opens widest', () => {
    expect(JAW_GAPE.peak.cleave).toBeGreaterThan(JAW_GAPE.peak.lunge);
    expect(JAW_GAPE.peak.lunge).toBeGreaterThan(JAW_GAPE.peak.sweep);
  });
});
