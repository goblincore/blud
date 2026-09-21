// src/lab/sdf-zombie/webgpu/seam-merge.test.ts
import { describe, expect, it } from 'vitest';
import { mergeSeams } from './seam-merge';

describe('mergeSeams', () => {
  it('keeps a getter LIVE — the bug an object spread introduces', () => {
    const state = { shells: 2 };
    const factory = { get shells() { return state.shells; } };

    // The failure mode, pinned so the reason for this module stays visible:
    const spread = { ...factory };
    state.shells = 0;
    expect(spread.shells).toBe(2); // frozen at the moment of the spread

    state.shells = 2;
    const merged = mergeSeams(factory);
    state.shells = 0;
    expect(merged.shells).toBe(0);
    state.shells = 1;
    expect(merged.shells).toBe(1);
  });

  it('carries the accessor itself, not a data property', () => {
    const merged = mergeSeams({ get x() { return 1; } });
    const d = Object.getOwnPropertyDescriptor(merged, 'x')!;
    expect(typeof d.get).toBe('function');
    expect('value' in d).toBe(false);
  });

  it('does not invoke any getter while merging', () => {
    let calls = 0;
    mergeSeams({ get a() { calls++; return 1; } }, { get b() { calls++; return 2; } });
    expect(calls).toBe(0);
  });

  it('lets a later part win a name clash, exactly as a later spread would', () => {
    const merged = mergeSeams({ a: 1, b: 1 }, { get a() { return 2; } }, { b: 3 });
    expect(merged.a).toBe(2);
    expect(merged.b).toBe(3);
  });

  it('keeps functions, `this`-free closures and key order', () => {
    let n = 0;
    const merged = mergeSeams({ inc: () => ++n, z: 0 }, { a: 1 });
    expect(merged.inc()).toBe(1);
    expect(Object.keys(merged)).toEqual(['inc', 'z', 'a']);
  });

  it('keeps nested objects by reference, so THEIR getters stay live too', () => {
    const state = { active: false };
    const merged = mergeSeams({ telemetry: { get active() { return state.active; } } });
    state.active = true;
    expect(merged.telemetry.active).toBe(true);
  });
});

