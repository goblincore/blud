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

describe('emergency script (Boiler Room beacons)', () => {
  const s = { mode: 'emergency' as const, at: 10 };
  const on = 10 + LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS;
  it('is dark before it is armed, and through the strobe', () => {
    expect(lampLevel('dead', null, 5, 1)).toBe(0);
    expect(lampLevel('dead', s, 10.2, 1)).toBe(0);
    expect(lampLevel('dead', s, on - 0.01, 1)).toBe(0);
  });
  it('stutters on over emergencyOnS, then holds at 1 for good', () => {
    const lv: number[] = [];
    for (let t = on; t < on + LAMP_SCRIPT.emergencyOnS; t += 0.01) lv.push(lampLevel('dead', s, t, 1));
    expect(lv.some(v => v === 0)).toBe(true);
    expect(lv.some(v => v > 0)).toBe(true);
    expect(lampLevel('dead', s, on + LAMP_SCRIPT.emergencyOnS + 0.01, 1)).toBe(1);
    expect(lampLevel('dead', s, on + 600, 1)).toBe(1);
  });
  it('is deterministic per seed', () => {
    expect(lampLevel('dead', s, on + 0.05, 3)).toBe(lampLevel('dead', s, on + 0.05, 3));
  });
});

describe('strobe afterglow: cold flash bursts after the opening strobe (Boiler Room, 2026-09-29)', () => {
  const at = 12.3456;
  const strobeEnd = at + LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS;
  const script = { mode: 'strobe' as const, at };
  const level = (seed: number) => (t: number) => lampLevel('steady', script, t, seed);
  /** [start, end] of every run of flash level in the samples. */
  const flashes = (f: (t: number) => number, from: number, to: number) => {
    const out: [number, number][] = [];
    let start: number | null = null;
    const step = 0.005;
    for (let t = from; t < to; t += step) {
      const on = f(t) > 0;
      if (on && start === null) start = t;
      if (!on && start !== null) { out.push([start, t]); start = null; }
    }
    return out;
  };

  it('stays dark for burstDelayS after the strobe, so the red beacons get their beat and the gates\' probes see none', () => {
    for (const v of sample(level(1), strobeEnd, strobeEnd + LAMP_SCRIPT.burstDelayS - 0.01)) expect(v).toBe(0);
  });

  it('then flashes in bursts of 2 or 3, at burstLevel, with at least burstMinGapS between bursts', () => {
    const fl = flashes(level(1), strobeEnd, strobeEnd + 120);
    expect(fl.length).toBeGreaterThan(10);
    for (const v of sample(level(1), strobeEnd, strobeEnd + 120)) expect(v === 0 || v === LAMP_SCRIPT.burstLevel).toBe(true);
    // group flashes into bursts: a gap under 0.2 s is inside a burst
    const bursts: [number, number, number][] = [];
    for (const [a, b] of fl) {
      const last = bursts[bursts.length - 1];
      if (last && a - last[1] < 0.2) { last[1] = b; last[2]++; } else bursts.push([a, b, 1]);
    }
    for (const [, , n] of bursts) expect([2, 3]).toContain(n);
    for (let i = 1; i < bursts.length; i++) expect(bursts[i]![0] - bursts[i - 1]![1]).toBeGreaterThanOrEqual(LAMP_SCRIPT.burstMinGapS - 0.01);
  });

  it('never exceeds 3 flashes in any one-second window (photosensitivity guidance)', () => {
    const fl = flashes(level(1), strobeEnd, strobeEnd + 300);
    for (let i = 0; i < fl.length; i++) {
      const inSecond = fl.filter(([a]) => a >= fl[i]![0] && a < fl[i]![0] + 1).length;
      expect(inSecond).toBeLessThanOrEqual(3);
    }
  });

  it('is room-synchronous: lamps with different seeds flash within 20 ms of each other', () => {
    const a = flashes(level(1), strobeEnd, strobeEnd + 60), b = flashes(level(2.7), strobeEnd, strobeEnd + 60);
    expect(a.length).toBe(b.length);
    a.forEach(([s], i) => expect(Math.abs(s - b[i]![0])).toBeLessThan(0.02));
  });

  it('is deterministic', () => {
    expect(flashes(level(1), strobeEnd, strobeEnd + 40)).toEqual(flashes(level(1), strobeEnd, strobeEnd + 40));
  });

  it('reduced: the opening strobe slows to strobeHzReduced and each burst is one slow pulse', () => {
    const r = { mode: 'strobe' as const, at, reduced: true };
    const f = (t: number) => lampLevel('steady', r, t, 1);
    const open = flashes(f, at + LAMP_SCRIPT.surgeS, strobeEnd);
    expect(open.length).toBeLessThanOrEqual(Math.ceil(LAMP_SCRIPT.strobeS * LAMP_SCRIPT.strobeHzReduced));
    const fl = flashes(f, strobeEnd + LAMP_SCRIPT.burstDelayS - 0.01, strobeEnd + 120);
    expect(fl.length).toBeGreaterThan(10);
    for (let i = 1; i < fl.length; i++) expect(fl[i]![0] - fl[i - 1]![1]).toBeGreaterThanOrEqual(LAMP_SCRIPT.burstMinGapS - 0.05);
    for (const v of sample(f, strobeEnd, strobeEnd + 120)) expect(v).toBeLessThanOrEqual(LAMP_SCRIPT.burstLevel);
  });
});
