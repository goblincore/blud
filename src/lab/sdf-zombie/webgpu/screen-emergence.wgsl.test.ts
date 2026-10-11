// src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.test.ts
//
// The screen pass's WGSL strings (screen-emergence.wgsl.ts) against wgslFn's one-fn rule and the field module they twin: the constants come
// from emergence-field.ts's tables, and the proxy box holds everything the field can reach over the whole timeline. Whether the WGSL
// compiles is the page's console's job (node cannot compile it).
import { describe, expect, it } from 'vitest';
import { paramsAt, DURATION } from './emergence-timeline';
import { EGG, GLASS, PICTURE_TABLE_N, SAC_BLEND, SAC_MAX, SKIN, TEAR_RAG, TEAR_R_MAX, THICK0, RIPPLE, eggCentre, lipOpening, sacExtent, smooth, tearRadius } from './emergence-field';
import { GOO_BOUND0, GOO_TEXELS, N_BEADS, N_DRIPS, N_STRANDS, STRAND_POINTS, gooAt } from './goo-strands';
import * as W from './screen-emergence.wgsl';

const STRINGS = Object.entries(W).filter(([k, v]) => k.startsWith('SCR_') && typeof v === 'string') as [string, string][];

describe('screen-emergence.wgsl', () => {
  it('each string declares exactly one fn, first', () => {
    expect(STRINGS.length).toBeGreaterThanOrEqual(20);
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

  it('the tear\'s radius is tearRadius\'s twin: the same harmonics, the same value at every angle', () => {
    for (const [a, k, ph] of TEAR_RAG) expect(W.SCR_TEAR).toContain(`${a} * sin(${k.toFixed(1)} * th + ${ph})`);
    expect(W.SCR_TEAR).toContain(`${TEAR_R_MAX}`);
    // evaluate the shader's radius lines (the knit's ellipse, the rag, the radius) in JS and hold them against the field's tearRadius
    const body = W.SCR_TEAR.slice(W.SCR_TEAR.indexOf('let b = '), W.SCR_TEAR.indexOf('let dtr'))
      .split('\n').filter(l => !/let dell/.test(l)).join('\n')
      .replace(/\blet /g, 'const ').replace(/\b(sin|cos|sqrt)\(/g, 'Math.$1(').replace(/smoothstep\(0\.0, 1\.0, /g, 'sm(');
    const trJs = new Function('s', 'th', 'heal', 'sm', `${body}\nreturn tr;`) as (s: number, th: number, heal: number, sm: (u: number) => number) => number;
    for (const heal of [0, 0.2, 0.5, 1]) for (const tear of [0.1, 0.5, 1]) for (let th = -Math.PI; th <= Math.PI; th += 0.1) {
      const p = { ...paramsAt(0), tear, heal };
      expect(trJs(smooth(tear), th, heal, smooth), `heal=${heal} tear=${tear} th=${th.toFixed(1)}`).toBeCloseTo(tearRadius(p, th), 6);
    }
  });

  it('the goo reads gooTexels\' layout: the strands, the beads, the drips, then the bounds', () => {
    expect(W.SCR_GOO).toContain(`s < ${N_STRANDS}`);
    expect(W.SCR_GOO).toContain(`s * ${STRAND_POINTS}`);
    expect(W.SCR_GOO).toContain(`i < ${N_BEADS}`);
    expect(W.SCR_GOO).toContain(`i < ${N_DRIPS}`);
    expect(W.GOO_BEAD0).toBe(N_STRANDS * STRAND_POINTS);
    expect(W.GOO_DRIP0).toBe(W.GOO_BEAD0 + N_BEADS);
    expect(W.SCR_GOO).toContain(`${GOO_BOUND0} + s`);
    expect(W.SCR_GOO).toContain(`${GOO_BOUND0 + N_STRANDS + 1}`);
    expect(GOO_BOUND0 + N_STRANDS + 2).toBeLessThanOrEqual(GOO_TEXELS);
    expect(W.GOO_K.scene).toBeGreaterThanOrEqual(0.03);
    expect(W.GOO_K.scene).toBeLessThanOrEqual(0.05);
  });

  it('the tear\'s rim and the goo have their materials and shading (4 goo, 5 rim; scrShade sends them to scrSurface)', () => {
    expect(W.SCR_MAP).toContain('select(1.0, 5.0, band > 0.001)');
    expect(W.SCR_MAP).toContain('4.0, g < best.x');
    expect(W.SCR_MAP).toContain(`${W.GOO_K.scene} * clamp(gw.y / ${W.GOO_K.fullW}`);
    expect(W.SCR_SURFACE).toContain('mat > 4.5');
    expect(W.SCR_SURFACE).toContain('mat > 3.5');
    expect(W.SCR_SURFACE).toContain('vec3<f32>(0.82, 0.74, 0.7)');
    expect(W.SCR_SHADE).toContain('h1.y < 1.5');
    expect(W.SCR_MAP).toContain(`(1.0 + ${W.TEAR_RIM.thicken} * band)`);
  });

  it('the goo stays inside the proxy box', () => {
    const [x0, y0, z0] = W.SCREEN_PROXY.min, [x1, y1, z1] = W.SCREEN_PROXY.max;
    for (let t = 7; t <= DURATION; t += 0.5) {
      const g = gooAt(t);
      const pts = [...g.strands.filter(s => s.live).flatMap(s => s.points), ...g.beads.filter(b => b.radius > 0).map(b => b.pos), ...g.drips.filter(d => d.length > 0).flatMap(d => [d.top, d.tip])];
      for (const p of pts) {
        expect(p[0], `t=${t}`).toBeGreaterThan(x0); expect(p[0], `t=${t}`).toBeLessThan(x1);
        expect(p[1], `t=${t}`).toBeGreaterThan(y0); expect(p[1], `t=${t}`).toBeLessThan(y1);
        expect(p[2], `t=${t}`).toBeGreaterThan(z0); expect(p[2], `t=${t}`).toBeLessThan(z1);
      }
    }
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
    expect(W.SCR_SHADE).toContain(`floor(tHit * ${W.DEPTH_Q.toFixed(1)}) + clamp(alpha, 0.001, 0.999)`);
  });
});
