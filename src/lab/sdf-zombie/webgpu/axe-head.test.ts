// src/lab/sdf-zombie/webgpu/axe-head.test.ts
import { describe, expect, it } from 'vitest';
import { AXE_HEAD, chopHead, chopOpenFrac, makeAxeHead } from './axe-head';

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
  it('openAngles are fractions of the preset\'s max, rising, below 1', () => {
    expect(AXE_HEAD.openAngles).toEqual([0.55, 0.8]);
  });
  it('chop 1 opens to 0.55, chop 2 widens to 0.8, the kill chop goes to 1 (and stays there)', () => {
    expect([1, 2, 3, 4].map(c => chopOpenFrac(c))).toEqual([0.55, 0.8, 1, 1]);
  });
  it('more chops to kill than angles: the last angle holds until the kill; fewer: the kill is 1 at once', () => {
    expect([1, 2, 3, 4, 5].map(c => chopOpenFrac(c, 5))).toEqual([0.55, 0.8, 0.8, 0.8, 1]);
    expect(chopOpenFrac(1, 1)).toBe(1);
    expect([1, 2].map(c => chopOpenFrac(c, 2))).toEqual([0.55, 1]);
  });
});
