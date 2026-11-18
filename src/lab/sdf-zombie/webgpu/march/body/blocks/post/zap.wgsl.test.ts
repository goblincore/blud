// src/lab/sdf-zombie/webgpu/march/body/blocks/post/zap.wgsl.test.ts
import { describe, expect, it } from 'vitest';
import { ZAP_BLOCK, ZAP_LIGHT_BLOCK, ZAP_LOOK, ZAP_LOOK_VARIANTS } from './zap.wgsl';
import { MARCH_BODY_TRACE } from '../../trace.wgsl';
import { MARCH_BODY_LIGHT } from '../../light.wgsl';
import { FOLD_GROUP } from '../../../fields/groups.wgsl';

describe('the zap blocks', () => {
  it('reads the lane from the body\'s own record, never from the view block a crowd type shares', () => {
    expect(ZAP_BLOCK).toContain('let zapRaw = gInstBurn.w;');
    // The crowd material's burnCfg is its source view's (copyUniformValues, every frame): one zapped body would
    // light every body of its type.
    expect(ZAP_BLOCK.replace(/^\s*\/\/.*$/gm, '')).not.toContain('burnCfg');
    expect(ZAP_LIGHT_BLOCK).not.toContain('burnCfg');
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

  // THE LOOK VARIANTS (zap-look.ts, look spike 2026-11-18).
  it('decodes the look\'s code from the lane, and code 0 takes the 2026-11-17 lines', () => {
    expect(ZAP_BLOCK).toContain('let zapCode = floor(abs(zapRaw) * 0.5);');
    expect(ZAP_BLOCK).toContain('let zapAmt = abs(zapRaw) - 2.0 * zapCode;');
    expect(ZAP_BLOCK).toContain('gZap = vec4<f32>(clamp(zapAmt, 0.0, 1.0), select(0.0, 1.0, zapRaw < 0.0), zapBone, 1.0);');
    // The baseline's colour, word for word, under the code-0 branch.
    const base = ZAP_LIGHT_BLOCK.slice(ZAP_LIGHT_BLOCK.indexOf('if (gZapLook.x < 0.5) {'), ZAP_LIGHT_BLOCK.indexOf('} else {'));
    expect(base).toContain(`* (${ZAP_LOOK.gain} + ${ZAP_LOOK.rim} * zapRim);`);
    expect(base).toContain('let zapFlesh = mix(zapGlow, zapDark, gZap.y);');
    expect(base).toContain('lit = mix(lit, mix(zapFlesh, zapBones, gZap.z), gZap.x);');
    expect(base).not.toContain('gZapLook.y');
  });

  it('the crackle and the look code are written only for a variant, inside the zap\'s gate', () => {
    const gate = ZAP_BLOCK.indexOf('if (zapCode > 0.5) {');
    expect(gate).toBeGreaterThan(ZAP_BLOCK.indexOf('if (zapRaw != 0.0) {'));
    expect(ZAP_BLOCK.indexOf('gZapLook = ')).toBeGreaterThan(gate);
    expect(ZAP_BLOCK.indexOf('noise3(')).toBeGreaterThan(gate);
    expect(FOLD_GROUP).toContain('var<private> gZapLook: vec4<f32> = vec4<f32>(0.0);');
  });

  it('caps the variants\' flesh, and mixes it in hard', () => {
    expect(ZAP_LIGHT_BLOCK).toContain(`vec3<f32>(${ZAP_LOOK_VARIANTS.cap})`);
    expect(ZAP_LIGHT_BLOCK).toContain(`min(1.0, gZap.x * ${ZAP_LOOK_VARIANTS.hard}.0)`);
    // No positive-frame centre is over the cap before the rim and the crackle are added.
    for (const gain of [ZAP_LOOK_VARIANTS.bGain, ZAP_LOOK_VARIANTS.cGain + ZAP_LOOK_VARIANTS.cLift]) expect(gain).toBeLessThanOrEqual(ZAP_LOOK_VARIANTS.cap);
  });
});
