// src/lab/sdf-zombie/webgpu/march/body/blocks/light/display-debug.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `display-debug`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { HELPERS, MARCH_BODY, MAP_BODY, SAMPLE_VOLUME } from '../../../../march.wgsl';
import { declaredName } from '../../../../march-test-support';

describe('perf instrumentation heatmaps (raymarcher-perf task 2)', () => {
  // steps/pixel and prims/pixel counters behind a uniform-guarded debug
  // branch. The gate the plan names: debugCfg.x == 0 must cost nothing —
  // every counter write is guarded, and the guards are pinned here so a
  // future edit cannot unguard one silently.
  it('declares the private counters before mapBody, at SAMPLE_VOLUME tail', () => {
    // WGSL requires declaration before use; SAMPLE_VOLUME is the helper
    // immediately before MAP_BODY, and the private vars ride its tail
    // because a var-declaration source would break three's ^-anchored
    // "fn" parse contract as its own HELPERS entry.
    expect(HELPERS.indexOf(SAMPLE_VOLUME)).toBeLessThan(HELPERS.indexOf(MAP_BODY));
    expect(SAMPLE_VOLUME).toContain('var<private> gDebugMode: f32 = 0.0;');
    expect(SAMPLE_VOLUME).toContain('var<private> gDebugPrims: f32 = 0.0;');
    expect(SAMPLE_VOLUME).toContain('var<private> gDebugSteps: f32 = 0.0;');
  });

  it('guards every counter write — debugCfg.x == 0 pays a branch only', () => {
    // mapBody's fold: guarded on the private mode flag (mapBody takes no
    // debugCfg parameter by design — threading one would fork its signature).
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }');
    // The march entry: init + per-step count guarded on the uniform itself.
    expect(MARCH_BODY).toContain(
      'if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0; gDebugSteps = 0.0; gDebugWoundRows = 0.0; gDebugRefolds = 0.0; gDebugRefoldWins = 0.0; gDebugBones = 0.0; gDebugVolumeSamples = 0.0; gDebugVolumeFallbacks = 0.0; }');
    // The cost census's wound-row counter is guarded the same way (applyWounds).
    expect(HELPERS.find(h => declaredName(h) === 'applyWounds')!).toContain('if (gDebugMode > 0.5) { gDebugWoundRows = gDebugWoundRows + 1.0; }');
    expect(MARCH_BODY).toContain(
      'if (debugCfg.x > 0.5) { gDebugSteps = gDebugSteps + 1.0; }');
    // No UNGUARDED write anywhere: strip the guarded forms, and no
    // assignment to a counter may remain.
    const guarded = /(if \(gDebugMode > 0\.5\)|if \(debugCfg\.x > 0\.5\)) \{[^}]*gDebug(Prims|Steps|Mode)[^}]*\}/g;
    const foldScan = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    const stripped = MARCH_BODY.replace(guarded, '')
      + MAP_BODY.replace(guarded, '')
      + foldScan.replace(guarded, '');
    expect(stripped).not.toMatch(/gDebug(Prims|Steps|Mode)\s*=/);
  });

  it('snapshots the counters before the post-hit probes fold more prims', () => {
    // calcNormal adds four mapBody calls after the loop and the wound
    // shadow up to fourteen more; the heatmap is about RAY cost, so the
    // read must precede calcNormal.
    const capture = MARCH_BODY.indexOf('let debugPrims = gDebugPrims;');
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(MARCH_BODY.indexOf('if (!hit) { discard; }'));
    expect(capture).toBeLessThan(MARCH_BODY.indexOf('calcNormal('));
  });

  it('emits the ramp only inside the debug branch, after the gamma block', () => {
    // MODE 3 (occT heat, hull-holes diagnosis 2026-08-27) shares the branch
    // and returns before heatNorm; the pin still proves heatNorm lives in
    // that same branch, after the gamma block.
    const branch = MARCH_BODY.indexOf('if (debugCfg.x > 0.5) {\n    // MODE 3');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(MARCH_BODY.indexOf('lodCfg.y > 0.5'));
    expect(MARCH_BODY.indexOf('let heatNorm', branch)).toBeGreaterThan(branch);
    // steps ramp: 0..marchCfg.x. prims ramp: 0..2000.
    expect(MARCH_BODY).toContain('select(debugSteps / max(marchCfg.x, 1.0), debugPrims / 2000.0, debugCfg.x > 1.5)');
  });
});
