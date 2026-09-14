// src/lab/sdf-zombie/webgpu/sim-clock.ts
//
// THE SIM CLOCK (determinism stage 1, 2026-09-14).
//
// Millisecond accumulator advanced ONLY by `advance(dt)`, which `tick(dt)` calls
// first. NEVER wall time — exactly like the bleed clock — and for the same
// reason: hand-stepped captures and replays must be reproducible.
//
// The cull dwell used to read `performance.now()`, which made it a WALL-CLOCK
// decision about which bodies get DRAWN — the most likely source of the workload
// drift the bench census shows across otherwise-identical legs (room 4 fire:
// bodies 4->4 in one run, 4->2 in another). Under live play `dt` is the real
// frame delta, so this tracks elapsed wall time almost exactly and the 250 ms
// grace behaves as it always has; under a fixed-step replay it becomes EXACT
// instead of approximate, which is the entire point.
//
// It lives in its own module (rather than beside the cull state) so that the
// demo recorder/player can reset it for a replay without reaching into the game
// closure. `resetSimClock()` is the ONLY way to rewind it; nothing else may
// write the accumulator.
let ms = 0;

/** Advance by one step's dt (seconds). The single writer. */
export function advance(dtSeconds: number): void {
  ms += dtSeconds * 1000;
}

/** Milliseconds of simulated time since boot (or the last reset). */
export function simTimeMs(): number {
  return ms;
}

/** Rewind to zero. For a recording/replay that must start from a known instant;
 *  inert in normal play. */
export function resetSimClock(): void {
  ms = 0;
}
