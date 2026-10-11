// src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.test.ts
//
// The screen pass's WGSL strings (screen-emergence.wgsl.ts) against wgslFn's one-fn rule and the field module they twin: the constants come
// from emergence-field.ts's tables, and the proxy box holds everything the field can reach over the whole timeline. Whether the WGSL
// compiles is the page's console's job (node cannot compile it).
import { describe, expect, it } from 'vitest';
import { paramsAt, DURATION } from './emergence-timeline';
import { EGG, GLASS, PICTURE_TABLE_N, SAC_BLEND, SAC_MAX, SKIN, THICK0, RIPPLE, eggCentre, lipOpening, sacExtent } from './emergence-field';
import * as W from './screen-emergence.wgsl';

const STRINGS = Object.entries(W).filter(([k, v]) => k.startsWith('SCR_') && typeof v === 'string') as [string, string][];

describe('screen-emergence.wgsl', () => {
  it('each string declares exactly one fn, first', () => {
    expect(STRINGS.length).toBeGreaterThanOrEqual(16);
    for (const [k, s] of STRINGS) {
      expect(s.trim().startsWith('fn '), k).toBe(true);
      expect(s.match(/^fn /gm), k).toHaveLength(1);
    }
  });

  it('is built from the field module\'s tables, not retyped numbers', () => {
    expect(W.SCR_SAC).toContain(`${EGG.rx}`);
    expect(W.SCR_SAC).toContain(`${EGG.ry}`);
    expect(W.SCR_SAC).toContain(`${SKIN}`);
    expect(W.SCR_SAC).toContain(`${RIPPLE.amp}`);
    expect(W.SCR_MAP).toContain(`${SAC_MAX}`);
    expect(W.SCR_MAP).toContain(`${THICK0}`);
    // the sac solid's blends (sacBlend's twin): the cap in front of the equator, rest to tent behind it over run
    for (const k of [SAC_BLEND.cap, SAC_BLEND.rest, SAC_BLEND.tent, SAC_BLEND.run]) expect(W.SCR_MAP).toContain(`${k}`);
    expect(W.SCR_MAP).not.toContain('scrSwept');
    expect(W.SCR_OPENING).toContain(`${GLASS.hw}`);
    expect(W.SCR_PICTURE).toContain(`min(i32(floor(fi)), ${PICTURE_TABLE_N - 2})`);
    expect(W.SCR_MARCH).toContain(`i < ${W.MAX_STEPS}`);
    expect(W.MAX_STEPS).toBe(64);
  });

  it('the proxy box holds the egg, the sac\'s apex and the bowed lip at every time', () => {
    const [x0, y0, z0] = W.SCREEN_PROXY.min, [x1, y1, z1] = W.SCREEN_PROXY.max;
    for (let t = 0; t <= DURATION; t += 0.05) {
      const p = paramsAt(t), c = eggCentre(p), lo = lipOpening(p);
      expect(c[1] - EGG.ry, `t=${t}`).toBeGreaterThan(y0);
      expect(c[1] + EGG.ry, `t=${t}`).toBeLessThan(y1);
      expect(c[2] + EGG.rz + SKIN + THICK0, `t=${t}`).toBeLessThan(z1);
      expect(sacExtent(p) + THICK0, `t=${t}`).toBeLessThan(z1);
      expect(lo.hw + W.OPEN_PAD + 2 * W.LIP_R, `t=${t}`).toBeLessThan(x1);
      expect(-(lo.hw + W.OPEN_PAD + 2 * W.LIP_R), `t=${t}`).toBeGreaterThan(x0);
      expect(lo.hh + W.OPEN_PAD + 2 * W.LIP_R, `t=${t}`).toBeLessThan(y1);
    }
    expect(W.SHEET_FLOOR).toBeGreaterThan(z0);
    expect(EGG.rx).toBeLessThan(x1);
  });

  it('packs the hit distance and the coverage in one float, and the shade writes it', () => {
    // floor(t * DEPTH_Q) + alpha must keep the alpha's fraction at the box's far reach from a camera a few metres off (f32: 24 bits).
    const far = 8;
    expect(Math.log2(far * W.DEPTH_Q)).toBeLessThan(24 - 9);   // at least 9 bits (1/512) left for the coverage
    expect(W.SCR_SHADE).toContain(`floor(h1.x * ${W.DEPTH_Q.toFixed(1)}) + clamp(alpha, 0.001, 0.999)`);
  });
});
