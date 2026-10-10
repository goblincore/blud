// src/lab/sdf-zombie/head-burst.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BURST, BURST_TUNING_DEFAULTS, aimOffsetOf, aimPointOf, aimRangeOf, burstPlan, burstTuning, classifyBurst, decapitationRule, headRadius,
  headShotRule, hsOf, inSplitRange, onHeadPrim, preciseSlug, setBurstTuning, slugSplitPoint, type HeadShot,
} from './head-burst';
import type { ShotAim } from './damage';
import { prim } from './head-pop';
import { mulberry32 } from './melt-bones';
import type { HeadFrame } from './head-deform';
import type { Vec3 } from './types';

const frame: HeadFrame = { centre: [0, 1.6, 0], quat: [0, 0, 0, 1], axes: [0.09, 0.11, 0.1] };
/** A slug travelling −z that crosses the head's front surface at world x = `x`. */
const shot = (x: number, y = 1.6) => ({ point: [x, y, 0.1] as Vec3, dir: [0, 0, -1] as Vec3 });

beforeEach(() => setBurstTuning({ ...BURST_TUNING_DEFAULTS, centreFrac: 0.35 }));

describe('classifyBurst', () => {
  it('head radius is the geometric mean of the axes', () => {
    expect(headRadius(frame.axes)).toBeCloseTo(Math.cbrt(0.09 * 0.11 * 0.1), 9);
  });
  it('a dead-centre shot is lethal with offset ~0 and severity ~1', () => {
    const v = classifyBurst(shot(0), frame);
    expect(v.kind).toBe('lethal');
    expect(v.offset).toBeCloseTo(0, 6);
    expect(v.severity).toBeCloseTo(1, 6);
  });
  it('a 3 cm offset (0.3 of the head radius) is still lethal; 5 cm (0.5) is glancing', () => {
    expect(classifyBurst(shot(0.03), frame).kind).toBe('lethal');
    expect(classifyBurst(shot(0.05), frame).kind).toBe('glancing');
  });
  it('glancing reports which side the line passes and a severity below 1', () => {
    const r = classifyBurst(shot(0.05), frame);
    const l = classifyBurst(shot(-0.05), frame);
    expect(r.side).toBe(1);
    expect(l.side).toBe(-1);
    expect(r.severity).toBeCloseTo(1 - 0.05 / headRadius(frame.axes), 6);
  });
  it('the exit point is the far side of the head ellipsoid along the shot', () => {
    const v = classifyBurst(shot(0.05), frame);
    // ellipsoid at x = 0.05: z = ±0.1·sqrt(1 − (0.05/0.09)²) = ±0.08315
    expect(v.exit[0]).toBeCloseTo(0.05, 6);
    expect(v.exit[2]).toBeCloseTo(-0.08315, 4);
  });
  it('a line that misses the ellipsoid falls back to centre + dir · radius for the exit', () => {
    const v = classifyBurst({ point: [0.5, 1.6, 0.1], dir: [0, 0, -1] }, frame);
    expect(v.kind).toBe('glancing');
    expect(v.exit[2]).toBeCloseTo(-headRadius(frame.axes), 6);
  });
  it('works from the side of a turned head: the burst axis is expressed head-local', () => {
    // +90° about y: local +z faces world +x.
    const s = Math.SQRT1_2;
    const turned: HeadFrame = { ...frame, quat: [0, s, 0, s] };
    const v = classifyBurst({ point: [-0.09, 1.6, 0], dir: [1, 0, 0] }, turned);
    expect(v.kind).toBe('lethal');
    expect(v.axisLocal[2]).toBeCloseTo(1, 6);
    expect(Math.abs(v.axisLocal[0])).toBeLessThan(1e-9);
  });
  it('the shipped zone is wide enough that an aimed player shot (line ~1 head radius off centre) still splits', () => {
    expect(BURST.centreFrac).toBeGreaterThan(1.1);
  });
  it('centreFrac is a live tuning constant', () => {
    setBurstTuning({ centreFrac: 0.6 });
    expect(classifyBurst(shot(0.05), frame).kind).toBe('lethal');
  });
});

