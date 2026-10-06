// src/lab/sdf-zombie/head-deform-burst.test.ts
import { describe, expect, it } from 'vitest';
import { BURST_DEFORM, applyHeadAffine, headAffine, kickBurst, kickWobble, makeHeadDeform, stepBurst, stepWobble, type HeadFrame } from './head-deform';

const frame: HeadFrame = { centre: [0, 1.6, 0], quat: [0, 0, 0, 1], axes: [0.09, 0.11, 0.1] };
const settle = (st: ReturnType<typeof makeHeadDeform>, secs: number) => {
  let s = st;
  for (let t = 0; t < secs; t += 1 / 240) s = stepBurst(s, 1 / 240);
  return s;
};

describe('kickBurst / stepBurst', () => {
  it('kicks to the swell peak with a lasting rest and records the axis and sign', () => {
    const s = kickBurst(makeHeadDeform(), [0, 0, -1], 1);
    expect(s.bu).toMatchObject({ axis: 2, sign: -1, v: 0 });
    expect(s.bu!.b).toBeCloseTo(BURST_DEFORM.swell, 9);
    expect(s.bu!.rest).toBeCloseTo(BURST_DEFORM.swell * BURST_DEFORM.rest, 9);
  });
  it('severity scales the peak (0.5 + 0.5·severity) and the peak is capped', () => {
    expect(kickBurst(makeHeadDeform(), [1, 0, 0], 0).bu!.b).toBeCloseTo(BURST_DEFORM.swell * 0.5, 9);
    expect(kickBurst(makeHeadDeform(), [1, 0, 0], 1, 5).bu!.b).toBe(BURST_DEFORM.maxB);
  });
  it('rings past its rest (underdamped) and settles to EXACTLY rest with zero velocity', () => {
    let s = kickBurst(makeHeadDeform(), [0, 0, -1], 1);
    let min = Infinity;
    for (let t = 0; t < 1.6; t += 1 / 240) { s = stepBurst(s, 1 / 240); min = Math.min(min, s.bu!.b); }
    expect(min).toBeLessThan(s.bu!.rest);
    expect(s.bu!.b).toBe(s.bu!.rest);
    expect(s.bu!.v).toBe(0);
  });
  it('stepBurst on a head with no burst returns the same object', () => {
    const s = makeHeadDeform();
    expect(stepBurst(s, 1 / 60)).toBe(s);
  });
});

describe('the burst in the head affine', () => {
  it('is null with no wobble, dents or burst, and non-null after a burst even once settled', () => {
    expect(headAffine(makeHeadDeform(), frame)).toBeNull();
    const rested = settle(kickBurst(makeHeadDeform(), [0, 0, -1], 1), 2);
    expect(headAffine(rested, frame)).not.toBeNull();
  });
  it('at rest the ENTRY side stays put and the EXIT side bulges by 2·rest·axis', () => {
    const rested = settle(kickBurst(makeHeadDeform(), [0, 0, -1], 1), 2);
    const rest = rested.bu!.rest;
    const m = headAffine(rested, frame)!;
    const entry = applyHeadAffine(m, [0, 1.6, 0.1]);   // the +z side: the shot came from there
    const exit = applyHeadAffine(m, [0, 1.6, -0.1]);
    expect(entry[2]).toBeCloseTo(0.1, 6);
    expect(exit[2]).toBeCloseTo(-0.1 * (1 + 2 * rest), 6);
  });
  it('while swelling the head also widens ACROSS the shot; once settled it does not', () => {
    const kicked = kickBurst(makeHeadDeform(), [0, 0, -1], 1);
    const wide = applyHeadAffine(headAffine(kicked, frame)!, [0.09, 1.6, 0]);
    expect(wide[0]).toBeGreaterThan(0.09 * 1.05);
    const rested = settle(kicked, 2);
    expect(applyHeadAffine(headAffine(rested, frame)!, [0.09, 1.6, 0])[0]).toBeCloseTo(0.09, 6);
  });
  it('composes with the wobble: both terms move the head', () => {
    const both = stepWobble(kickWobble(kickBurst(makeHeadDeform(), [0, 0, -1], 1), [1, 0, 0]), 1 / 120);
    const m = headAffine(both, frame)!;
    expect(m.mul[2]).toBeGreaterThan(1);   // the burst axis stretched
    expect(m.mul[0]).not.toBe(1);          // the wobble axis squashed
  });
});

describe('splay: a lasting widening across the shot', () => {
  it('kickBurst records it and the settled head stays wider across the shot by that much', () => {
    const kicked = kickBurst(makeHeadDeform(), [0, 0, -1], 1, BURST_DEFORM.swell, 0.1);
    expect(kicked.bu!.splay).toBe(0.1);
    const rested = settle(kicked, 2);
    expect(applyHeadAffine(headAffine(rested, frame)!, [0.09, 1.6, 0])[0]).toBeCloseTo(0.09 * 1.1, 6);
  });
  it('defaults to none', () => {
    expect(kickBurst(makeHeadDeform(), [0, 0, -1], 1).bu!.splay).toBe(0);
  });
});
