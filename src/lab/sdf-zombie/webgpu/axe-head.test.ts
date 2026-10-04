// src/lab/sdf-zombie/webgpu/axe-head.test.ts
import { describe, expect, it } from 'vitest';
import { AXE_HEAD, chopHead, makeAxeHead } from './axe-head';

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
