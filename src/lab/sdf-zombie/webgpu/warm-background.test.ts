import { describe, expect, it } from 'vitest';
import { createWarmBackgroundTracker } from './warm-background';

// THE BACKGROUND-COMPILE CONTRACT (defer-compile task, 2026-09-19).
//
// The gib/chunk march program and the crowd march program are compiled AFTER
// the loader hides. While a program is not ready its consumer must DEGRADE —
// never trigger a synchronous march-family compile, never make a crowd member
// invisible. This module is the pure decision: which state each job is in and
// what each consumer does per state. The renderer wiring (three's not-ready
// pipeline SKIP, the per-body fallback) is tested where it lives; here the
// contract is the state machine itself.

describe('warm-background tracker', () => {
  it('starts every job pending and degrades safely', () => {
    const t = createWarmBackgroundTracker();
    expect(t.state('gib')).toBe('pending');
    expect(t.state('crowd')).toBe('pending');
    expect(t.gibDraw()).toBe('skip');
    expect(t.crowdPath()).toBe('fallback');
    expect(t.isReady('gib')).toBe(false);
    expect(t.isReady('crowd')).toBe(false);
  });

  it('a started job is compiling and still degrades', () => {
    const t = createWarmBackgroundTracker();
    t.start('gib');
    expect(t.state('gib')).toBe('compiling');
    expect(t.gibDraw()).toBe('skip');
    t.start('crowd');
    expect(t.state('crowd')).toBe('compiling');
    expect(t.crowdPath()).toBe('fallback');
  });

  it('a successful settle enables the fast path', () => {
    const t = createWarmBackgroundTracker();
    t.start('gib');
    t.settle('gib', true);
    t.start('crowd');
    t.settle('crowd', true);
    expect(t.state('gib')).toBe('ready');
    expect(t.state('crowd')).toBe('ready');
    expect(t.gibDraw()).toBe('draw');
    expect(t.crowdPath()).toBe('crowd');
  });

  it('a failed settle never stalls: the consumers keep degrading', () => {
    const t = createWarmBackgroundTracker();
    t.start('gib');
    t.settle('gib', false);
    t.start('crowd');
    t.settle('crowd', false);
    expect(t.state('gib')).toBe('failed');
    expect(t.state('crowd')).toBe('failed');
    expect(t.gibDraw()).toBe('skip');
    expect(t.crowdPath()).toBe('fallback');
  });

  it('settles a job that never started (pending -> ready/failed)', () => {
    const t = createWarmBackgroundTracker();
    t.settle('crowd', true);
    expect(t.state('crowd')).toBe('ready');
    const u = createWarmBackgroundTracker();
    u.settle('gib', false);
    expect(u.state('gib')).toBe('failed');
  });

  it('start is idempotent while pending or compiling', () => {
    const t = createWarmBackgroundTracker();
    t.start('gib');
    t.start('gib');
    expect(t.state('gib')).toBe('compiling');
  });

  it('ready is terminal: a late start or failed settle cannot regress it', () => {
    const t = createWarmBackgroundTracker();
    t.start('gib');
    t.settle('gib', true);
    t.start('gib');
    t.settle('gib', false);
    expect(t.state('gib')).toBe('ready');
    expect(t.gibDraw()).toBe('draw');
  });

  it('failed is terminal: a late successful settle cannot enable the fast path', () => {
    const t = createWarmBackgroundTracker();
    t.start('crowd');
    t.settle('crowd', false);
    t.start('crowd');
    t.settle('crowd', true);
    expect(t.state('crowd')).toBe('failed');
    expect(t.crowdPath()).toBe('fallback');
  });

  it('snapshot exposes both jobs as plain, JSON-serialisable data', () => {
    const t = createWarmBackgroundTracker();
    t.start('gib');
    expect(t.snapshot()).toEqual({ gib: 'compiling', crowd: 'pending' });
  });
});
