import { describe, expect, it } from 'vitest';
import {
  ADRENALINE_DEFAULTS, adrenalineFromParams, adrenalineScalesAt, applyAdrenalineTuning, combineScales,
  makeAdrenaline, stepAdrenaline, triggerAdrenaline, type AdrenalineTuning,
} from './adrenaline';

const T = (): AdrenalineTuning => ({ ...ADRENALINE_DEFAULTS });
/** Step `sec` of real time in 60 Hz ticks, returning the world scale after each. */
function run(s: ReturnType<typeof makeAdrenaline>, sec: number, t: AdrenalineTuning, explicitOn = false): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.round(sec * 60); i++) {
    stepAdrenaline(s, 1 / 60, explicitOn, t);
    out.push(adrenalineScalesAt(s.level, t).world);
  }
  return out;
}

describe('adrenaline envelope', () => {
  it('eases in, holds, eases out, back to normal time', () => {
    const t = T(), s = makeAdrenaline();
    expect(adrenalineScalesAt(s.level, t).world).toBe(1);
    expect(triggerAdrenaline(s, false, t)).toBe(true);
    stepAdrenaline(s, 0.04, false, t);
    expect(s.phase).toBe('in');
    expect(s.level).toBeCloseTo(0.5);
    stepAdrenaline(s, 0.04, false, t);
    expect(s.phase).toBe('hold');
    expect(adrenalineScalesAt(s.level, t).world).toBeCloseTo(0.55);
    expect(adrenalineScalesAt(s.level, t).player).toBeCloseTo(0.85);
    stepAdrenaline(s, 0.449, false, t);
    expect(s.phase).toBe('hold');
    stepAdrenaline(s, 0.002, false, t);
    expect(s.phase).toBe('out');
    stepAdrenaline(s, 0.35, false, t);
    expect(s.phase).toBe('idle');
    expect(adrenalineScalesAt(s.level, t).world).toBe(1);
  });

  it('a long step carries across phase boundaries', () => {
    const t = T(), s = makeAdrenaline();
    triggerAdrenaline(s, false, t);
    stepAdrenaline(s, 0.08 + 0.45 + 0.175, false, t);
    expect(s.phase).toBe('out');
    expect(s.level).toBeCloseTo(0.5);
  });

  it('a refresh never deepens the slowdown and never outlasts ease-in + one hold', () => {
    const t = T(), s = makeAdrenaline();
    triggerAdrenaline(s, false, t);
    const scales: number[] = run(s, 0.3, t);
    for (let i = 0; i < 5; i++) { triggerAdrenaline(s, false, t); scales.push(...run(s, 0.1, t)); }   // hammer it
    expect(Math.min(...scales)).toBeCloseTo(0.55);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.55 - 1e-9);
    // Last refresh was fully in: the hold restarts (0.45 s), then eases out (0.35 s) — no more.
    expect(s.phase).toBe('hold');
    const after = run(s, 0.45 - 0.1 + 0.35 + 1 / 60, t);
    expect(after[after.length - 1]).toBe(1);
    expect(s.phase).toBe('idle');
  });

  it('a refresh in the hold restarts the hold timer', () => {
    const t = T(), s = makeAdrenaline();
    triggerAdrenaline(s, false, t);
    stepAdrenaline(s, 0.08 + 0.3, false, t);
    expect(s.holdLeft).toBeCloseTo(0.15);
    triggerAdrenaline(s, false, t);
    expect(s.phase).toBe('hold');
    expect(s.holdLeft).toBeCloseTo(0.45);
  });

  it('a refresh while easing out eases back in from the current level, then holds once', () => {
    const t = T(), s = makeAdrenaline();
    triggerAdrenaline(s, false, t);
    stepAdrenaline(s, 0.08 + 0.45 + 0.175, false, t);   // half way out
    triggerAdrenaline(s, false, t);
    expect(s.phase).toBe('in');
    expect(s.level).toBeCloseTo(0.5);                    // no jump
    stepAdrenaline(s, 0.041, false, t);
    expect(s.phase).toBe('hold');
    expect(s.holdLeft).toBeCloseTo(0.449);
  });

  it('explicit bullet time wins: the trigger is refused and a running rush eases out', () => {
    const t = T(), s = makeAdrenaline();
    expect(triggerAdrenaline(s, true, t)).toBe(false);
    expect(s.phase).toBe('idle');
    triggerAdrenaline(s, false, t);
    stepAdrenaline(s, 0.2, false, t);
    stepAdrenaline(s, 1 / 60, true, t);
    expect(s.phase).toBe('out');
    stepAdrenaline(s, 0.4, true, t);
    expect(s.phase).toBe('idle');
  });

  it('off: no trigger', () => {
    const t = { ...T(), on: false }, s = makeAdrenaline();
    expect(triggerAdrenaline(s, false, t)).toBe(false);
  });

  it('combineScales: per channel the slower wins (explicit fully in overrides a rush)', () => {
    const bt = { move: 0.35, aim: 0.35, fire: 0.35, reload: 0.35, shot: 0.5, air: 1 };
    const c = combineScales(0.2, bt, { world: 0.55, player: 0.85, shot: 0.85 });
    expect(c).toEqual({ ...bt, world: 0.2 });
    const idle = { move: 1, aim: 1, fire: 1, reload: 1, shot: 1, air: 1 };
    const r = combineScales(1, idle, { world: 0.55, player: 0.85, shot: 0.7 });
    expect(r).toEqual({ world: 0.55, move: 0.85, aim: 0.85, fire: 0.85, reload: 0.85, shot: 0.7, air: 1 });
  });
});

describe('adrenaline tuning', () => {
  it('validates like the bullet time seam', () => {
    const t = T();
    const { tuning, rejected } = applyAdrenalineTuning(
      { worldScale: 0.4, holdSec: 9, bogus: 1, playerScale: 'x', on: 0, flail: 'yes' }, t);
    expect(tuning.worldScale).toBe(0.4);
    expect(tuning.holdSec).toBe(ADRENALINE_DEFAULTS.holdSec);
    expect(tuning.on).toBe(false);
    expect(rejected).toHaveLength(4);
    applyAdrenalineTuning({ reset: true }, t);
    expect(t).toEqual(ADRENALINE_DEFAULTS);
  });

  it('reads the URL params', () => {
    expect(adrenalineFromParams('?adrenaline=0&adr_world=0.6&adr_hold=&adr_in=x')).toEqual({ on: 0, worldScale: 0.6 });
  });
});
