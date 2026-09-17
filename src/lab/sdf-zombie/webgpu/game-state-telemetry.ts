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
  /** Set by `visibilitychange` so a recording can flag a hidden-tab gap. */
  visibilityGap: boolean;
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
    visibilityGap: false,
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
