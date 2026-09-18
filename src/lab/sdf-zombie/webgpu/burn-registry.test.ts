// src/lab/sdf-zombie/webgpu/burn-registry.test.ts
//
// The lazy contract is the point: nothing allocated until an ignite, nothing
// lost on a put-out, and a released actor leaves no state behind for the next
// body that reuses its key.

import { describe, expect, it } from 'vitest';
import { createBurnRegistry } from './burn-registry';
import type { BurnRates } from '../burn-state';

const RATES: BurnRates = { igniteSec: 0.45, extinguishSec: 0.8, charRate: 0.22, corpseBurnSec: 6 };
const STEP = 1 / 60;

describe('burn registry', () => {
  it('allocates nothing until the first ignite', () => {
    const r = createBurnRegistry<string>();
    expect(r.size).toBe(0);
    expect(r.get('a')).toBeUndefined();
    expect(r.has('a')).toBe(false);
    r.step(STEP, RATES);          // stepping an empty registry is a no-op
    expect(r.size).toBe(0);
    r.ignite('a');
    expect(r.size).toBe(1);
    expect(r.has('a')).toBe(true);
  });

  it('does not light a body via ensure', () => {
    const r = createBurnRegistry<string>();
    const s = r.ensure('a');
    expect(s.alight).toBe(false);
    r.step(1, RATES);
    expect(r.get('a')!.burn).toBe(0);
  });

  it('ignites, ramps and reports active keys', () => {
    const r = createBurnRegistry<string>();
    r.ignite('a');
    r.step(0.2, RATES);
    expect(r.get('a')!.burn).toBeGreaterThan(0);
    const seen: string[] = [];
    r.forEachActive((k) => seen.push(k));
    expect(seen).toEqual(['a']);
  });

  it('keeps char across a put-out and a re-ignite', () => {
    const r = createBurnRegistry<string>();
    r.ignite('a');
    for (let i = 0; i < 120; i++) r.step(STEP, RATES);   // 2 s: well charred
    const charred = r.get('a')!.char;
    expect(charred).toBeGreaterThan(0.2);
    r.extinguishAll();
    for (let i = 0; i < 120; i++) r.step(STEP, RATES);
    const cold = r.get('a')!;
    expect(cold.burn).toBe(0);
    expect(cold.char).toBeGreaterThanOrEqual(charred);
    r.ignite('a');
    expect(r.get('a')!.char).toBeGreaterThanOrEqual(charred);
  });

  it('kill starts a burn-down only for a tracked key', () => {
    const r = createBurnRegistry<string>();
    r.kill('nope');
    expect(r.size).toBe(0);
    r.ignite('a');
    for (let i = 0; i < 60; i++) r.step(STEP, RATES);
    r.kill('a');
    expect(r.get('a')!.dying).toBe(true);
    r.step(0.5, RATES);
    expect(r.get('a')!.corpseSec).toBeCloseTo(0.5, 6);
  });

  it('release drops the key and everything keyed to it', () => {
    const r = createBurnRegistry<string>();
    r.ignite('a');
    r.release('a');
    expect(r.size).toBe(0);
    expect(r.get('a')).toBeUndefined();
    // A new body on the same key starts clean — no inherited char.
    expect(r.ignite('a').char).toBe(0);
  });

  it('forEachActive skips a body that is out and cold', () => {
    const r = createBurnRegistry<string>();
    r.ignite('a');
    r.extinguishAll();
    for (let i = 0; i < 120; i++) r.step(STEP, RATES);
    const seen: string[] = [];
    r.forEachActive((k) => seen.push(k));
    expect(seen).toEqual([]);
    expect(r.size).toBe(1);       // still tracked, just not active
  });
});
