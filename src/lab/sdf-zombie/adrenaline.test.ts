import { describe, expect, it } from 'vitest';
import {
  ADRENALINE_DEFAULTS, adrenalineEdgeAt, adrenalineFromParams, adrenalinePhase, adrenalineScalesAt,
  applyAdrenalineTuning, combineScales, makeAdrenaline, stepAdrenaline, triggerAdrenaline, type AdrenalineState,
  type AdrenalineTuning,
} from './adrenaline';

const T = (over: Partial<AdrenalineTuning> = {}): AdrenalineTuning => ({ ...ADRENALINE_DEFAULTS, ...over });
const world = (s: AdrenalineState, t: AdrenalineTuning) => adrenalineScalesAt(s.level, t).world;
/** Step `sec` of real time in 60 Hz ticks, returning the world scale after each. */
function run(s: AdrenalineState, sec: number, t: AdrenalineTuning, explicitOn = false): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.round(sec * 60); i++) { stepAdrenaline(s, 1 / 60, explicitOn, t); out.push(world(s, t)); }
  return out;
}
const monotone = (v: number[], dir: 1 | -1) => v.every((x, i) => i === 0 || (x - v[i - 1]!) * dir >= -1e-12);

describe('adrenaline envelope', () => {
  it('ramps in smoothly (accelerating, no step) to worldScale and stays there', () => {
    const t = T(), s = makeAdrenaline();
    expect(world(s, t)).toBe(1);
    triggerAdrenaline(s, t);
    const ramp = run(s, t.rampInSec, t);
    expect(monotone(ramp, -1)).toBe(true);
    expect(1 - ramp[0]!).toBeLessThan(0.002);                    // starts slow: no step
    const d0 = 1 - ramp[0]!, dMid = ramp[23]! - ramp[24]!;
    expect(dMid).toBeGreaterThan(d0 * 5);                        // accelerates
    expect(ramp[ramp.length - 1]).toBeCloseTo(0.55);
    expect(adrenalinePhase(s, false, t)).toBe('full');
    expect(adrenalineScalesAt(s.level, t).player).toBeCloseTo(0.85);
    expect(Math.min(...run(s, 10, t))).toBeCloseTo(0.55);
  });

  it('holds while hits keep landing, ramps out sustainSec after the LAST hit', () => {
    const t = T({ sustainSec: 5 }), s = makeAdrenaline();
    triggerAdrenaline(s, t);
    run(s, 4, t);
    triggerAdrenaline(s, t);                                     // sustain resets
    run(s, 4.9, t);
    expect(adrenalinePhase(s, false, t)).toBe('full');
    const out = run(s, 0.2 + t.rampOutSec, t);
    expect(adrenalinePhase(s, false, t)).toBe('idle');
    expect(monotone(out, 1)).toBe(true);
    expect(out[out.length - 1]).toBe(1);
  });

  it('a hit during the ramp-out turns it back up from where it is; never deeper than worldScale', () => {
    const t = T({ sustainSec: 1 }), s = makeAdrenaline();
    triggerAdrenaline(s, t);
    run(s, 1 + t.rampOutSec / 2, t);                             // half way out
    expect(adrenalinePhase(s, false, t)).toBe('out');
    const before = world(s, t);
    triggerAdrenaline(s, t);
    const back = run(s, 0.1, t);
    // No jump: the first tick moves at most one 60 Hz step of the ramp-in at its steepest (1.5 x 0.45 / 48).
    expect(Math.abs(back[0]! - before)).toBeLessThan(1.5 * (1 - t.worldScale) / (60 * t.rampInSec) + 1e-6);
    expect(back[back.length - 1]).toBeLessThan(before);          // heading back in
    for (let i = 0; i < 20; i++) { triggerAdrenaline(s, t); back.push(...run(s, 0.2, t)); }   // hammer it
    expect(Math.min(...back)).toBeGreaterThanOrEqual(0.55 - 1e-9);
  });

  it('explicit bullet time wins: the rush eases out under it, and resumes after inside the sustain window', () => {
    const t = T(), s = makeAdrenaline();
    triggerAdrenaline(s, t);
    run(s, 1, t);
    run(s, t.rampOutSec, t, true);
    expect(s.level).toBe(0);
    expect(adrenalinePhase(s, true, t)).toBe('idle');
    run(s, t.rampInSec, t, false);
    expect(adrenalinePhase(s, false, t)).toBe('full');
  });

  it('off: no trigger, and a running rush eases out', () => {
    const s = makeAdrenaline();
    triggerAdrenaline(s, T());
    run(s, 1, T());
    const off = T({ on: false });
    expect(triggerAdrenaline(s, off)).toBe(false);
    run(s, off.rampOutSec, off);
    expect(s.level).toBe(0);
  });

  it('the edge FX follows the rush level: 0 at rest, edgeFx fully in, monotone between', () => {
    const t = T();
    expect(adrenalineEdgeAt(0, t)).toBe(0);
    expect(adrenalineEdgeAt(1, t)).toBeCloseTo(t.edgeFx);
    const v = Array.from({ length: 11 }, (_, i) => adrenalineEdgeAt(i / 10, t));
    expect(monotone(v, 1)).toBe(true);
    // Same easing as the time scale: half the edge amount exactly where the world is half way to worldScale.
    expect(adrenalineEdgeAt(0.5, t) / t.edgeFx).toBeCloseTo((1 - adrenalineScalesAt(0.5, t).world) / (1 - t.worldScale));
    expect(adrenalineEdgeAt(1, T({ edgeFx: 0 }))).toBe(0);
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
      { worldScale: 0.4, sustainSec: 900, bogus: 1, playerScale: 'x', on: 0, flail: 'yes' }, t);
    expect(tuning.worldScale).toBe(0.4);
    expect(tuning.sustainSec).toBe(ADRENALINE_DEFAULTS.sustainSec);
    expect(tuning.on).toBe(false);
    expect(rejected).toHaveLength(4);
    applyAdrenalineTuning({ reset: true }, t);
    expect(t).toEqual(ADRENALINE_DEFAULTS);
  });

  it('reads the URL params', () => {
    expect(adrenalineFromParams('?adrenaline=0&adr_world=0.6&adr_sustain=&adr_in=x&adr_fx=0.3'))
      .toEqual({ on: 0, worldScale: 0.6, edgeFx: 0.3 });
  });
});
