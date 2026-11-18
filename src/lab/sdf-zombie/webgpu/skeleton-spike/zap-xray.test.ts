// src/lab/sdf-zombie/webgpu/skeleton-spike/zap-xray.test.ts
import { describe, expect, it } from 'vitest';
import { xrayColour, xrayColourLook, xrayDeflate, xrayPull, ZAP_XRAY, ZAP_XRAY_LOOK, ZAP_XRAY_PULL_WGSL, ZAP_XRAY_COLOUR_WGSL } from './zap-xray';
import { encodeZapLane } from '../../zap-look';
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
    expect(ZAP_XRAY_PULL_WGSL).toContain('fn zapXrayPull(p: vec3<f32>, eye: vec3<f32>, zap: f32, n: vec3<f32>, thin: f32) -> vec3<f32>');
    expect(ZAP_XRAY_PULL_WGSL).toContain(`${ZAP_XRAY.pullM}`);
    expect(ZAP_XRAY_PULL_WGSL).toContain(`${ZAP_XRAY.minKeep}`);
    expect(ZAP_XRAY_COLOUR_WGSL).toContain('fn zapXrayColour(lit: vec3<f32>, zap: f32, facing: f32, kind: f32) -> vec3<f32>');
    expect(ZAP_XRAY_COLOUR_WGSL).toContain('let k = min(1.0, amt * 4.0);');
    // The baseline look (code 0) leaves by the 2026-11-17 line, before any of the variants' terms.
    expect(ZAP_XRAY_COLOUR_WGSL).toContain('if (code < 0.5) { return mix(lit, select(dark, bright, neg), k); }');
    expect(ZAP_XRAY_COLOUR_WGSL.indexOf('if (code < 0.5)')).toBeLessThan(ZAP_XRAY_COLOUR_WGSL.indexOf('let tone'));
  });
});

describe('the x-ray bones of the look variants (zap-look.ts)', () => {
  const lit = [0.5, 0.4, 0.3];
  const lane = (glow: number, invert: boolean, code: number) => encodeZapLane(glow, invert, code);
  const lum = (c: number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;

  it('code 0 is the baseline colour whatever the facing or the kind', () => {
    for (const z of [0.1, 0.7, -0.7]) for (const facing of [0, 0.5, 1]) for (const eye of [false, true]) {
      expect(xrayColourLook(lit, z, facing, eye)).toEqual(xrayColour(lit, z));
    }
  });

  it('b and c keep the bone\'s form: its edge and its facing middle differ in both strobe states', () => {
    for (const code of [1, 2]) for (const inv of [false, true]) {
      const mid = lum(xrayColourLook(lit, lane(0.8, inv, code), 1, false)), edge = lum(xrayColourLook(lit, lane(0.8, inv, code), 0.1, false));
      expect(Math.abs(mid - edge)).toBeGreaterThan(0.05);
      // The baseline is flat: the same colour at any facing.
      expect(xrayColour(lit, inv ? -0.8 : 0.8)).toEqual(xrayColourLook(lit, inv ? -0.8 : 0.8, 0.1, false));
    }
  });

  it('b and c keep the bone\'s paint: a dark socket stays darker than lit bone', () => {
    for (const code of [1, 2]) for (const inv of [false, true]) {
      const bone = lum(xrayColourLook([0.6, 0.55, 0.45], lane(0.8, inv, code), 1, false));
      const socket = lum(xrayColourLook([0.02, 0.02, 0.02], lane(0.8, inv, code), 1, false));
      expect(bone).toBeGreaterThan(socket * 1.3);
    }
  });

  it('an eye is the opposite of the skull round it', () => {
    for (const code of [1, 2]) {
      const skullPos = lum(xrayColourLook(lit, lane(0.8, false, code), 0.2, false)), eyePos = lum(xrayColourLook(lit, lane(0.8, false, code), 1, true));
      const skullNeg = lum(xrayColourLook(lit, lane(0.8, true, code), 1, false)), eyeNeg = lum(xrayColourLook(lit, lane(0.8, true, code), 1, true));
      expect(eyePos).toBeGreaterThan(skullPos + 0.5);
      expect(eyeNeg).toBeLessThan(skullNeg - 0.5);
    }
  });

  it('only look b thins the bones', () => {
    expect(xrayDeflate(0.8)).toBe(0);
    expect(xrayDeflate(lane(0.8, false, 1))).toBe(ZAP_XRAY_LOOK.deflateM);
    expect(xrayDeflate(lane(0.8, true, 1))).toBe(ZAP_XRAY_LOOK.deflateM);
    expect(xrayDeflate(lane(0.8, false, 2))).toBe(0);
    expect(ZAP_XRAY_PULL_WGSL).toContain(`${ZAP_XRAY_LOOK.deflateM}`);
  });
});