describe('hsOf / onHeadPrim', () => {
  it('hsOf is conj(quat)·(p − centre) ÷ axes', () => {
    const hs = hsOf(frame, [0.045, 1.71, 0.05]);
    expect(hs[0]).toBeCloseTo(0.5, 9);
    expect(hs[1]).toBeCloseTo(1, 9);
    expect(hs[2]).toBeCloseTo(0.5, 9);
  });
  const head = prim([0, 1.6, 0], [0, 1.6, 0], 0.1, [1, 1, 1], { limb: 'head' });
  const torso = prim([0, 1.3, 0], [0, 1.45, 0], 0.15, [1, 1, 1], { limb: 'torso' });
  it('a point on the head surface is on the head; one on the torso is not', () => {
    expect(onHeadPrim([head, torso], [0, 1.6, 0.1])).toBe(true);
    expect(onHeadPrim([head, torso], [0.15, 1.38, 0])).toBe(false);
  });
  it('dead, sub and bone prims do not count as head flesh', () => {
    const dead = { ...head, dead: true } as typeof head;
    expect(onHeadPrim([dead, torso], [0, 1.6, 0.1])).toBe(false);
  });
});

describe('burstPlan', () => {
  const lethal = () => classifyBurst(shot(0), frame);
  const glance = () => classifyBurst(shot(0.05), frame);
  it('is deterministic for a seed', () => {
    expect(burstPlan(lethal(), mulberry32(7))).toEqual(burstPlan(lethal(), mulberry32(7)));
  });
  it('lethal throws more shards than glancing, and never more flaps than the cap', () => {
    const l = burstPlan(lethal(), mulberry32(3)), g = burstPlan(glance(), mulberry32(3));
    expect(l.shards).toBeGreaterThan(g.shards);
    expect(l.flaps).toBeLessThanOrEqual(BURST.flapMax);
    expect(l.flapAngles).toHaveLength(l.flaps);
  });
  it('tuning overrides flap count (clamped to the cap) and scales shards', () => {
    setBurstTuning({ flapCount: 99 });
    expect(burstPlan(lethal(), mulberry32(1)).flaps).toBe(BURST.flapMax);
    setBurstTuning({ flapCount: 0 });
    expect(burstPlan(lethal(), mulberry32(1)).flaps).toBe(0);
    setBurstTuning({ flapCount: -1, shardScale: 2 });
    expect(burstPlan(lethal(), mulberry32(1)).shards).toBeGreaterThan(BURST.shards.lethal[1]);
  });
  it('flaps are OFF by default (the orange-tube look was rejected for the zombie) and forced on by flapCount', () => {
    expect(burstPlan(lethal(), mulberry32(2)).flaps).toBe(0);
    expect(burstPlan(glance(), mulberry32(2)).flaps).toBe(0);
    setBurstTuning({ flapCount: 3 });
    expect(burstPlan(lethal(), mulberry32(2)).flaps).toBe(3);
  });
  it('slugs do not kill by default (lethal off), repeats creep up slowly', () => {
    expect(BURST_TUNING_DEFAULTS.lethal).toBe(false);
    expect(BURST_TUNING_DEFAULTS.repeatStep).toBeLessThan(0.1);
  });
  it('the opening is not the shipped behaviour: off by default, with its two debug switches off as well', () => {
    expect(BURST_TUNING_DEFAULTS.opening).toBe(false);
    expect(BURST_TUNING_DEFAULTS.anyWeapon).toBe(false);
    expect(BURST_TUNING_DEFAULTS.alwaysSplit).toBe(false);
    // What ships instead: the slug's split and the slug's pop.
    expect(BURST_TUNING_DEFAULTS.slugSplit).toBe(true);
    expect(BURST_TUNING_DEFAULTS.slugPop).toBe(true);
    expect(BURST_TUNING_DEFAULTS.popOnSplit).toBe(true);
  });
  it('setBurstTuning returns a copy and updates burstTuning', () => {
    const t = setBurstTuning({ swell: 0.4 });
    expect(t.swell).toBe(0.4);
    expect(burstTuning.swell).toBe(0.4);
  });
});

