// src/lab/sdf-zombie/webgpu/march/body/blocks/post/zap.wgsl.test.ts
import { describe, expect, it } from 'vitest';
import { ZAP_BLOCK, ZAP_LIGHT_BLOCK, ZAP_LOOK } from './zap.wgsl';
import { MARCH_BODY_TRACE } from '../../trace.wgsl';
import { MARCH_BODY_LIGHT } from '../../light.wgsl';
import { FOLD_GROUP } from '../../../fields/groups.wgsl';

describe('the zap blocks', () => {
  it('reads the lane from the view or the record, whichever is larger in size', () => {
    expect(ZAP_BLOCK).toContain('let zapRaw = select(gInstBurn.w, burnCfg.w, abs(burnCfg.w) > abs(gInstBurn.w));');
  });

  it('does nothing on a body the arc is not on', () => {
    expect(ZAP_BLOCK).toContain('if (zapRaw != 0.0) {');
    expect(ZAP_LIGHT_BLOCK).toContain('if (gZap.x > 0.0) {');
    // Every write of gZap and every glow edit sits inside the gate.
    const gate = ZAP_BLOCK.indexOf('if (zapRaw != 0.0) {');
    expect(ZAP_BLOCK.indexOf('gZap = ')).toBeGreaterThan(gate);
    expect(ZAP_BLOCK.indexOf('faceGlow = ')).toBeGreaterThan(gate);
  });

  it('probes the bones only when the body packs bone rows', () => {
    expect(ZAP_BLOCK).toContain('if (gInstCounts2.x > 0.0) {');
    expect(ZAP_BLOCK).toContain('applyBones(1e9, pS, data, gInstCounts, gInstCounts2.x, gBand, segVolumeAtlas, segVolumeMeta)');
  });

  it('is spliced after the burn block and after the lit compose', () => {
    expect(MARCH_BODY_TRACE).toContain(ZAP_BLOCK);
    expect(MARCH_BODY_TRACE.indexOf(ZAP_BLOCK)).toBeGreaterThan(MARCH_BODY_TRACE.indexOf('gBurnOut = vec4<f32>(burnAmt, charAmt, fire, 1.0);'));
    expect(MARCH_BODY_LIGHT).toContain(ZAP_LIGHT_BLOCK);
    expect(MARCH_BODY_LIGHT.indexOf(ZAP_LIGHT_BLOCK)).toBeGreaterThan(MARCH_BODY_LIGHT.indexOf('+ glow + gBurnEmit;'));
    // The old compose line is untouched: an unzapped pixel shades as before.
    expect(MARCH_BODY_LIGHT).toContain('var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow + gBurnEmit;');
  });

  it('declares the private once', () => {
    expect(FOLD_GROUP.split('var<private> gZap: vec4<f32>').length).toBe(2);
  });

  it('carries the look as numbers a panel can change later', () => {
    expect(ZAP_LOOK.core).toHaveLength(3);
    expect(ZAP_LOOK.bone).toHaveLength(3);
    expect(ZAP_LOOK.probeDepthM).toBeGreaterThan(0);
  });
});
