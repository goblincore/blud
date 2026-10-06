// src/lab/sdf-zombie/webgpu/axe-head.test.ts
import { describe, expect, it } from 'vitest';
import { AXE_HEAD, chopHead, chopKick, chopOpenFrac, headChopCut, makeAxeHead, chopOnHead } from './axe-head';
import { HEAD_SPLIT } from '../head-split';

describe('head chops: cut, cut, ..., kill on chopsToKill', () => {
  it(`the default kills on chop ${AXE_HEAD.chopsToKill} (debug default 3)`, () => {
    expect(AXE_HEAD.chopsToKill).toBe(3);
    let st = makeAxeHead();
    const actions: string[] = [];
    for (let i = 0; i < 3; i++) { const r = chopHead(st); actions.push(r.action); st = r.state; }
    expect(actions).toEqual(['cut', 'cut', 'kill']);
  });
  it('each chop gets its own number (1-based): the head wound region is unique per chop', () => {
    let st = makeAxeHead();
    const r1 = chopHead(st); st = r1.state;
    const r2 = chopHead(st);
    expect([r1.chop, r2.chop]).toEqual([1, 2]);
  });
  it('a dead head keeps taking cuts but never kills twice', () => {
    let st = makeAxeHead();
    for (let i = 0; i < 3; i++) st = chopHead(st).state;
    const r = chopHead(st);
    expect(r.action).toBe('cut');
    expect(r.state.dead).toBe(true);
    expect(r.chop).toBe(4);
  });
  it('chopsToKill is a parameter: 1 kills at once, 5 takes five', () => {
    expect(chopHead(makeAxeHead(), 1).action).toBe('kill');
    let st = makeAxeHead(); const acts: string[] = [];
    for (let i = 0; i < 5; i++) { const r = chopHead(st, 5); acts.push(r.action); st = r.state; }
    expect(acts).toEqual(['cut', 'cut', 'cut', 'cut', 'kill']);
  });
});

describe('the head split\'s opening per chop (part B)', () => {
  const [first, second] = AXE_HEAD.openAngles;
  it('openAngles are fractions of the preset\'s max: rising, above closed, the last no further than fully open', () => {
    expect(AXE_HEAD.openAngles.length).toBeGreaterThan(0);
    AXE_HEAD.openAngles.forEach((v, i) => {
      expect(v).toBeGreaterThan(i === 0 ? 0 : AXE_HEAD.openAngles[i - 1]!);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
  it('the axe skips the thin crack: chop 1 is the skull\'s second stage, chop 2 its third (split wide), before the kill', () => {
    const stages = HEAD_SPLIT.skull.follow.map(k => k[0]);
    expect(first).toBe(stages[1]);
    expect(second).toBe(stages[2]);
    expect(second).toBe(1);
    expect(first).toBeGreaterThan(stages[0]!);
  });
  it('chop 1 opens to the first angle, chop 2 widens to the second, the kill chop goes to 1 (and stays there)', () => {
    expect([1, 2, 3, 4].map(c => chopOpenFrac(c, 3))).toEqual([first, second, 1, 1]);
    expect(chopOpenFrac(AXE_HEAD.chopsToKill)).toBe(1);
    expect(chopOpenFrac(1)).toBe(AXE_HEAD.chopsToKill > 1 ? first : 1);
  });
  it('more chops to kill than angles: the last angle holds until the kill; fewer: the kill is 1 at once', () => {
    expect([1, 2, 3, 4, 5].map(c => chopOpenFrac(c, 5))).toEqual([first, second, second, second, 1]);
    expect(chopOpenFrac(1, 1)).toBe(1);
    expect([1, 2].map(c => chopOpenFrac(c, 2))).toEqual([first, 1]);
  });
});

describe('the kill\'s kick (chopKick)', () => {
  it('no kick before the kill chop; killKick from it on (a chop on the corpse\'s open head kicks too)', () => {
    expect(AXE_HEAD.killKick).toBeGreaterThan(0);
    expect(AXE_HEAD.killKick).toBeLessThan(1);
    expect([1, 2, 3, 4, 5].map(c => chopKick(c))).toEqual([0, 0, AXE_HEAD.killKick, AXE_HEAD.killKick, AXE_HEAD.killKick]);
    expect([1, 2].map(c => chopKick(c, 2, 0.5))).toEqual([0, 0.5]);
    expect(chopKick(3, 3, 0)).toBe(0);
  });
});

describe('what a head chop cuts (headChopCut)', () => {
  const eps = HEAD_SPLIT.skinEps;
  it('the chop that opens the head: the split\'s faces are its cut, wherever it landed', () => {
    expect(headChopCut(true, null)).toBe('faces');
    expect(headChopCut(true, -0.05)).toBe('faces');
  });
  it('a head that is not split (closed, or one the split refused): the chop\'s own cut, always', () => {
    expect(headChopCut(false, null)).toBe('own');
  });
  it('an open head: its own cut on the outer skin (the closed head\'s field within skinEps of zero), none on a cut face or in the gap', () => {
    expect(headChopCut(false, 0)).toBe('own');
    expect(headChopCut(false, -eps)).toBe('own');
    expect(headChopCut(false, eps)).toBe('own');
    expect(headChopCut(false, -eps - 1e-6)).toBe('none');     // inside the closed head: a cut face, the gap's floor
    expect(headChopCut(false, -0.09)).toBe('none');
    expect(headChopCut(false, eps + 1e-6)).toBe('none');      // off the closed head altogether
  });
});

describe('a chop is on the head when it lands on head flesh', () => {
  it('the struck prim\'s limb decides: the head, and nothing else (no limb: not on the head)', () => {
    expect(chopOnHead('head')).toBe(true);
    for (const limb of ['torso', 'armL', 'armR', 'legL', 'legR', undefined] as const) expect(chopOnHead(limb), String(limb)).toBe(false);
  });
});
