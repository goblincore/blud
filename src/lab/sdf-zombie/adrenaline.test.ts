import { describe, expect, it } from 'vitest';
import {
  ADRENALINE_DEFAULTS, LOW_HEALTH_WORLD_FLOOR, adrenalineBorderAt, adrenalineDrive, adrenalineTargets, lowHealthDanger,
  adrenalineEdgeAt, adrenalineFromParams, adrenalinePhase, adrenalineScalesAt,
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
    expect(adrenalineFromParams('?adr_low_start=40&adr_low_full=15&adr_low_world=0.3&adr_low_player=0.7'
      + '&adr_low_slew=0.5&adr_low_fx=0.9&adr_low_border=0.5&adr_low_width=0.3&adr_low_pulse=1&adr_low_always=1'))
      .toEqual({
        lowHealthStart: 40, lowHealthFull: 15, lowHealthWorldScale: 0.3, lowHealthPlayerScale: 0.7,
        lowHealthSlewSec: 0.5, lowHealthEdgeFx: 0.9, lowHealthBorder: 0.5, lowHealthBorderWidth: 0.3,
        lowHealthPulseHz: 1, lowHealthAlways: 1,
      });
  });

  it('refuses a low-health world scale deeper than explicit bullet time', () => {
    const t = T();
    expect(applyAdrenalineTuning({ lowHealthWorldScale: 0.1, lowHealthAlways: 1 }, t).rejected).toHaveLength(1);
    expect(t.lowHealthWorldScale).toBe(0.2);
    expect(t.lowHealthAlways).toBe(true);
  });
});

/** Step `sec` of real time at 60 Hz with health `hp` (a number, or a function of the step index). */
function runHp(s: AdrenalineState, sec: number, t: AdrenalineTuning, hp: number | ((i: number) => number)): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.round(sec * 60); i++) {
    stepAdrenaline(s, 1 / 60, false, t, typeof hp === 'number' ? hp : hp(i));
    out.push(adrenalineScalesAt(adrenalineDrive(s, t), t, s.danger).world);
  }
  return out;
}

