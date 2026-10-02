// src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md). Nothing here compiles a shader;
// these pin what can be checked from text: the guards, the anchor, the cell and its fade, that the
// constants agree with body-grain.ts, and the formulas. The GPU proof is docs/dev-notes/2026-10-02-body-grain/.
import { describe, it, expect } from 'vitest';
import { BODY_GRAIN_BLOCK } from './body-grain.wgsl';
import {
  GRAIN_ALBEDO_SHARE, GRAIN_BASE_TONE, GRAIN_CELL_FINE, GRAIN_FADE_PX, GRAIN_RELIEF,
} from '../../../../../body-grain';
import {
  MARCH_BODY, REFINE_BODY, MARCH_TRACE_POST, MARCH_TRACE_LOOP, MARCH_TRACE_SETUP,
  MAP_BODY, CALC_NORMAL, CONE_MARCH, DEPTH_PREPASS_MARCH, WOUND_SHADOW,
} from '../../../../march.wgsl';
import { MARCH_SURFACE } from '../../../../deferred-sdf';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const LO = f(GRAIN_FADE_PX.LO);
const HI = f(GRAIN_FADE_PX.HI);
const B = BODY_GRAIN_BLOCK;
const CODE = B.replace(/\/\/[^\n]*/g, '');
const at = (src: string, needle: string) => {
  const i = src.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

describe('body grain block (post-hit, one fine octave)', () => {
  it('reads the per-instance grain lane, skips everything at 0, and writes only where the cell is drawn', () => {
    expect(B).toContain('let grainAmt = gInstMelt.w;');
    const guard = at(B, 'if (grainAmt > 0.0) {');
    const write = at(B, 'if (grainWF > 0.0) {');
    expect(write).toBeGreaterThan(guard);
    expect(at(B, 'albedo = albedo *')).toBeGreaterThan(write);
    expect(at(B, 'n = normalize(')).toBeGreaterThan(write);
  });

  it('has no coarse octave (removed 2026-10-02: it read as big pixels)', () => {
    expect(CODE).not.toContain('grainCellCoarse');
    expect(CODE).not.toContain('grainWC');
    expect(CODE).not.toContain('grainCC');
  });

  it('names its cell size with the same value as body-grain.ts', () => {
    expect(B).toContain(`let grainCellFine = ${f(GRAIN_CELL_FINE)};`);
  });

  it('fades the cell by the pixel cone', () => {
    expect(B).toContain('let grainPix = max(2.0 * t * aaCfg.x, 1e-6);');
    expect(B).toContain(`let grainFadeF = smoothstep(${LO}, ${HI}, grainCellFine / grainPix);`);
  });

  it('masks the cell under the face sheet, on gloss and metal, on paint and in wounds', () => {
    expect(B).toContain(
      'let grainMask = (1.0 - faceSheetCover) * (1.0 - max(gloss, metal)) * (1.0 - painted) * clamp(1.0 - wm, 0.0, 1.0);');
    expect(B).toContain('let grainWF = grainFadeF * grainMask;');
  });

  it('guards its hashes on the weight: 7 per drawn pixel, none once faded out', () => {
    const fine = at(B, 'if (grainWF > 0.0) {');
    expect(at(B, 'hash13(grainCF')).toBeGreaterThan(fine);
    expect(CODE.match(/hash13\(/g)).toHaveLength(7);
  });

  it('cuts the cell in the rest-space anchor', () => {
    expect(B).toContain('let grainCF = floor(anchor / grainCellFine);');
    expect(CODE).not.toMatch(/floor\(p\b/);
  });

  it("takes a share of the face's albedo swing, in the face sheet's units", () => {
    expect(B).toContain('let grainDev = (hash13(grainCF) - 0.5) * grainWF;');
    expect(B).toContain(`albedo = albedo * (1.0 + grainDev * 2.0 * grainAmt * ${f(GRAIN_ALBEDO_SHARE)} / ${f(GRAIN_BASE_TONE)});`);
  });

  it("tilts by the neighbour-cell gradient at the face's FULL relief gain, in the tangent plane", () => {
    for (const axis of ['vec3<f32>(1.0, 0.0, 0.0)', 'vec3<f32>(0.0, 1.0, 0.0)', 'vec3<f32>(0.0, 0.0, 1.0)'])
      expect(B).toContain(`hash13(grainCF + ${axis}) - hash13(grainCF - ${axis})`);
    expect(B).toContain(`let grainTilt = -grainGrad * (2.0 * grainAmt * ${f(GRAIN_RELIEF)});`);
    expect(B).toContain('n = normalize(n + grainTilt - n * dot(grainTilt, n));');
  });

  it('prefixes every local with grain, so none can collide with a name the walk declares (REFINE_LOOP pin)', () => {
    const names = [...CODE.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith('grain'), name).toBe(true);
  });

  it('carries no light-dependent or counted marker (entry/deferred/tissue tests count them)', () => {
    for (const marker of ['ANALYTIC FLASHLIGHT', 'ambientAt(', 'woundShadow(', 'levelShadow(', 'var fleshLit',
      'softShoulder(', '0.04045', 'mapBody(', 'woundMask(', 'let specPow', 'var wet = ', 'let glow = '])
      expect(B).not.toContain(marker);
  });
});

describe('body grain plumbing (palette -> meltCfg.w -> record -> gInstMelt.w)', () => {
  it('applyMaterial writes the palette grain into meltCfg.w and syncs the record', async () => {
    const gpu = (await import('../../../../zombie-gpu?raw')).default;
    const start = gpu.indexOf('applyMaterial(m, light) {');
    expect(start).toBeGreaterThan(-1);
    const apply = gpu.slice(start, gpu.indexOf('dispose() {', start));
    expect(apply).toContain('u.meltCfg.value.w = m.grain;');
    expect(apply).toContain('syncRecord();');
  });
});

describe('body grain in the post-hit chain', () => {
  const entries: Record<string, string> = { MARCH_BODY, REFINE_BODY, MARCH_SURFACE };

  it('is spliced once into the shared post-hit section, so all three entries run it', () => {
    expect(MARCH_TRACE_POST.split(BODY_GRAIN_BLOCK)).toHaveLength(2);
    for (const [name, src] of Object.entries(entries)) expect(src.split(BODY_GRAIN_BLOCK), name).toHaveLength(2);
  });

  it('runs after the face layer leaves its coverage (and after the micro-detail and mottle), before gore and paint', () => {
    for (const src of Object.values(entries)) {
      const grain = at(src, 'let grainAmt = gInstMelt.w;');
      expect(at(src, 'faceSheetCover = facing * tex.a;')).toBeLessThan(grain);
      expect(at(src, 'mix(albedo, mottleColor')).toBeLessThan(grain);
      expect(at(src, 'let detailAmp = surfCfg2.y')).toBeLessThan(grain);
      expect(grain).toBeLessThan(at(src, 'let goreStrength = max(lodCfg.w, gInstGore)'));
      expect(grain).toBeLessThan(at(src, 'if (painted > 0.0) {'));
    }
  });

  it('stays out of the walk, the field and the pre-passes', () => {
    for (const src of [MARCH_TRACE_SETUP, MARCH_TRACE_LOOP, MAP_BODY, CALC_NORMAL, CONE_MARCH, DEPTH_PREPASS_MARCH, WOUND_SHADOW])
      expect(src).not.toContain('grainAmt');
  });
});
