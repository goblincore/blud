import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coordinateWarmGate,
  createLoopController,
  type WarmGateHandlers,
  type WarmGatePhase,
  type WarmOutcome,
} from './warm-gate';

// THE REAL LIFECYCLE CONTRACT (2026-09-16 reviewer follow-up). The previous
// tests asserted the return values of two identity/ternary helpers and called
// that "the lifecycle contract"; the live defects were in the async
// coordination and in the snapshot-at-warm-start restore. These tests drive the
// actual coordinator with deferred promises and fake timers.

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function recordingHandlers() {
  const loader: { text: string; ready: boolean }[] = [];
  let readyCalls = 0;
  let failureText: string | null = null;
  const handlers: WarmGateHandlers = {
    setLoader(text, ready) { loader.push({ text, ready }); },
    revealReady() { readyCalls++; },
    revealFailure(text) { failureText = text; },
  };
  return {
    handlers,
    loader,
    get readyCalls() { return readyCalls; },
    get failureText() { return failureText; },
    texts: () => loader.map((l) => l.text),
  };
}

describe('coordinateWarmGate', () => {
  it('reveals READY only after a fast successful warm settles', async () => {
    const h = recordingHandlers();
    const res = await coordinateWarmGate({ warm: Promise.resolve<WarmOutcome>('ok'), timeoutMs: 15000, handlers: h.handlers });
    expect(res).toEqual({ phase: 'ready', timedOut: false });
    expect(h.readyCalls).toBe(1);
    expect(h.failureText).toBeNull();
    expect(h.texts().some((t) => t.includes('still compiling'))).toBe(false);
  });

  it('a slow success keeps the loader honest, then reveals READY', async () => {
    vi.useFakeTimers();
    const h = recordingHandlers();
    const warm = deferred<WarmOutcome>();
    const p = coordinateWarmGate({ warm: warm.promise, timeoutMs: 15000, handlers: h.handlers });
    expect(h.texts()[0]).toBe('compiling pipelines');

    await vi.advanceTimersByTimeAsync(15000);
    expect(h.readyCalls).toBe(0); // the bound alone NEVER reveals the game
    expect(h.texts().some((t) => t.includes('still compiling pipelines'))).toBe(true);

    warm.resolve('ok');
    const res = await p;
    expect(res).toEqual({ phase: 'ready', timedOut: true });
    expect(h.readyCalls).toBe(1);
  });

  it('does not present a FAILED warm as success', async () => {
    const h = recordingHandlers();
    const res = await coordinateWarmGate({ warm: Promise.resolve<WarmOutcome>('failed'), timeoutMs: 15000, handlers: h.handlers });
    expect(res.phase).toBe('warm-failed');
    expect(res.phase).not.toBe('ready');
    expect(h.readyCalls).toBe(0);
    expect(h.failureText).toContain('failed');
  });

  it('treats a REJECTED warm as failed, not as an unhandled rejection', async () => {
    const h = recordingHandlers();
    const res = await coordinateWarmGate({ warm: Promise.reject(new Error('boom')), timeoutMs: 15000, handlers: h.handlers });
    expect(res.phase).toBe('warm-failed');
    expect(h.readyCalls).toBe(0);
  });

  it('reports device loss even when the warm resolved ok', async () => {
    const h = recordingHandlers();
    const res = await coordinateWarmGate({
      warm: Promise.resolve<WarmOutcome>('ok'), timeoutMs: 15000, handlers: h.handlers,
      isDeviceLost: () => true,
    });
    expect(res.phase).toBe('device-lost' satisfies WarmGatePhase);
    expect(h.readyCalls).toBe(0);
    expect(h.failureText).toContain('device lost');
  });

  it('holds the reveal until the weapon (prereq) leg is also ready', async () => {
    const h = recordingHandlers();
    const prereq = deferred<void>();
    const p = coordinateWarmGate({ warm: Promise.resolve<WarmOutcome>('ok'), prereq: prereq.promise, timeoutMs: 15000, handlers: h.handlers });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.readyCalls).toBe(0);
    prereq.resolve();
    const res = await p;
    expect(res.phase).toBe('ready');
    expect(h.readyCalls).toBe(1);
  });
});

describe('createLoopController', () => {
  /** A fake renderer loop: `apply` is the only way the effective state moves. */
  function fakeLoop(initial: boolean) {
    let applied = initial;
    const calls: boolean[] = [];
    const ctl = createLoopController((on) => { applied = on; calls.push(on); }, initial);
    return { ctl, calls, state: () => applied };
  }

  it('restores a running loop after a clean warm', () => {
    const f = fakeLoop(true);
    f.ctl.suspend();
    expect(f.state()).toBe(false);
    expect(f.ctl.release()).toBe(true);
    expect(f.state()).toBe(true);
  });

  it('leaves a deliberately paused loop paused', () => {
    const f = fakeLoop(false);
    f.ctl.suspend();
    expect(f.ctl.release()).toBe(false);
    expect(f.state()).toBe(false);
  });

  it('respects a pause requested WHILE the warm is in flight (the old defect)', () => {
    const f = fakeLoop(true);
    f.ctl.suspend();             // warm pauses the loop...
    expect(f.state()).toBe(false);
    f.ctl.set(false);            // ...and a rig/bench pauses it deliberately
    expect(f.ctl.release()).toBe(false);
    expect(f.state()).toBe(false); // must NOT be restarted
  });

  it('respects a resume requested while the warm is in flight', () => {
    const f = fakeLoop(false);
    f.ctl.suspend();
    f.ctl.set(true);
    expect(f.state()).toBe(false); // still suspended for the warm
    expect(f.ctl.release()).toBe(true);
    expect(f.state()).toBe(true);
  });

  it('stays suspended until the last nested suspension releases', () => {
    const f = fakeLoop(true);
    f.ctl.suspend();
    f.ctl.suspend();
    f.ctl.release();
    expect(f.ctl.suspended).toBe(true);
    expect(f.state()).toBe(false);
    f.ctl.release();
    expect(f.ctl.suspended).toBe(false);
    expect(f.state()).toBe(true);
  });

  it('applies an external intent immediately when not suspended', () => {
    const f = fakeLoop(true);
    f.ctl.set(false);
    expect(f.state()).toBe(false);
    f.ctl.set(true);
    expect(f.state()).toBe(true);
    expect(f.calls).toEqual([false, true]);
  });
});

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.useRealTimers(); });
