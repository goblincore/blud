import { describe, expect, it } from 'vitest';
import { LAMP_MOODS, LAMP_SCRIPT, lampLevel, moodLevel } from './lamp-moods';

const sample = (f: (t: number) => number, from: number, to: number, step = 0.01) => {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(f(t));
  return out;
};

describe('moodLevel', () => {
  it('keeps every mood within [0, 1.4]', () => {
    for (const mood of LAMP_MOODS) {
      for (const v of sample(t => moodLevel(mood, t, 3), 0, 60, 0.013)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('steady is the old two-rate wobble', () => {
    const phase = 2.5;
    for (const t of [0, 0.37, 4.2, 19.9]) {
      const w = Math.sin(t * 7.3 + phase) * 0.5 + Math.sin(t * 17.1 + phase * 2.3) * 0.25;
      expect(moodLevel('steady', t, phase)).toBeCloseTo(1 + w * 0.14, 10);
    }
  });

  it('dead is 0', () => {
    expect(sample(t => moodLevel('dead', t, 1), 0, 10).every(v => v === 0)).toBe(true);
  });

  it('is deterministic', () => {
    for (const mood of LAMP_MOODS) expect(moodLevel(mood, 12.345, 7)).toBe(moodLevel(mood, 12.345, 7));
  });

  it('dying averages under half', () => {
    const s = sample(t => moodLevel('dying', t, 4), 0, 60);
    expect(s.reduce((a, b) => a + b, 0) / s.length).toBeLessThan(0.5);
  });

  it('stutter drops to 0 within 30 s', () => {
    expect(sample(t => moodLevel('stutter', t, 2), 0, 30).some(v => v === 0)).toBe(true);
  });

  it('different seeds differ', () => {
    const a = sample(t => moodLevel('flicker', t, 1), 0, 10, 0.05);
    const b = sample(t => moodLevel('flicker', t, 2), 0, 10, 0.05);
    expect(a).not.toEqual(b);
  });
});

describe('lampLevel scripts', () => {
  it('no script is the mood', () => {
    expect(lampLevel('steady', null, 3.3, 1)).toBe(moodLevel('steady', 3.3, 1));
  });

  it('die: sputters, then dark for good', () => {
    const s = { mode: 'die' as const, at: 10 };
    expect(lampLevel('dying', s, 9.9, 1)).toBe(moodLevel('dying', 9.9, 1));
    for (const t of [10 + LAMP_SCRIPT.sputterS + 0.01, 20, 500]) expect(lampLevel('dying', s, t, 1)).toBe(0);
    const during = sample(t => lampLevel('steady', s, t, 1), 10, 10 + LAMP_SCRIPT.sputterS);
    expect(during.some(v => v > 0.3)).toBe(true);
    expect(during.some(v => v === 0)).toBe(true);
  });

  it('blackout: dark, then back on the mood', () => {
    const s = { mode: 'blackout' as const, at: 5 };
    expect(lampLevel('steady', s, 8, 1)).toBe(0);
    const back = 5 + LAMP_SCRIPT.blackoutS + LAMP_SCRIPT.recoverS + 0.5;
    expect(lampLevel('steady', s, back, 1)).toBe(moodLevel('steady', back, 1));
  });

  it('strobe: surge, alternate, then dark', () => {
    const s = { mode: 'strobe' as const, at: 2 };
    expect(lampLevel('steady', s, 2.2, 1)).toBeGreaterThan(2);
    const strobe = sample(t => lampLevel('steady', s, t, 1), 2 + LAMP_SCRIPT.surgeS, 2 + LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS);
    expect(strobe.some(v => v === 0)).toBe(true);
    expect(strobe.some(v => v > 1)).toBe(true);
    expect(lampLevel('steady', s, 2 + LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS + 0.01, 1)).toBe(0);
  });

  it('a script before its start is the mood', () => {
    expect(lampLevel('fire', { mode: 'strobe', at: 50 }, 10, 3)).toBe(moodLevel('fire', 10, 3));
  });
});
