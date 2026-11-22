// src/lab/sdf-zombie/webgpu/emit-push.test.ts
//
// The emitter push steps (?emitpush=spill,exit,key): the param, the converter's per-combo lights, the bake
// multipliers and the key's power ranking.

import { describe, expect, it } from 'vitest';
import {
  EMIT_PUSH_STEPS, EXIT_DIM_BAKE_M, EXIT_FLUORO_BAKE, EXIT_SIGN_BAKE, KEY_SCALE_MAX, KEY_SCALE_MIN, keepPushedLight,
  keyPowerRef, keyRankScale, parseEmitPush, pushBakeGains, pushCombo, SPILL_SCREEN_BAKE, type PushSurface,
} from './emit-push';

const steps = (s: string | null) => [...parseEmitPush(s)].sort();

describe('parseEmitPush', () => {
  it('no param, empty or all: every step; none: none; a list: those, unknown names ignored', () => {
    expect(steps(null)).toEqual([...EMIT_PUSH_STEPS].sort());
    expect(steps('')).toEqual([...EMIT_PUSH_STEPS].sort());
    expect(steps('all')).toEqual([...EMIT_PUSH_STEPS].sort());
    expect(steps('none')).toEqual([]);
    expect(steps('exit, key,bogus')).toEqual(['exit', 'key']);
  });
});

describe('pushCombo / keepPushedLight', () => {
  it('names the placement combo of spill and exit (key is runtime only)', () => {
    expect(pushCombo(parseEmitPush('none'))).toBe('none');
    expect(pushCombo(parseEmitPush('key'))).toBe('none');
    expect(pushCombo(parseEmitPush('spill,key'))).toBe('spill');
    expect(pushCombo(parseEmitPush('exit'))).toBe('exit');
    expect(pushCombo(parseEmitPush(null))).toBe('spill+exit');
  });
  it('an untagged light is in every combo; a tagged one only in its combos', () => {
    expect(keepPushedLight(undefined, parseEmitPush('none'))).toBe(true);
    expect(keepPushedLight(['spill', 'spill+exit'], parseEmitPush('spill'))).toBe(true);
    expect(keepPushedLight(['spill', 'spill+exit'], parseEmitPush('exit'))).toBe(false);
    expect(keepPushedLight(['none', 'exit'], parseEmitPush('none'))).toBe(true);
    expect(keepPushedLight(['none', 'exit'], parseEmitPush(null))).toBe(false);
  });
});

describe('pushBakeGains', () => {
  const surf = (kind: string, cls: PushSurface['cls'], x: number, zone = 0, w = 1): PushSurface =>
    ({ kind, cls, zone, centre: [x, 2, 0], min: [x - w, -w], max: [x + w, w] });
  const s = [surf('screenBank', 'screen', 0), surf('viewscreen', 'screen', 20), surf('exitSign', 'sign', 40),
    surf('fluorescent', 'fluoro', 40 + EXIT_DIM_BAKE_M - 0.5, 0, 0.1), surf('fluorescent', 'fluoro', 40 + EXIT_DIM_BAKE_M + 2, 0, 0.1),
    surf('fluorescent', 'fluoro', 42, 1)];
  it('none: the B1 bake everywhere', () => { expect(pushBakeGains(s, parseEmitPush('none'))).toEqual([1, 1, 1, 1, 1, 1]); });
  it('spill: screen banks only (not the viewscreen)', () => {
    expect(pushBakeGains(s, parseEmitPush('spill'))).toEqual([SPILL_SCREEN_BAKE, 1, 1, 1, 1, 1]);
  });
  it('exit: the sign up, fluorescents near it in its zone down, a far one or another zone\'s unchanged', () => {
    expect(pushBakeGains(s, parseEmitPush('exit'))).toEqual([1, 1, EXIT_SIGN_BAKE, EXIT_FLUORO_BAKE, 1, 1]);
  });
  it('a fluorescent ceiling whose box holds the sign counts as near, however far its middle', () => {
    const big: PushSurface = { kind: 'fluorescent', cls: 'fluoro', zone: 0, centre: [60, 3, 0], min: [30, -5], max: [90, 5] };
    expect(pushBakeGains([surf('exitSign', 'sign', 40), big], parseEmitPush('exit'))[1]).toBe(EXIT_FLUORO_BAKE);
  });
});

describe('the key: rank by power', () => {
  it('the reference is the median positive power', () => {
    expect(keyPowerRef([])).toBe(0);
    expect(keyPowerRef([0, -1])).toBe(0);
    expect(keyPowerRef([1.5, 10, 5.5])).toBe(5.5);
    expect(keyPowerRef([2, 8, 4, 6])).toBe(5);
  });
  it('a lamp ranks by power over the reference, clamped; equal powers rank as before', () => {
    expect(keyRankScale(8, 8)).toBe(1);
    expect(keyRankScale(10, 5)).toBe(2);
    expect(keyRankScale(1000, 5)).toBe(KEY_SCALE_MAX);
    expect(keyRankScale(0.01, 5)).toBe(KEY_SCALE_MIN);
    expect(keyRankScale(3, 0)).toBe(1);
  });
});
