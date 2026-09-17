// src/lab/sdf-zombie/webgpu/game-state-demo.ts
//
// DEMO slice of the sdf-game GameContext. It lifts the demo-seed, recording
// and replay bindings that used to be `let`s inside main() in game-main.ts
// into one addressable object. Values only: the frame loop, the recorder and
// the F7 HUD read and write these fields directly.
//
// Plain mutable fields only. Field access must keep exactly the timing it had
// as a local binding inside main(), so there are deliberately no getters,
// setters, `readonly` or frozen objects here — a proxy or an accessor would
// change evaluation order and shift pixels.

import type { DemoRecorder } from './demo-recorder';

/** Mutable state owned by the demo slice. */
export interface DemoState {
  /** ONE seed drives every named RNG stream (`rng.ts`). From `?seed=`, else a
   *  random value. Supplied at the original declaration; the factory
   *  placeholder is overwritten before the first use. */
  seed: number;
  /** Simulation frame index, incremented once at the top of every `tick(dt)`.
   *  The bake swap is pinned to a frame relative to this, so its landing frame
   *  does not depend on worker speed. Read-only apart from `tick`. */
  simFrame: number;
  /** While ON, render-side subsampling that is otherwise wall-clock or
   *  frame-counter driven is pinned to the demo clock, so two runs of one
   *  recording hash identically. Pixel-only: it never feeds sim state. */
  hold: boolean;
  /** The gather dispatch counter at demo entry, so the frame seed is a function
   *  of frames-since-entry rather than of how long the page happened to boot. */
  seedBase: number;
  /** TRUE while a recording is replayed: the listeners still fire but inject
   *  nothing — the player owns the frame. */
  replayActive: boolean;
  /** Frames consumed by the current replay (`demoInfo().frame`). */
  replayFrame: number;
  /** The active recorder, or null. Pushed once per tick while recording. */
  recorder: DemoRecorder | null;
  /** `?frozen=1` — boot with the wanderers frozen from frame 0, so a capture
   *  predates the first stepped frame. Default off. */
  wanderFrozen: boolean;
  /** `?simidle=1` diagnostic render lock: `tick(dt)` returns before any
   *  simulation mutation, so readback seams see a bit-frozen frame. Default
   *  off; only the gate sets it. */
  simLocked: boolean;
  /** Frames rendered/ticked since the loop started. */
  frameCount: number;
  /** The F7 HUD line, created lazily and parked above the telemetry controls. */
  hudEl: HTMLDivElement | null;
}

export function makeDemoState(): DemoState {
  return {
    seed: 0,
    simFrame: 0,
    hold: false,
    seedBase: 0,
    replayActive: false,
    replayFrame: 0,
    recorder: null,
    wanderFrozen: false,
    simLocked: false,
    frameCount: 0,
    hudEl: null,
  };
}

/** Old `main()` binding name → path on the GameContext's demo slice. The codemod
 *  that rewrites game-main.ts routes every binding through this map. */
export const DEMO_BINDINGS = {
  demoSeed: 'demo.seed',
  simFrame: 'demo.simFrame',
  demoHold: 'demo.hold',
  demoSeedBase: 'demo.seedBase',
  replayActive: 'demo.replayActive',
  replayFrame: 'demo.replayFrame',
  recorder: 'demo.recorder',
  wanderFrozen: 'demo.wanderFrozen',
  simLocked: 'demo.simLocked',
  frameCount: 'demo.frameCount',
  demoHudEl: 'demo.hudEl',
} as const;
