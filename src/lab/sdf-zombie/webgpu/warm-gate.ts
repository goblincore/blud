// src/lab/sdf-zombie/webgpu/warm-gate.ts
//
// THE WARM-UP'S LIFECYCLE CONTRACT (startup-freeze task, 2026-09-16;
// corrected 2026-09-16 after reviewer review of the first pass).
//
// The first pass shipped two trivial helpers — `warmGateOutcome(timedOut)` and
// `restoreLoopState(wasRunning)` — and called the identity/ternary tests of
// those helpers "the lifecycle contract". That tested nothing real, and the
// live behaviour had two defects the helpers could not see:
//
//   1. THE LOADER COULD STILL CLAIM READY AFTER A RECORDED WARM ERROR.
//      `warmPipelines` catches its own throw (so the flipped objects are
//      restored and `__warmDone` is written), which means its promise RESOLVES
//      on failure. Anything that only awaits resolution therefore treats a
//      failed warm (`__warmDone.error` set) as success.
//
//   2. RESTORING THE STATE OBSERVED AT WARM START IGNORES A LATER PAUSE.
//      A bench/rig that paused (or resumed) the loop WHILE the warm was in
//      flight had its intent overwritten by `restoreLoopState(wasRunning)` in
//      the finally.
//
// This module now owns the real asynchronous coordinator and the loop-intent
// controller. Both are exercised by warm-gate.test.ts with deferred promises
// and fake timers — slow success, failure, device loss and pause-during-warm —
// not by asserting ternary return values.
//
// The live integration is verified by scripts/startup-freeze-probe.mjs, which
// re-runs the warm through `__sdfGame.rewarm()` with the loop deliberately
// paused and asserts loopRunning() stays false, and pauses it WHILE the warm is
// in flight to assert the later intent wins.

/** What the warm-up actually did. `failed` covers a thrown warm-up AND a
 *  rejected promise; both are recorded, neither is success. */
export type WarmOutcome = 'ok' | 'failed';

/** The loader phase this coordinator settles on. */
export type WarmGatePhase = 'compiling' | 'still-compiling' | 'ready' | 'warm-failed' | 'device-lost';

export interface WarmGateResult {
  phase: WarmGatePhase;
  /** True when the 15 s bound fired before the warm settled. The warm is still
   *  awaited; the phase then reflects its real outcome. */
  timedOut: boolean;
}

export interface WarmGateHandlers {
  /** Loader text; `ready` false means "not playable yet". */
  setLoader(text: string, ready: boolean): void;
  /** Show READY and schedule the ready auto-hide. */
  revealReady(): void;
  /** Reveal after a non-fatal warm failure. Honest wording; the game is
   *  playable but NOT presented as successfully compiled. */
  revealFailure(text: string): void;
}

export interface WarmGateOptions {
  warm: Promise<WarmOutcome>;
  /** Boot leg the game also needs (the weapon GLB). Awaited before reveal. */
  prereq?: Promise<unknown>;
  timeoutMs: number;
  handlers: WarmGateHandlers;
  /** Sampled when the warm settles. A device that was lost makes an `ok`
   *  outcome meaningless — the pipelines did not survive. */
  isDeviceLost?: () => boolean;
  /** Injectable timers (tests use vi.useFakeTimers or these). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Runs the boot loader gate for real:
 *
 *   compiling → (15 s bound, optional) still-compiling → ready
 *                                                    ↘ warm-failed
 *                                                    ↘ device-lost
 *
 * A timeout NEVER reveals the game on its own: it changes the wording and the
 * coordinator keeps awaiting the warm. A failed warm is revealed with honest
 * wording and the `warm-failed` phase; it is never reported READY.
 */
export async function coordinateWarmGate(opts: WarmGateOptions): Promise<WarmGateResult> {
  const { warm, prereq = Promise.resolve(), timeoutMs, handlers, isDeviceLost } = opts;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  handlers.setLoader('compiling pipelines', false);

  let settled = false;
  let timedOut = false;
  // Boxed so TypeScript's control-flow narrowing does not pin it to 'ok'
  // (the only assignment it can see is the initializer).
  const state: { outcome: WarmOutcome } = { outcome: 'ok' };
  let timer: unknown = null;

  // A rejected warm is a failed warm, not an unhandled rejection.
  const warmTracked: Promise<WarmOutcome> = warm.then(
    (o) => { settled = true; state.outcome = o; return o; },
    () => { settled = true; state.outcome = 'failed'; return 'failed' as WarmOutcome; },
  );

  const bound = await new Promise<'settled' | 'timeout'>((resolve) => {
    let done = false;
    timer = setTimer(() => {
      if (done) return;
      done = true;
      timedOut = true;
      resolve('timeout');
    }, timeoutMs);
    void warmTracked.then(() => {
      if (done) return;
      done = true;
      resolve('settled');
    });
  });
  if (timer !== null) clearTimer(timer);

  // The weapon load and the warm both gate the reveal; the timeout only
  // changes the message, so the prereq is still awaited.
  await prereq;
  if (bound === 'timeout' && !settled) {
    handlers.setLoader('still compiling pipelines — the first boot after a shader change can take 1–2 min; the game starts when this finishes', false);
    await warmTracked;
  }

  if (isDeviceLost?.()) {
    handlers.revealFailure('GPU device lost during warm-up — continuing in degraded state (see console)');
    return { phase: 'device-lost', timedOut };
  }
  if (state.outcome === 'failed') {
    handlers.revealFailure('pipeline warm-up failed — continuing without full precompile (see console)');
    return { phase: 'warm-failed', timedOut };
  }
  handlers.revealReady();
  return { phase: 'ready', timedOut };
}

// ---------------------------------------------------------------------------
// Loop-intent controller
// ---------------------------------------------------------------------------

export interface LoopController {
  /** A rig/bench/UI request to run or pause the loop. Always wins over the
   *  warm's temporary suspension. */
  set(on: boolean): void;
  /** Suspend the loop for the warm (does NOT change the intended state).
   *  Returns the effective state before suspension. */
  suspend(): boolean;
  /** End the suspension and re-apply the CURRENT intended state. Returns it. */
  release(): boolean;
  readonly intent: boolean;
  readonly running: boolean;
  readonly suspended: boolean;
}

/**
 * Separates the loop's INTENT (what a rig last asked for) from the warm's
 * temporary suspension. The old code snapshotted the state at warm start and
 * reapplied it in the finally, so a pause requested during the warm was lost.
 * `release()` applies `intent`, which is whatever the most recent external
 * request set — start state only matters if nothing changed meanwhile.
 */
export function createLoopController(apply: (on: boolean) => void, initial: boolean): LoopController {
  let intent = initial;
  let depth = 0;
  const effective = () => (depth > 0 ? false : intent);
  const sync = () => apply(effective());
  return {
    set(on: boolean) { intent = on; sync(); },
    suspend() {
      const before = effective();
      depth++;
      if (depth === 1) sync();
      return before;
    },
    release() {
      if (depth > 0) depth--;
      if (depth === 0) sync();
      return effective();
    },
    get intent() { return intent; },
    get running() { return effective(); },
    get suspended() { return depth > 0; },
  };
}
