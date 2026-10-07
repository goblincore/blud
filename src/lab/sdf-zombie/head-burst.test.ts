// src/lab/sdf-zombie/head-burst.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BURST, BURST_TUNING_DEFAULTS, burstPlan, burstTuning, classifyBurst, decapitationRule, headRadius, headShotRule, hsOf, onHeadPrim,
  setBurstTuning, type HeadShot,
} from './head-burst';
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
  const shot = (o: Partial<HeadShot> = {}): HeadShot => ({ kind: 'slug', offset: 0.9, splitOpen: false, splitShare: o.splitOpen ? 1 : 0, splitRefused: false, ...o });
  /** The tuning before 2026-10-07: every gun hit on the head made the opening. */
  const OLD = { ...T, opening: true, anyWeapon: true, alwaysSplit: true, slugSplit: false, slugPop: false, popOnSplit: false };

  it('a pellet on a head is always an ordinary wound: closed, split open, centred or not', () => {
    for (const offset of [0, 0.5, 1.2, 2]) for (const splitOpen of [false, true]) for (const splitRefused of [false, true]) {
      expect(headShotRule(shot({ kind: 'pellet', offset, splitOpen, splitRefused }), T)).toBe('ordinary');
    }
  });
  it('a centred slug on a closed head splits it; an off-centre one is an ordinary slug wound', () => {
    expect(headShotRule(shot({ offset: 0 }), T)).toBe('split');
    expect(headShotRule(shot({ offset: T.splitFrac - 0.01 }), T)).toBe('split');
    expect(headShotRule(shot({ offset: T.splitFrac }), T)).toBe('ordinary');
    expect(headShotRule(shot({ offset: 2 }), T)).toBe('ordinary');
  });
  it('an aimed slug splits: the measured offsets of a slug aimed at the head centre and at the face are under splitFrac', () => {
    // scripts/head-burst-look.mjs's aim probe on the zombie, 0.8 to 4 m: the crosshair on the head's centre, and 2 cm lower.
    for (const offset of [0.891, 0.923, 0.946, 0.991, 1.03, 1.071, 1.101, 1.125, 1.168, 1.208]) expect(headShotRule(shot({ offset }), T)).toBe('split');
  });
  it('the threshold is the tuning\'s: a tighter splitFrac leaves the same slug ordinary', () => {
    expect(headShotRule(shot({ offset: 0.9 }), { ...T, splitFrac: 0.5 })).toBe('ordinary');
    expect(headShotRule(shot({ offset: 0.3 }), { ...T, splitFrac: 0.5 })).toBe('split');
  });
  it('a head the split would refuse (the flail has damaged it) takes the centred slug as an ordinary wound', () => {
    expect(headShotRule(shot({ offset: 0.2, splitRefused: true }), T)).toBe('ordinary');
  });
  it('slugSplit off: no slug splits', () => {
    expect(headShotRule(shot({ offset: 0 }), { ...T, slugSplit: false })).toBe('ordinary');
  });
  it('a centred slug on a head already split pops it; an off-centre slug there is ordinary; popOnSplit off, both are', () => {
    expect(headShotRule(shot({ offset: 0.4, splitOpen: true }), T)).toBe('pop');
    expect(headShotRule(shot({ offset: T.splitFrac + 0.1, splitOpen: true }), T)).toBe('ordinary');
    expect(headShotRule(shot({ offset: 0.4, splitOpen: true }), { ...T, popOnSplit: false })).toBe('ordinary');
    // The split's own switch does not matter once the head is open: the axe may have opened it.
    expect(headShotRule(shot({ offset: 0.4, splitOpen: true }), { ...T, slugSplit: false })).toBe('pop');
  });
  it('only a head split wide pops: one that is cracked under popSplitMin takes the centred slug as an ordinary wound', () => {
    expect(headShotRule(shot({ offset: 0.4, splitOpen: true, splitShare: 0.25 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ offset: 0.4, splitOpen: true, splitShare: T.popSplitMin }), T)).toBe('pop');
    // The axe's first chop (0.8 of the angle) and the slug's own split (1) are wide.
    expect(headShotRule(shot({ offset: 0.4, splitOpen: true, splitShare: 0.8 }), T)).toBe('pop');
    expect(headShotRule(shot({ offset: 0.4, splitOpen: true, splitShare: 0.25 }), { ...T, popSplitMin: 0 })).toBe('pop');
  });
  it('the orders: off-centre then centred splits; centred then centred splits then pops', () => {
    // An ordinary slug wound leaves no state: the next slug is judged on a closed, unrefused head.
    expect(headShotRule(shot({ offset: 1.4 }), T)).toBe('ordinary');
    expect(headShotRule(shot({ offset: 0.9 }), T)).toBe('split');
    expect(headShotRule(shot({ offset: 0.9, splitOpen: true }), T)).toBe('pop');
  });
  it('switched off, every round is ordinary', () => {
    for (const kind of ['pellet', 'slug'] as const) for (const splitOpen of [false, true]) {
      expect(headShotRule(shot({ kind, offset: 0, splitOpen }), { ...OLD, on: false })).toBe('ordinary');
      expect(headShotRule(shot({ kind, offset: 0, splitOpen }), { ...T, on: false })).toBe('ordinary');
    }
  });
  it('the opening, switched on, takes every slug on a closed head before the split is asked, and pellets with anyWeapon', () => {
    expect(headShotRule(shot({ offset: 0 }), { ...T, opening: true })).toBe('opening');
    expect(headShotRule(shot({ offset: 2 }), { ...T, opening: true })).toBe('opening');
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
