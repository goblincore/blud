// src/lab/sdf-zombie/webgpu/warm-gate.ts
//
// THE WARM-UP'S LIFECYCLE CONTRACT, as pure decisions (startup-freeze task,
// 2026-09-16). These two rules used to live inline in game-main.ts where the
// only way to exercise them was a real GPU boot:
//
//   1. THE LOADER MUST NOT CLAIM READY WHILE THE WARM IS STILL RUNNING. The
//      old code raced warmPipelines() against a 15 s timer and resolved the
//      loader gate on WHICHEVER won. When the timer won, the loader said
//      "READY — CLICK TO START" and auto-hid while warmPipelines was still
//      compiling with the render loop paused — the owner's "it loaded, then
//      froze" window. A timeout now only changes the loader's WORDING; the
//      game is not reported ready until the work actually settles.
//
//   2. A FINISHED WARM-UP MUST RESTORE THE LOOP STATE IT FOUND. warmPipelines
//      pauses the loop for its real-frame compile. Its `finally` used to call
//      setLoopRunning(true) unconditionally, so a capture rig or bench that
//      had deliberately paused the loop had it silently restarted by a late
//      warm completion. Restore, never force.
//
// The live integration is verified by scripts/startup-freeze-probe.mjs, which
// re-runs the warm through the `__sdfGame.rewarm()` seam with the loop paused
// and asserts loopRunning() stays false.

/** What the loader gate resolves to once the warm has settled or timed out. */
export type WarmGateOutcome = 'ready' | 'still-compiling';

/**
 * Decide the loader gate. `timedOut` is true only when the 15 s bound fired
 * BEFORE warmPipelines settled. On a timeout the loader must stay up and
 * report that work is still happening; the caller settles it later, when the
 * warm promise actually resolves.
 */
export function warmGateOutcome(timedOut: boolean): WarmGateOutcome {
  return timedOut ? 'still-compiling' : 'ready';
}

/**
 * The loop state a finished warm-up must restore. `wasRunning` is the state
 * observed immediately before the warm paused the loop.
 */
export function restoreLoopState(wasRunning: boolean): boolean {
  return wasRunning;
}
