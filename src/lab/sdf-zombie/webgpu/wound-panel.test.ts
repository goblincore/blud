import { describe, expect, it } from 'vitest';
import { DEATH_FALL } from '../death-fall';
import { WOUND_KEYS, copyText, defaultsFrom } from './wound-panel';
import { JOINT_TOUGHNESS, SOLDIER_TOUGHNESS } from '../connectivity';
import { CORPSE_INTEGRITY } from '../collapse';
import { BLOW_AWAY } from '../blow-away';

describe('wound panel', () => {
  // The bug this test exists to make impossible: a panel whose COPY button
  // emits keys the setter ignores. It has happened twice in this project
  // (setBeam, and the goo panel). One table drives both sides, so they cannot
  // drift.
  it('emits only keys the setter consumes', () => {
    const text = copyText(defaultsFrom(WOUND_KEYS));
    const emitted = [...text.matchAll(/(\w+)\s*:/g)].map(m => m[1]!);
    const known = new Set(WOUND_KEYS.map(k => k.key));
    for (const k of emitted) expect(known.has(k), `emitted unknown key ${k}`).toBe(true);
  });

  it('emits every key, so a COPY is a complete tuning', () => {
    const text = copyText(defaultsFrom(WOUND_KEYS));
    for (const { key } of WOUND_KEYS) expect(text).toContain(key);
  });

  it('emits a runnable setWoundTuning call', () => {
    expect(copyText(defaultsFrom(WOUND_KEYS))).toContain('__sdfGame.setWoundTuning(');
  });
});

describe('gameplay knobs start at the shipped values', () => {
  it('the toughness and integrity sliders match connectivity.ts and collapse.ts', () => {
    const v = defaultsFrom(WOUND_KEYS);
    expect(v.shoulderToughness).toBe(JOINT_TOUGHNESS.root);
    expect(v.elbowToughness).toBe(JOINT_TOUGHNESS.mid);
    expect(v.corpseIntegrity).toBe(CORPSE_INTEGRITY.value);
    expect(v.blowAway).toBe(BLOW_AWAY.scale);
    expect(v.blowAwayRange).toBe(BLOW_AWAY.farM);
    expect(v.soldierShoulder).toBe(SOLDIER_TOUGHNESS.root);
    expect(v.soldierElbow).toBe(SOLDIER_TOUGHNESS.mid);
    expect(v.deathAnimated).toBe(DEATH_FALL.on ? 1 : 0);
    expect(v.deathPull).toBe(DEATH_FALL.pull);
    expect(v.deathSettle).toBe(DEATH_FALL.settle);
  });
});
