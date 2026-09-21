// src/lab/sdf-zombie/webgpu/game-state-telemetry.ts
//
// TELEMETRY slice of the GameContext decomposition — the frame-timing recorder
// and the DEV-only recording controls, plus the two diagnostic switches they
// read (the hybrid-normal mode/debug pair) and the volume-atlas build counter.
//
// Shape mirrors game-state-boot.ts / game-state-bake.ts (and game-weapon-slots.ts
// before them): interface + factory + a binding map the codemod consumes. The
// fields are PLAIN MUTABLE values — no getters, setters, `readonly` or freezing —
// because the codemod rewrites `let x = y` into `ctx.telemetry.x = y` in place,
// and any accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (`new GameTelemetry()`, `createTelemetryControls(...)`)
// get a type-correct placeholder here; the in-place assignment at the binding's
// original line supplies the real value before any code reads it.
//
// Pure by construction: the only non-local imports are erased `import type`s, so
// this module carries no runtime Three.js/WebGPU dependency.

import type { GameTelemetry } from './game-telemetry';
import type { createTelemetryControls } from './game-telemetry-controls';
import type { createGpuFrameAttributor } from './gpu-frame-summary';

/** Type of the DEV recording overlay `createTelemetryControls()` returns. */
type TelemetryControls = ReturnType<typeof createTelemetryControls>;

/**
 * Placeholder for a binding whose real value is built at that binding's
 * original line. The field is non-null in game-main.ts, so the placeholder
 * value must satisfy the declared type even though no code reads it before the
 * original assignment runs.
 */
function unbuilt<T>(): T {
  return null as unknown as T;
}

// ASSIGNED-ONCE HANDLES. The fields below are `const` in game-main.ts: created
// once at their declaration and never reassigned. The original code therefore
// typed them non-nullable, and code all over main() relies on that. Typing them
// `T | null` here would push ~190 spurious `possibly null` errors into
// game-main.ts for a value that is never actually null once boot has run.
// So they are typed `T`, and the factory seeds them with a definite-assignment
// placeholder that the in-place assignment at the original line overwrites.
export interface TelemetryState {
  /** The frame-timing / gameplay-capture recorder. */
  telemetry: GameTelemetry;
  /** Count of shared volume atlases built (diagnostic, monotonic). */
  volumeAtlasBuilds: number;
  /** Owner-approved hybrid-normal mode (`0` = calcNormal, `1` = hybrid). */
  normalGradientMode: 0 | 1;
  /** Hybrid-normal diagnostic overlay: 0 off, 1 gradient, 2 debug. */
  normalGradientDebug: 0 | 1 | 2;
  /** The first telemetry frame after start/mark is discarded as a warm-up. */
  firstFrame: boolean;
  /** gpu-pass-timing frame id of the frame in flight while recording (the key
   *  late GPU summaries are attached by); undefined when not recording. */
  gpuFrame: number | undefined;
  /** Set by `visibilitychange` so a recording can flag a hidden-tab gap. */
  visibilityGap: boolean;
  /** GPU COLLECTOR in-flight flag: one passTiming.collect() at a time; a
   *  frame that ends while one is pending rides the next resolve. (Moved off
   *  main() scope — game-context-coverage — by the visual-actor-cull task 2
   *  gate; the telemetry-v4 commit left them as main() bindings.) */
  gpuCollecting: boolean;
  /** Per-frame GPU attributor the collector feeds; re-created when a
   *  recording starts so every recording attributes its own frames. */
  gpuAttributor: ReturnType<typeof createGpuFrameAttributor>;
  /** DEV-only recording overlay, or null outside a DEV build. */
  controls: TelemetryControls | null;
}

/** Every call returns a fresh object; no nested value is shared between calls. */
export function makeTelemetryState(): TelemetryState {
  return {
    telemetry: unbuilt<GameTelemetry>(),
    volumeAtlasBuilds: 0,
    normalGradientMode: 1,
    normalGradientDebug: 0,
    firstFrame: true,
    gpuFrame: undefined,
    visibilityGap: false,
    gpuCollecting: false,
    gpuAttributor: unbuilt<ReturnType<typeof createGpuFrameAttributor>>(),
    controls: null,
  };
}

/** Old `game-main.ts` binding name → path on the `telemetry` slice. */
export const TELEMETRY_BINDINGS = {
  telemetry: 'telemetry.telemetry',
  volumeAtlasBuilds: 'telemetry.volumeAtlasBuilds',
  normalGradientMode: 'telemetry.normalGradientMode',
  normalGradientDebug: 'telemetry.normalGradientDebug',
  firstTelemetryFrame: 'telemetry.firstFrame',
  telemetryVisibilityGap: 'telemetry.visibilityGap',
  telemetryControls: 'telemetry.controls',
} as const;
