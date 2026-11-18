// src/lab/sdf-zombie/webgpu/skeleton-spike/zap-xray.test.ts
import { describe, expect, it } from 'vitest';
import { xrayColour, xrayPull, ZAP_XRAY, ZAP_XRAY_PULL_WGSL, ZAP_XRAY_COLOUR_WGSL } from './zap-xray';
import { ZAP_LOOK } from '../march/body/blocks/post/zap.wgsl';

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]!);
const len = (a: number[]) => Math.hypot(...a);

describe('the skeleton x-ray', () => {
  it('pulls a point toward the eye by pullM along its own ray', () => {
    const eye = [1, 1.6, 0], p = [1, 1.2, -5];
    const q = xrayPull(p, eye, 1);
    const d0 = sub(p, eye), d1 = sub(q, eye);
    expect(len(d0) - len(d1)).toBeCloseTo(ZAP_XRAY.pullM, 6);
    // Same ray: the direction is unchanged, so the point does not move on screen.
    expect(d1[0]! / len(d1)).toBeCloseTo(d0[0]! / len(d0), 9);
    expect(d1[1]! / len(d1)).toBeCloseTo(d0[1]! / len(d0), 9);
    expect(d1[2]! / len(d1)).toBeCloseTo(d0[2]! / len(d0), 9);
  });

  it('leaves a point alone at zap 0', () => {
    expect(xrayPull([1, 1.2, -5], [1, 1.6, 0], 0)).toEqual([1, 1.2, -5]);
  });

  it('never pulls a near point through the eye', () => {
    const eye = [0, 0, 0], p = [0, 0, -0.3];
    const q = xrayPull(p, eye, 1);
    expect(q[2]!).toBeLessThan(0);
    expect(len(q)).toBeCloseTo(0.3 * ZAP_XRAY.minKeep, 6);
  });

  it('keeps two points on one ray in their order, so a pulled skeleton sorts as it did', () => {
    const eye = [0, 1.6, 0];
    const near = xrayPull([0, 1.6, -2.0], eye, 1), far = xrayPull([0, 1.6, -2.3], eye, 1);
    expect(len(sub(near, eye))).toBeLessThan(len(sub(far, eye)));
  });

  it('shades the bone dark in the glow, bright on a jolt, and not at all at zap 0', () => {
    const lit = [0.4, 0.35, 0.3];
    expect(xrayColour(lit, 0)).toEqual(lit);
    expect(xrayColour(lit, 1)).toEqual([...ZAP_LOOK.bone]);
    const jolt = xrayColour(lit, -1);
    expect(jolt[2]!).toBeGreaterThan(1);
  });

  it('goes flat early: the mix saturates at a glow of 1 / saturate, and fades below it', () => {
    const lit = [0.4, 0.35, 0.3];
    expect(ZAP_XRAY.saturate).toBe(4);
    // The glow flickers between about 0.56 and 0.97 while the arc is on: the bone is the flat colour through all of it.
    expect(xrayColour(lit, 0.56)).toEqual([...ZAP_LOOK.bone]);
    expect(xrayColour(lit, 0.25)).toEqual([...ZAP_LOOK.bone]);
    expect(xrayColour(lit, -0.56)).toEqual(xrayColour(lit, -1));
    // Half way at 0.125: the attack and the recovery still fade.
    const half = xrayColour(lit, 0.125);
    expect(half[0]!).toBeCloseTo((lit[0]! + ZAP_LOOK.bone[0]) / 2, 6);
  });

  it('says the same thing in WGSL', () => {
    expect(ZAP_XRAY_PULL_WGSL).toContain('fn zapXrayPull(p: vec3<f32>, eye: vec3<f32>, zap: f32) -> vec3<f32>');
    expect(ZAP_XRAY_PULL_WGSL).toContain(`${ZAP_XRAY.pullM}`);
    expect(ZAP_XRAY_PULL_WGSL).toContain(`${ZAP_XRAY.minKeep}`);
    expect(ZAP_XRAY_COLOUR_WGSL).toContain('fn zapXrayColour(lit: vec3<f32>, zap: f32) -> vec3<f32>');
    expect(ZAP_XRAY_COLOUR_WGSL).toContain('let k = min(1.0, abs(zap) * 4.0);');
  });
});
