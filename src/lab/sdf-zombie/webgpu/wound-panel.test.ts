import { describe, expect, it } from 'vitest';
import { WOUND_KEYS, copyText, defaultsFrom } from './wound-panel';

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