describe('headShotRule: what a gun round does to a zombie head', () => {
  const T = BURST_TUNING_DEFAULTS;
  /** A slug that landed on the chin, as an aimed slug does (its own line 0.9 head radii off centre), fired with the
   *  crosshair on the head's centre from 2 m, unless a field says otherwise. */
  const shot = (o: Partial<HeadShot> = {}): HeadShot => ({ kind: 'slug', offset: 0.9, aimOffset: 0, rangeM: 2, splitOpen: false, splitShare: o.splitOpen ? 1 : 0, splitRefused: false, ...o });
  /** The tuning before 2026-10-07: every gun hit on the head made the opening. */
  const OLD = { ...T, opening: true, anyWeapon: true, alwaysSplit: true, slugSplit: false, slugPop: false, popOnSplit: false };
  /** The slug's split as it was first built: judged on the slug's own line, loosely, from any range. */
  const SLUG_LINE = { ...T, splitAim: 'slug' as const, splitFrac: 1.25, splitRangeM: 0, popPrecise: true };

  it('the shipped tuning: precision is the crosshair\'s, very precise, and the range is close to medium', () => {
    expect(T.splitAim).toBe('crosshair');
    expect(T.splitFrac).toBeGreaterThan(0.15);
    expect(T.splitFrac).toBeLessThanOrEqual(0.4);
    expect(T.splitRangeM).toBeGreaterThanOrEqual(3);
    expect(T.splitRangeM).toBeLessThanOrEqual(6);
    expect(T.popPrecise).toBe(false);
  });
  it('a pellet on a head is always an ordinary wound: closed, split open, aimed or not, near or far', () => {
    for (const aimOffset of [0, 0.5, null]) for (const rangeM of [1, 9, null]) for (const splitOpen of [false, true]) for (const splitRefused of [false, true]) {
      expect(headShotRule(shot({ kind: 'pellet', offset: 0, aimOffset, rangeM, splitOpen, splitRefused }), T)).toBe('ordinary');
    }
  });

  // ---- Precise or not: the crosshair's ray, not the slug's line.
  it('a precise slug on a closed head splits it; an imprecise one is an ordinary slug wound', () => {
    expect(headShotRule(shot({ aimOffset: 0 }), T)).toBe('split');
    expect(headShotRule(shot({ aimOffset: T.splitFrac - 0.01 }), T)).toBe('split');
    expect(headShotRule(shot({ aimOffset: T.splitFrac }), T)).toBe('ordinary');
    expect(headShotRule(shot({ aimOffset: 0.6 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ aimOffset: 1.2 }), T)).toBe('ordinary');
  });
  it('where the slug itself went does not matter: its line may run a head radius off, or dead centre', () => {
    // An aimed slug lands under the crosshair: measured on the zombie, 0.89 to 1.21 head radii off, 0.8 to 4 m.
    for (const offset of [0, 0.891, 0.991, 1.03, 1.208, 2]) {
      expect(headShotRule(shot({ offset, aimOffset: 0.1 }), T), `line ${offset}`).toBe('split');
      // And a slug whose own line is dead centre does not split when the crosshair was off the centre.
      expect(headShotRule(shot({ offset, aimOffset: 0.5 }), T), `line ${offset}`).toBe('ordinary');
    }
  });
  it('a slug that carries no aim (no crosshair fired it) is never precise, and never in range', () => {
    expect(headShotRule(shot({ offset: 0, aimOffset: null, rangeM: null }), T)).toBe('ordinary');
    expect(headShotRule(shot({ offset: 0, aimOffset: null, rangeM: 2 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ offset: 0, aimOffset: 0, rangeM: null }), T)).toBe('ordinary');
    expect(preciseSlug(shot({ offset: 0, aimOffset: null }), T)).toBe(false);
    expect(inSplitRange(shot({ rangeM: null }), T)).toBe(false);
  });
  it('the threshold is the tuning\'s', () => {
    expect(headShotRule(shot({ aimOffset: 0.4 }), { ...T, splitFrac: 0.5 })).toBe('split');
    expect(headShotRule(shot({ aimOffset: 0.2 }), { ...T, splitFrac: 0.1 })).toBe('ordinary');
  });

  // ---- In range or not.
  it('the split needs the head within splitRangeM of the eye at firing: beyond it a precise slug is ordinary', () => {
    expect(headShotRule(shot({ rangeM: 0.8 }), T)).toBe('split');
    expect(headShotRule(shot({ rangeM: T.splitRangeM }), T)).toBe('split');
    expect(headShotRule(shot({ rangeM: T.splitRangeM + 0.01 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ rangeM: 12 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ rangeM: 12 }), { ...T, splitRangeM: 15 })).toBe('split');
  });
  it('splitRangeM 0 or less is no limit, and then a slug with no recorded range is in range', () => {
    expect(headShotRule(shot({ rangeM: 40 }), { ...T, splitRangeM: 0 })).toBe('split');
    expect(headShotRule(shot({ rangeM: null }), { ...T, splitRangeM: 0 })).toBe('split');
    expect(headShotRule(shot({ rangeM: null }), { ...T, splitRangeM: -1 })).toBe('split');
  });
  it('precise and in range are both needed: each alone is ordinary', () => {
    expect(headShotRule(shot({ aimOffset: 0.1, rangeM: 2 }), T)).toBe('split');
    expect(headShotRule(shot({ aimOffset: 0.1, rangeM: 9 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ aimOffset: 0.6, rangeM: 2 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ aimOffset: 0.6, rangeM: 9 }), T)).toBe('ordinary');
  });

  // ---- The head's state.
  it('a head the split would refuse (the flail has damaged it) takes the precise slug as an ordinary wound', () => {
    expect(headShotRule(shot({ aimOffset: 0.1, splitRefused: true }), T)).toBe('ordinary');
  });
  it('slugSplit off: no slug splits', () => {
    expect(headShotRule(shot({ aimOffset: 0 }), { ...T, slugSplit: false })).toBe('ordinary');
  });
  it('a slug on a head split wide pops it WITHOUT precision, from within range; from beyond it is ordinary', () => {
    for (const aimOffset of [0, 0.29, 0.6, 1.3, 2.5]) for (const offset of [0, 0.9, 1.8]) {
      expect(headShotRule(shot({ offset, aimOffset, splitOpen: true }), T), `aim ${aimOffset} line ${offset}`).toBe('pop');
      expect(headShotRule(shot({ offset, aimOffset, splitOpen: true, rangeM: T.splitRangeM + 1 }), T)).toBe('ordinary');
    }
    expect(headShotRule(shot({ splitOpen: true, rangeM: T.splitRangeM }), T)).toBe('pop');
    // No recorded aim, no recorded range: out of range.
    expect(headShotRule(shot({ splitOpen: true, aimOffset: null, rangeM: null }), T)).toBe('ordinary');
    expect(headShotRule(shot({ splitOpen: true }), { ...T, popOnSplit: false })).toBe('ordinary');
    // The split's own switch does not matter once the head is open: the axe may have opened it.
    expect(headShotRule(shot({ splitOpen: true, aimOffset: 0.8 }), { ...T, slugSplit: false })).toBe('pop');
  });
  it('popPrecise asks the pop\'s slug for the split\'s precision as well', () => {
    const P = { ...T, popPrecise: true };
    expect(headShotRule(shot({ aimOffset: 0.1, splitOpen: true }), P)).toBe('pop');
    expect(headShotRule(shot({ aimOffset: 0.6, splitOpen: true }), P)).toBe('ordinary');
    expect(headShotRule(shot({ aimOffset: 0.1, splitOpen: true, rangeM: 9 }), P)).toBe('ordinary');
  });
  it('only a head split wide pops: one that is cracked under popSplitMin takes the slug as an ordinary wound, precise or not', () => {
    for (const aimOffset of [0, 0.6]) {
      expect(headShotRule(shot({ aimOffset, splitOpen: true, splitShare: 0.25 }), T)).toBe('ordinary');
      expect(headShotRule(shot({ aimOffset, splitOpen: true, splitShare: T.popSplitMin }), T)).toBe('pop');
      // The axe's first chop (0.8 of the angle) and the slug's own split (1) are wide.
      expect(headShotRule(shot({ aimOffset, splitOpen: true, splitShare: 0.8 }), T)).toBe('pop');
      expect(headShotRule(shot({ aimOffset, splitOpen: true, splitShare: 0.25 }), { ...T, popSplitMin: 0 })).toBe('pop');
    }
  });
  it('the orders: imprecise then precise splits; precise then any slug in range splits then pops', () => {
    // An ordinary slug wound leaves no state: the next slug is judged on a closed, unrefused head.
    expect(headShotRule(shot({ aimOffset: 0.9 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ aimOffset: 0.1 }), T)).toBe('split');
    expect(headShotRule(shot({ aimOffset: 0.9, splitOpen: true }), T)).toBe('pop');
  });

  // ---- Each splitAim.
  it('splitAim slug judges the slug\'s own line and ignores the crosshair', () => {
    const S = { ...T, splitAim: 'slug' as const };
    expect(headShotRule(shot({ offset: 0.1, aimOffset: 0.9 }), S)).toBe('split');
    expect(headShotRule(shot({ offset: 0.9, aimOffset: 0 }), S)).toBe('ordinary');
    // No recorded aim is no bar to precision there; the range still is, unless its limit is off.
    expect(preciseSlug(shot({ offset: 0.1, aimOffset: null }), S)).toBe(true);
    expect(headShotRule(shot({ offset: 0.1, aimOffset: null, rangeM: null }), S)).toBe('ordinary');
    expect(headShotRule(shot({ offset: 0.1, aimOffset: null, rangeM: null }), { ...S, splitRangeM: 0 })).toBe('split');
    expect(headShotRule(shot({ offset: 0.1, rangeM: 9 }), S)).toBe('ordinary');
  });
  it('the split as it was first built is one tuning away: an aimed slug\'s own line is under 1.25, at any range, with or without an aim', () => {
    // scripts/head-burst-look.mjs's aim probe on the zombie, 0.8 to 4 m: the crosshair on the head's centre, and 2 cm lower.
    for (const offset of [0.891, 0.923, 0.946, 0.991, 1.03, 1.071, 1.101, 1.125, 1.168, 1.208]) {
      for (const rangeM of [2, 30, null]) expect(headShotRule(shot({ offset, aimOffset: rangeM === null ? null : 0.7, rangeM }), SLUG_LINE)).toBe('split');
    }
    expect(headShotRule(shot({ offset: 1.25 }), SLUG_LINE)).toBe('ordinary');
    // Its pop needed the same centred line.
    expect(headShotRule(shot({ offset: 0.4, splitOpen: true, rangeM: null }), SLUG_LINE)).toBe('pop');
    expect(headShotRule(shot({ offset: 1.35, splitOpen: true }), SLUG_LINE)).toBe('ordinary');
  });

  it('switched off, every round is ordinary', () => {
    for (const kind of ['pellet', 'slug'] as const) for (const splitOpen of [false, true]) {
      expect(headShotRule(shot({ kind, offset: 0, splitOpen }), { ...OLD, on: false })).toBe('ordinary');
      expect(headShotRule(shot({ kind, offset: 0, splitOpen }), { ...T, on: false })).toBe('ordinary');
    }
  });
  it('the opening, switched on, takes every slug on a closed head before the split is asked, and pellets with anyWeapon', () => {
    expect(headShotRule(shot({ aimOffset: 0 }), { ...T, opening: true })).toBe('opening');
    expect(headShotRule(shot({ aimOffset: 2, rangeM: 30 }), { ...T, opening: true })).toBe('opening');
    expect(headShotRule(shot({ aimOffset: null, rangeM: null }), { ...T, opening: true })).toBe('opening');
    expect(headShotRule(shot({ kind: 'pellet' }), { ...T, opening: true })).toBe('ordinary');
    expect(headShotRule(shot({ kind: 'pellet' }), { ...T, opening: true, anyWeapon: true })).toBe('opening');
  });
  it('the old behaviour is one tuning away: every gun hit on a closed head opens it, and nothing splits or pops', () => {
    for (const kind of ['pellet', 'slug'] as const) for (const offset of [0, 0.9, 1.6]) {
      expect(headShotRule(shot({ kind, offset }), OLD)).toBe('opening');
      // An open head (the axe's) was never the opening's: ordinary, as before.
      expect(headShotRule(shot({ kind, offset, splitOpen: true }), OLD)).toBe('ordinary');
    }
    expect(decapitationRule('slug', OLD)).toBeNull();
  });
});

