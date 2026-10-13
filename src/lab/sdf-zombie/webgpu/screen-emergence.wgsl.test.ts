// src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.test.ts
//
// The screen pass's WGSL strings (screen-emergence.wgsl.ts) against wgslFn's one-fn rule and the field module they twin: the constants come
// from emergence-field.ts's tables, and the proxy box holds everything the field can reach over the whole timeline. Whether the WGSL
// compiles is the page's console's job (node cannot compile it).
import { describe, expect, it } from 'vitest';
import { paramsAt, DURATION } from './emergence-timeline';
import { COAT, GOO_LOOK, KEYBOARD_BODY_TOP, KEYBOARD_RECT, coatThickness, EGG, FIGURE_BLOBS, FIGURE_DEPTH, FIGURE_DRIFT, GLASS, PICTURE_TABLE_N, SAC_BLEND, SAC_MAX, SHELL, SHELL_LIGHT, SKIN, SLUMP, TEAR_RAG, TEAR_R_MAX, THICK0, RIPPLE, VEIN_TREE, eggCentre, figureAt, lipOpening, sacExtent, smooth, tearRadius } from './emergence-field';
import { GOO_BOUND0, GOO_COAT0, GOO_TEXELS, N_BEADS, N_COAT, N_CONES, N_DRIPS, N_RUNS, N_STRANDS, STRAND_POINTS, gooAt } from './goo-strands';
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
    expect(W.SCR_GOO).toContain(`i < ${N_CONES}`);                       // the drips and then the runs, as round cones
    expect(N_CONES).toBe(N_DRIPS + N_RUNS);
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
    expect(W.SCR_SHADE).toContain('h1.y < 1.5');
    expect(W.SCR_MAP).toContain(`(1.0 + ${W.TEAR_RIM.thicken} * band)`);
  });

  it('the goo stays inside the proxy box', () => {
    const [x0, y0, z0] = W.SCREEN_PROXY.min, [x1, y1, z1] = W.SCREEN_PROXY.max;
    for (let t = 7; t <= DURATION; t += 0.5) {
      const g = gooAt(t);
      const pts = [...g.strands.filter(s => s.live).flatMap(s => s.points), ...g.beads.filter(b => b.radius > 0).map(b => b.pos),
        ...[...g.drips, ...g.runs].filter(d => d.length > 0).flatMap(d => [d.top, d.tip])];
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

  it('the egg is an eggshell (look round 1): scrSurface sends it to scrShell, which has speckles and no vessels, rim or clear coat', () => {
    const egg = W.SCR_SURFACE.slice(W.SCR_SURFACE.indexOf('if (mat > 2.5)'));
    expect(egg).toContain('scrShell(p, n, rd, c, lamp, scrEggInner(p1), tm, foot)');
    expect(W.SCR_SURFACE).not.toContain('scrVeins');
    expect(W.SCR_SHELL).not.toContain('scrVeins');
    expect(W.SCR_SHELL).not.toContain('scrLight');                       // no hard terminator, no clear coat
    expect(W.SCR_SHELL).not.toContain('smoothstep(0.8, 0.84');            // round two's hard bright rim
    const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    expect(W.SCR_SHELL).toContain(`vec3<f32>(${SHELL.base.map(f).join(', ')})`);
    expect(W.SCR_SHELL).toContain(`scrSpots(q, ${f(SHELL.cell)}, ${f(SHELL.rMin)}, ${f(SHELL.rMax)}, ${f(SHELL.density)}`);
    expect(W.SCR_SHELL).toContain(`max(ndl + ${f(SHELL.wrap)}, 0.0)`);
    expect(W.SCR_SHELL).toContain('scrFigTau(p, rd, c, tm)');
    // the egg's own light shows through its shell fully only while the sac holds it
    expect(W.SCR_EGG_INNER).toContain(`mix(1.0, ${f(SHELL_LIGHT.innerOut)}, smoothstep(0.0, 1.0, p1.y / ${f(SLUMP.release)}))`);
    // the slick mirrors the shell, not the old candled core
    expect(W.SCR_POOL_SHADE).not.toContain('pow(facing, 1.5)');
    expect(W.SCR_SHADE).toContain('scrSurface(p, n, rd, h1.y, p1, d, lip, lamp, sh, tm, foot)');
  });

  it('the figure is figureAt\'s twin: the same drift terms and blobs, its depth from the table', () => {
    const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    for (const [a, w, ph] of FIGURE_DRIFT.axes) expect(W.SCR_FIGURE).toContain(`${f(a)} * sin(${f(w)} * tm + ${f(ph)})`);
    const [na, nw, np] = FIGURE_DRIFT.nod, [fa, fw, fp] = FIGURE_DRIFT.flex;
    expect(W.SCR_FIGURE).toContain(`${f(na)} * sin(${f(nw)} * tm + ${f(np)})`);
    expect(W.SCR_FIGURE).toContain(`1.0 + ${f(fa)} * sin(${f(fw)} * tm + ${f(fp)})`);
    for (const b of FIGURE_BLOBS) {
      expect(W.SCR_FIGURE).toContain(`vec3<f32>(${b.pos.map(f).join(', ')})`);
      expect(W.SCR_FIG_TAU).toContain(`vec3<f32>(${b.sc.map(f).join(', ')})`);
    }
    expect(W.SCR_FIG_TAU).toContain(`${f(FIGURE_DEPTH)} * (`);
    // the same composition as figureAt: the body at the drift, the head nodding (x, and 0.6 of it in z), the limb's offset flexing
    const v = (p: readonly number[]) => `vec3<f32>(${p.map(f).join(', ')})`;
    const [b0, b1, b2] = FIGURE_BLOBS;
    expect(W.SCR_FIGURE).toContain(`return mat3x3<f32>(o + ${v(b0.pos)}, o + ${v(b1.pos)} + vec3<f32>(nod, 0.0, 0.6 * nod), o + ${v(b2.pos)} * flex);`);
    const t = 1.3, c = figureAt(t), o = FIGURE_DRIFT.axes.map(([a, w, ph]) => a * Math.sin(w * t + ph));
    expect(c[0]![1]).toBeCloseTo(o[1]! + b0.pos[1], 12);
    expect(c[2]![0]).toBeCloseTo(o[0]! + b2.pos[0] * (1 + fa * Math.sin(fw * t + fp)), 12);
  });

  it('every piece of goo is ONE substance: the strands, beads, drips and runs, the slicks and the keyboard\'s coat all shade through scrGooShade from GOO_LOOK', () => {
    const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    const v = (p: readonly number[]) => `vec3<f32>(${p.map(f).join(', ')})`;
    // the one shading reads the palette
    expect(W.SCR_GOO_SHADE).toContain(`let base = ${v(GOO_LOOK.base)}`);
    expect(W.SCR_GOO_SHADE).toContain(`base * ${v(GOO_LOOK.sss)}`);
    expect(W.SCR_GOO_SHADE).toContain(`scrLight(p, n, rd, lamp, vec4<f32>(c, eggL * 0.6), base, ${f(GOO_LOOK.coat)})`);
    for (const k of [GOO_LOOK.lampSss, GOO_LOOK.eggSss, GOO_LOOK.eggNear, GOO_LOOK.ambient, GOO_LOOK.sheen, GOO_LOOK.env, GOO_LOOK.envPow]) expect(W.SCR_GOO_SHADE).toContain(f(k));
    expect(W.SCR_GOO_SHADE).toContain(v(GOO_LOOK.envCol));
    // the strands, beads, drips and runs (material 4), the slicks and the coat all call it; the egg's light on goo is one function
    const goo = W.SCR_SURFACE.slice(W.SCR_SURFACE.indexOf('if (mat > 3.5)'), W.SCR_SURFACE.indexOf('if (mat > 2.5)'));
    expect(goo).toContain('scrGooShade(p, n, rd, c, lamp, scrGooEggL(p1)');
    expect(W.SCR_POOL_SHADE).toContain('scrGooShade(p, n, rd, c, lamp, 0.0)');
    expect(W.SCR_SHADE).toContain('scrGooShade(pc, nc, rd, vec3<f32>(0.0, d.z, d.y), lamp, scrGooEggL(p1))');
    expect(W.SCR_GOO_EGG_L).toContain(`mix(1.0, ${f(GOO_LOOK.eggOut)}, smoothstep(0.0, 1.0, p1.y / ${f(SLUMP.release)}))`);
    // no other goo colour anywhere: round two's near-white goo albedo, its white sheen and the slick's near-black film are gone
    for (const [k, src] of STRINGS) {
      expect(src, k).not.toContain('vec3<f32>(0.82, 0.74, 0.7)');
      expect(src, k).not.toContain('vec3<f32>(0.9, 0.88, 0.85)');
      expect(src, k).not.toContain('vec3<f32>(0.02, 0.008, 0.006)');
      if (k !== 'SCR_GOO_SHADE' && k !== 'SCR_POOL_SHADE') expect(src, k).not.toContain(v(GOO_LOOK.base));
    }
  });

  it('the keyboard\'s coat is coatThickness\'s twin and its march stays in its slab over the keyboard', () => {
    const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    expect(W.SCR_COAT_H).toContain(`i < ${N_COAT}`);
    expect(W.SCR_COAT_H).toContain(`${GOO_COAT0} + i`);
    expect(GOO_COAT0 + N_COAT).toBeLessThanOrEqual(GOO_TEXELS);
    for (const k of [COAT.max, COAT.thresh, COAT.inset, KEYBOARD_RECT.x0, KEYBOARD_RECT.x1, KEYBOARD_RECT.z0, KEYBOARD_RECT.z1]) expect(W.SCR_COAT_H).toContain(f(k));
    expect(W.SCR_COAT_H).toContain(`${f(COAT.max)} * (1.0 - exp(-sum / ${f(COAT.max)})) * smoothstep(0.0, 1.0, inside / ${f(COAT.inset)})`);
    expect(W.SCR_COAT_H).toContain(`max(0.0, cap - ${f(COAT.thresh)})`);
    for (const [amp, k, ph] of COAT.lobes) expect(W.SCR_COAT_H).toContain(`${f(amp)} * sin(${f(k)} * a + ${f(ph)} + 1.7 * f32(i))`);
    // evaluate the shader's heightfield in JS (the loop's body over a blob list) and hold it against coatThickness
    const body = W.SCR_COAT_H.slice(W.SCR_COAT_H.indexOf('let inside'), W.SCR_COAT_H.lastIndexOf('}'))
      .replace(/\blet /g, 'const ').replace(/\bvar /g, 'let ')
      .replace(/for \(let i = 0; i < \d+; i = i \+ 1\) \{\n    const b = textureLoad\([^\n]*\n/, 'for (let i = 0; i < B.length; i++) { const b = B[i];\n').replace(/f32\(i\)/g, 'i').replace(/b\.w/g, 'b.r').replace(/b\.y/g, 'b.h')
      .replace(/\b(sin|exp|atan2|min|max)\(/g, 'Math.$1(').replace(/smoothstep\(0\.0, 1\.0, /g, 'sm(').replace(/if \((.*?)\) \{ return (.*?); \}/g, 'if ($1) return $2;')
      .replace(/if \(b\.r <= 0\.0\) \{ continue; \}/, 'if (b.r <= 0) continue;');
    const hJs = new Function('x', 'z', 'B', 'sm', body) as (x: number, z: number, B: readonly { x: number; z: number; r: number; h: number }[], sm: (u: number) => number) => number;
    const blobs = [{ x: 0, z: 0.185, r: 0.2, h: 0.04 }, { x: -0.12, z: 0.1, r: 0.05, h: 0.015 }, { x: 0.1, z: 0.1, r: 0, h: 0 }];
    for (let x = KEYBOARD_RECT.x0 - 0.01; x <= KEYBOARD_RECT.x1 + 0.01; x += 0.023) for (let z = KEYBOARD_RECT.z0 - 0.01; z <= KEYBOARD_RECT.z1 + 0.01; z += 0.011)
      expect(hJs(x, z, blobs, smooth), `x=${x.toFixed(3)} z=${z.toFixed(3)}`).toBeCloseTo(coatThickness(blobs, x, z), 9);
    expect(W.SCR_COAT).toContain(`${f(KEYBOARD_BODY_TOP)}, ${f(KEYBOARD_RECT.z0)}`);
    expect(W.SCR_COAT).toContain(`${f(KEYBOARD_BODY_TOP + COAT.max)}, ${f(KEYBOARD_RECT.z1)}`);
    expect(W.SCR_COAT).toContain(`i <= ${W.COAT_STEPS}`);
    // the coat's slab lies inside the proxy box
    expect(KEYBOARD_RECT.x0).toBeGreaterThan(W.SCREEN_PROXY.min[0]); expect(KEYBOARD_RECT.x1).toBeLessThan(W.SCREEN_PROXY.max[0]);
    expect(KEYBOARD_BODY_TOP).toBeGreaterThan(W.SCREEN_PROXY.min[1]);
    expect(KEYBOARD_RECT.z0).toBeGreaterThan(W.SCREEN_PROXY.min[2]); expect(KEYBOARD_RECT.z1).toBeLessThan(W.SCREEN_PROXY.max[2]);
    // translucent where thin (the keys show), nearly opaque where thick
    expect(GOO_LOOK.film).toBeLessThan(GOO_LOOK.filmThick);
    expect(GOO_LOOK.filmThick).toBeLessThan(1);
  });

  it('the membrane\'s veins are VEIN_TREE\'s branching tree, not round one\'s sine ridges', () => {
    const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    expect(W.SCR_VEINS).not.toContain('v.x * 31.0');
    expect(W.SCR_VEINS).toContain(`* ${f(VEIN_TREE.n)}`);
    expect(W.SCR_VEINS).toContain(`var w = ${f(VEIN_TREE.w0)}`);
    for (const s0 of VEIN_TREE.forks) expect(W.SCR_VEINS).toContain(`${f(s0)} + ${f(VEIN_TREE.jitter)} *`);
    expect(W.SCR_VEINS.match(/side\d = select/g)).toHaveLength(VEIN_TREE.forks.length);
    expect(W.SCR_VEINS).toContain('cen = clamp(cen, 0.03, 0.97)');
    expect(W.SCR_SHEET).toContain('scrVeins(atan2(p.y, p.x), sv, length(p.xy)');
  });
});
