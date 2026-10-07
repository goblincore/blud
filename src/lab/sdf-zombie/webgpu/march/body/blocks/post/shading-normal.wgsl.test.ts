// src/lab/sdf-zombie/webgpu/march/body/blocks/post/shading-normal.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `shading-normal`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { MARCH_BODY, CONE_MARCH, MAP_BODY, WOUND_SHADOW, MARCH_TRACE_POST, DEPTH_PREPASS_MARCH } from '../../../../march.wgsl';

describe('final-hit analytic normal integration', () => {
  it('binds an independent default-off uniform and propagates actor/chunk requests', async () => {
    const gpu = (await import('../../../../zombie-gpu?raw')).default;
    // spawnEnemy, which stamps the uniform on a new view, lives in game-spawn.ts (2026-10-07).
    // The uniform defaults to 0 and the game's mode defaults to 1, so that stamp is what turns
    // the analytic normal on for every new body.
    const game = (await import('../../../../game-spawn?raw')).default;
    expect(gpu).toContain('normalGradientCfg: uniform(new THREE.Vector4(0, 0, 0, 0))');
    expect(gpu).toContain('normalGradientCfg: u.normalGradientCfg');
    expect(gpu).toContain('u.normalGradientCfg.value.copy(template.normalGradientCfg.value)');
    // Receivers moved onto the GameContext in the 2026-09-17 game-main
    // decomposition (`normalGradientMode` -> `ctx.telemetry.normalGradientMode`).
    // Spelling only — the uniform, the call and the argument order are unchanged.
    expect(game).toContain('view.uniforms.normalGradientCfg.value.set(ctx.telemetry.normalGradientMode, ctx.telemetry.normalGradientDebug, 0, 0)');
  });
  it('runs the new fold only after the hit, preserving the complete legacy fallback and later detail', () => {
    expect(MARCH_BODY.indexOf('ngBody(')).toBeGreaterThan(MARCH_BODY.indexOf('let anchor = restPoint'));
    expect(MARCH_BODY).toContain('if (!ngValid)');
    expect(MARCH_BODY).toContain('normalGradientCfg.x > 0.5');
    // Crowd fix (2026-09-14): the analytic path is ungated for every slot. The
    // temporary single-slot mitigation (`instCfg.x < 1.5`) must not come back.
    // (The one gate beside the mode is the head split's: no analytic gradient inside an OPEN head's region sphere,
    // split-hit.wgsl.test.ts.)
    expect(MARCH_TRACE_POST).toContain('if (normalGradientCfg.x > 0.5 && !splitIn) {');
    expect(MARCH_TRACE_POST).not.toContain('instCfg.x < 1.5');
    expect((MARCH_BODY.match(/let detailAmp = surfCfg2.y/g) ?? []).length).toBe(1);
    for (const src of [MAP_BODY, CONE_MARCH, DEPTH_PREPASS_MARCH, WOUND_SHADOW]) expect(src).not.toContain('ngBody(');
  });
});