describe('the aim against a head: aimOffsetOf, aimRangeOf, slugSplitPoint', () => {
  const R = headRadius(frame.axes);
  /** The crosshair's ray from an eye `d` m in front of the head (+z), through the point `off` from its centre. */
  const aimAt = (d: number, off: Vec3 = [0, 0, 0]): ShotAim => {
    const eye: Vec3 = [0, 1.6, d], to: Vec3 = [off[0], 1.6 + off[1], off[2]];
    const v: Vec3 = [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]], l = Math.hypot(v[0], v[1], v[2]);
    return { eye, dir: [v[0] / l, v[1] / l, v[2] / l] };
  };
  it('a ray through the centre is 0 off; one through a point 3 cm beside it is 3 cm off, in head radii, at any range', () => {
    expect(aimOffsetOf(aimAt(2), frame)).toBeCloseTo(0, 9);
    for (const d of [1, 2, 4, 6]) {
      expect(aimOffsetOf(aimAt(d, [0.03, 0, 0]), frame) * R).toBeCloseTo(0.03 * d / Math.hypot(d, 0.03), 9);
      expect(aimOffsetOf(aimAt(d, [0, -0.03, 0]), frame) * R).toBeCloseTo(0.03 * d / Math.hypot(d, 0.03), 9);
    }
  });
  it('the direction need not be unit, and the head\'s turn does not matter (the centre is a point)', () => {
    const a = aimAt(2, [0.03, 0.01, 0]);
    const long: ShotAim = { eye: a.eye, dir: [a.dir[0] * 7, a.dir[1] * 7, a.dir[2] * 7] };
    expect(aimOffsetOf(long, frame)).toBeCloseTo(aimOffsetOf(a, frame), 12);
    const s = Math.SQRT1_2;
    expect(aimOffsetOf(a, { ...frame, quat: [0, s, 0, s] })).toBeCloseTo(aimOffsetOf(a, frame), 12);
  });
  it('a head behind the eye is measured to the eye: the ray does not run backwards', () => {
    const away: ShotAim = { eye: [0, 1.6, 2], dir: [0, 0, 1] };
    expect(aimOffsetOf(away, frame) * R).toBeCloseTo(2, 9);
    expect(aimPointOf(away, frame)).toEqual([0, 1.6, 2]);
  });
  it('the range is from the eye at firing to the head\'s centre', () => {
    expect(aimRangeOf(aimAt(2), frame)).toBeCloseTo(2, 12);
    expect(aimRangeOf({ eye: [3, 1.6, 4], dir: [0, 0, -1] }, frame)).toBeCloseTo(5, 12);
  });
  it('the split is laid on the head\'s middle line: the impact with its head-local x made 0, its height and depth kept', () => {
    const impact: Vec3 = [0.036, 1.52, 0.08];
    expect(slugSplitPoint('crosshair', impact, frame)).toEqual([0, 1.52, 0.08]);
    // Judged on the slug's own line, it is the impact, as it was.
    expect(slugSplitPoint('slug', impact, frame)).toEqual(impact);
    expect(slugSplitPoint('slug', impact, frame)).not.toBe(impact);
    // On a turned head the middle plane turns with it: +90 degrees about y puts head-local x along world -z.
    const s = Math.SQRT1_2, turned: HeadFrame = { ...frame, quat: [0, s, 0, s] };
    const p = slugSplitPoint('crosshair', [0.09, 1.52, 0.04], turned);
    expect(p[0]).toBeCloseTo(0.09, 12);
    expect(p[1]).toBeCloseTo(1.52, 12);
    expect(p[2]).toBeCloseTo(0, 12);
  });
});

describe('decapitationRule: the head that is coming off', () => {
  const T = BURST_TUNING_DEFAULTS;
  it('a slug\'s decapitation pops after the swell; a pellet\'s, a blast\'s and a blade\'s are ordinary', () => {
    expect(decapitationRule('slug', T)).toBe(T.popSwellS);
    expect(decapitationRule('pellet', T)).toBeNull();
    expect(decapitationRule('other', T)).toBeNull();
  });
  it('the swell is the tuning\'s, and never negative: 0 pops on the frame of the hit', () => {
    expect(decapitationRule('slug', { ...T, popSwellS: 0 })).toBe(0);
    expect(decapitationRule('slug', { ...T, popSwellS: 0.3 })).toBe(0.3);
    expect(decapitationRule('slug', { ...T, popSwellS: -1 })).toBe(0);
  });
  it('slugPop off, or everything off: the head flies', () => {
    expect(decapitationRule('slug', { ...T, slugPop: false })).toBeNull();
    expect(decapitationRule('slug', { ...T, on: false })).toBeNull();
  });
  it('the shipped swell is short: at most 0.15 s', () => {
    expect(T.popSwellS).toBeGreaterThan(0);
    expect(T.popSwellS).toBeLessThanOrEqual(0.15);
  });
});
