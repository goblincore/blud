// src/lab/sdf-zombie/head-burst.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { BURST, burstPlan, burstTuning, classifyBurst, headRadius, hsOf, onHeadPrim, setBurstTuning } from './head-burst';
import { prim } from './head-pop';
import { mulberry32 } from './melt-bones';
import type { HeadFrame } from './head-deform';
import type { Vec3 } from './types';

const frame: HeadFrame = { centre: [0, 1.6, 0], quat: [0, 0, 0, 1], axes: [0.09, 0.11, 0.1] };
/** A slug travelling −z that crosses the head's front surface at world x = `x`. */
const shot = (x: number, y = 1.6) => ({ point: [x, y, 0.1] as Vec3, dir: [0, 0, -1] as Vec3 });

beforeEach(() => setBurstTuning({ on: true, centreFrac: 0.35, swell: 0.4, shardScale: 1, flapCount: -1, lethal: false, repeatStep: 0.04, craterScale: 1, splay: 0.1 }));

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
    expect(burstTuning.lethal).toBe(false);
    expect(burstTuning.repeatStep).toBeLessThan(0.1);
  });
  it('setBurstTuning returns a copy and updates burstTuning', () => {
    const t = setBurstTuning({ swell: 0.4 });
    expect(t.swell).toBe(0.4);
    expect(burstTuning.swell).toBe(0.4);
  });
});
