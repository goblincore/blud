import { describe, expect, it } from 'vitest';
import { warmGateOutcome, restoreLoopState } from './warm-gate';

// The warm-up loader/loop lifecycle contract (startup-freeze task 2026-09-16).
// These two rules used to live inline in game-main.ts; extracting them makes
// the failure modes testable without a GPU. The live integration — a real
// warmPipelines() run with the loop deliberately paused — is asserted by
// scripts/startup-freeze-probe.mjs (`result.lifecycle.loopAfterPausedWarm`),
// which is the check that would have caught the unconditional restart.
describe('warm-gate', () => {
  it('reports ready only when the warm-up actually settled', () => {
    expect(warmGateOutcome(false)).toBe('ready');
  });

  it('never reports ready on the 15 s bound alone — the loader stays up', () => {
    // Regression: the old Promise.race resolved the gate at 15 s and the loader
    // said READY while warmPipelines was still running with the loop paused.
    expect(warmGateOutcome(true)).toBe('still-compiling');
    expect(warmGateOutcome(true)).not.toBe('ready');
  });

  it('restores the loop state it found — a paused loop stays paused', () => {
    // Regression: the old `finally` called setLoopRunning(true) unconditionally.
    expect(restoreLoopState(false)).toBe(false);
    expect(restoreLoopState(true)).toBe(true);
  });
});
