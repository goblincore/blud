// src/lab/sdf-zombie/webgpu/game-state-telemetry.test.ts
//
// The telemetry slice is a bag of mutable fields, so there is little logic to
// test. What matters is the contract the codemod leans on: the factory hands
// out private objects, the literal defaults are what game-main.ts declares, and
// every old binding name resolves to a field that actually exists on the state.

import { describe, expect, it } from 'vitest';
import { TELEMETRY_BINDINGS, makeTelemetryState } from './game-state-telemetry';

describe('makeTelemetryState', () => {
  it('gives each call its own object', () => {
    expect(makeTelemetryState()).not.toBe(makeTelemetryState());
  });

  it('starts at the declared defaults', () => {
    const s = makeTelemetryState();
    // Literal initializers in game-main.ts: volumeAtlasBuilds = 0,
    // normalGradientMode = 1, normalGradientDebug = 0,
    // firstTelemetryFrame = true, telemetryVisibilityGap = false.
    expect(s.volumeAtlasBuilds).toBe(0);
    expect(s.normalGradientMode).toBe(1);
    expect(s.normalGradientDebug).toBe(0);
    expect(s.firstFrame).toBe(true);
    expect(s.visibilityGap).toBe(false);
  });
});

describe('TELEMETRY_BINDINGS', () => {
  it('maps every old name onto a field that exists on the state', () => {
    const s = makeTelemetryState() as unknown as Record<string, unknown>;
    for (const [oldName, path] of Object.entries(TELEMETRY_BINDINGS)) {
      expect(path.startsWith('telemetry.'), `${oldName} must map into the telemetry slice`).toBe(true);
      expect(s).toHaveProperty(path.slice('telemetry.'.length));
    }
  });

  it('covers every binding assigned to this slice', () => {
    expect(Object.keys(TELEMETRY_BINDINGS)).toHaveLength(7);
  });
});