describe('adrenaline at low health', () => {
  it('the danger target: 0 at 35+ HP, 1 at 20 HP and below, smooth and monotone between', () => {
    const t = T();
    expect(lowHealthDanger(100, t)).toBe(0);
    expect(lowHealthDanger(35, t)).toBe(0);
    expect(lowHealthDanger(27.5, t)).toBeCloseTo(0.5);
    expect(lowHealthDanger(20, t)).toBe(1);
    expect(lowHealthDanger(5, t)).toBe(1);
    expect(lowHealthDanger(Infinity, t)).toBe(0);
    expect(lowHealthDanger(NaN, t)).toBe(0);
    const v = Array.from({ length: 41 }, (_, i) => lowHealthDanger(40 - i * 0.5, t));
    expect(monotone(v, 1)).toBe(true);
    // Degenerate start <= full: a step at full.
    expect(lowHealthDanger(21, T({ lowHealthStart: 20 }))).toBe(0);
    expect(lowHealthDanger(20, T({ lowHealthStart: 20 }))).toBe(1);
  });

  it('the fully-in targets: worldScale 0.55 -> 0.2 and playerScale 0.85 -> 0.6, never past the floor or shallower', () => {
    const t = T();
    expect(adrenalineTargets(0, t)).toEqual({ world: 0.55, player: 0.85 });
    expect(adrenalineTargets(1, t).world).toBeCloseTo(0.2);
    expect(adrenalineTargets(1, t).player).toBeCloseTo(0.6);
    expect(adrenalineTargets(0.5, t).world).toBeCloseTo(0.375);
    // A low-health knob above the normal one never LIGHTENS the rush; a hand-edited one below the floor is floored.
    expect(adrenalineTargets(1, T({ lowHealthWorldScale: 0.9, lowHealthPlayerScale: 1 }))).toEqual({ world: 0.55, player: 0.85 });
    expect(adrenalineTargets(1, T({ lowHealthWorldScale: 0.05 })).world).toBe(LOW_HEALTH_WORLD_FLOOR);
  });

  it('a full rush at 30 / 20 / 10 HP: 0.55 deepens toward 0.2, eased — a bite never snaps the scale', () => {
    const t = T(), s = makeAdrenaline();
    triggerAdrenaline(s, t);
    expect(runHp(s, 2, t, 100).at(-1)).toBeCloseTo(0.55);
    const at30 = runHp(s, 1, t, 30).at(-1)!;
    expect(at30).toBeCloseTo(0.55 + (0.2 - 0.55) * lowHealthDanger(30, t));
    // 30 -> 10 in one bite: the first tick moves at most one slew step's worth (0.35 / (0.4 x 60)).
    const before = at30;
    const drop = runHp(s, 1, t, 10);
    expect(Math.abs(drop[0]! - before)).toBeLessThanOrEqual((0.55 - 0.2) / (t.lowHealthSlewSec * 60) + 1e-9);
    expect(monotone(drop, -1)).toBe(true);
    expect(drop.at(-1)).toBeCloseTo(0.2);
    expect(Math.min(...drop)).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(runHp(s, 1, t, 20).at(-1)).toBeCloseTo(0.2);
    expect(adrenalineScalesAt(s.level, t, s.danger).player).toBeCloseTo(0.6);
    // Healing eases it back up.
    const heal = runHp(s, 1, t, 100);
    expect(monotone(heal, 1)).toBe(true);
    expect(heal[0]! - 0.2).toBeLessThanOrEqual((0.55 - 0.2) / (t.lowHealthSlewSec * 60) + 1e-9);
    expect(heal.at(-1)).toBeCloseTo(0.55);
  });

  it('low health alone does nothing by default; lowHealthAlways makes it a rush of its own', () => {
    const t = T(), s = makeAdrenaline();
    expect(Math.min(...runHp(s, 2, t, 10))).toBe(1);
    expect(s.danger).toBe(1);                                    // tracked, ready to deepen the next rush at once
    expect(adrenalineBorderAt(adrenalineDrive(s, t), s.danger, 0.5, false, t).strength).toBe(0);
    const always = T({ lowHealthAlways: true }), s2 = makeAdrenaline();
    const w = runHp(s2, 1, always, 10);
    expect(monotone(w, -1)).toBe(true);
    expect(w.at(-1)).toBeCloseTo(0.2);
    expect(runHp(s2, 1, always, 100).at(-1)).toBeCloseTo(1);    // healed: back to normal time
    expect(adrenalineDrive(s2, T({ lowHealthAlways: true, on: false }))).toBe(s2.level);
  });

  it('explicit bullet time still wins (the floor is its 0.2; combine takes the slower)', () => {
    const t = T(), s = makeAdrenaline();
    triggerAdrenaline(s, t);
    runHp(s, 2, t, 5);
    const c = combineScales(0.2, { move: 0.35, aim: 0.35, fire: 0.35, reload: 0.35, shot: 0.5 },
      adrenalineScalesAt(s.level, t, s.danger));
    expect(c.world).toBeCloseTo(0.2);
    expect(c.move).toBe(0.35);
  });

  it('the edge FX strengthens with danger: edgeFx -> lowHealthEdgeFx, still 0 out of the rush', () => {
    const t = T();
    expect(adrenalineEdgeAt(1, t, 0)).toBeCloseTo(0.6);
    expect(adrenalineEdgeAt(1, t, 1)).toBeCloseTo(0.85);
    expect(adrenalineEdgeAt(0, t, 1)).toBe(0);
    expect(adrenalineEdgeAt(1, T({ lowHealthEdgeFx: 0.1 }), 1)).toBeCloseTo(0.6);  // never weaker
  });

  it('the red border: only while deepened and in, grows wider and stronger with danger, pulses (calm: steady)', () => {
    const t = T();
    expect(adrenalineBorderAt(1, 0, 0, false, t)).toEqual({ strength: 0, width: 0 });
    expect(adrenalineBorderAt(0, 1, 0, false, t)).toEqual({ strength: 0, width: 0 });
    const faint = adrenalineBorderAt(1, lowHealthDanger(33, t), 0.5, true, t);
    const full = adrenalineBorderAt(1, 1, 0.5, true, t);
    expect(faint.strength).toBeGreaterThan(0);
    expect(faint.strength).toBeLessThan(full.strength * 0.1);
    expect(faint.width).toBeLessThan(full.width * 0.35);
    expect(full.width).toBeCloseTo(t.lowHealthBorderWidth);
    expect(full.strength).toBeCloseTo(t.lowHealthBorder * 0.875);
    // The pulse breathes between 75% and 100% of lowHealthBorder; calm holds the mean whatever the phase.
    expect(adrenalineBorderAt(1, 1, 0, false, t).strength).toBeCloseTo(t.lowHealthBorder * 0.75);
    expect(adrenalineBorderAt(1, 1, 0.5, false, t).strength).toBeCloseTo(t.lowHealthBorder);
    expect(adrenalineBorderAt(1, 1, 0, true, t).strength).toBe(full.strength);
    expect(adrenalineBorderAt(1, 1, 0, false, T({ lowHealthPulseHz: 0 })).strength).toBe(full.strength);
    expect(adrenalineBorderAt(1, 1, 0.5, false, T({ lowHealthBorder: 0 })).strength).toBe(0);
  });

  it('the pulse phase advances on the real step at lowHealthPulseHz and wraps', () => {
    const t = T({ lowHealthPulseHz: 0.8 }), s = makeAdrenaline();
    for (let i = 0; i < 60; i++) stepAdrenaline(s, 1 / 60, false, t, 100);
    expect(s.pulse).toBeCloseTo(0.8);
    for (let i = 0; i < 60; i++) stepAdrenaline(s, 1 / 60, false, t, 100);
    expect(s.pulse).toBeCloseTo(0.6);
  });
});
