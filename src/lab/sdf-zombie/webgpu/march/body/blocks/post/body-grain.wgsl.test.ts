// src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md). Nothing here compiles a shader;
// these pin what can be checked from text: the guards, the anchor, both octaves' cells and fades, that the
// constants agree with body-grain.ts, and the formulas. The GPU proof is docs/dev-notes/2026-10-02-body-grain/.
import { describe, it, expect } from 'vitest';
import { BODY_GRAIN_BLOCK } from './body-grain.wgsl';
import {
  GRAIN_BASE_TONE, GRAIN_CELL_COARSE, GRAIN_CELL_FINE, GRAIN_COARSE_LATTICE_OFFSET, GRAIN_FADE_PX, GRAIN_RELIEF,
} from '../../../../../body-grain';

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

describe('body grain block (post-hit, two octaves)', () => {
  it('reads the per-instance grain lane, skips everything at 0, and writes only where an octave is drawn', () => {
    expect(B).toContain('let grainAmt = gInstMelt.w;');
    const guard = at(B, 'if (grainAmt > 0.0) {');
    const write = at(B, 'if (grainWF + grainWC > 0.0) {');
    expect(write).toBeGreaterThan(guard);
    expect(at(B, 'albedo = albedo *')).toBeGreaterThan(write);
    expect(at(B, 'n = normalize(')).toBeGreaterThan(write);
  });

  it('names its cell sizes with the same values as body-grain.ts', () => {
    expect(B).toContain(`let grainCellFine = ${f(GRAIN_CELL_FINE)};`);
    expect(B).toContain(`let grainCellCoarse = ${f(GRAIN_CELL_COARSE)};`);
  });

  it('fades each octave by the pixel cone, the coarse one by what the fine one has lost', () => {
    expect(B).toContain('let grainPix = max(2.0 * t * aaCfg.x, 1e-6);');
    expect(B).toContain(`let grainFadeF = smoothstep(${LO}, ${HI}, grainCellFine / grainPix);`);
    expect(B).toContain(`let grainFadeC = (1.0 - grainFadeF) * smoothstep(${LO}, ${HI}, grainCellCoarse / grainPix);`);
  });

  it('masks both octaves under the face sheet, on gloss and metal, on paint and in wounds', () => {
    expect(B).toContain(
      'let grainMask = (1.0 - faceSheetCover) * (1.0 - max(gloss, metal)) * (1.0 - painted) * clamp(1.0 - wm, 0.0, 1.0);');
    expect(B).toContain('let grainWF = grainFadeF * grainMask;');
    expect(B).toContain('let grainWC = grainFadeC * grainMask;');
  });

  it("guards each octave's hashes on its own weight: 7 per drawn octave, 14 at most", () => {
    const fine = at(B, 'if (grainWF > 0.0) {');
    const coarse = at(B, 'if (grainWC > 0.0) {');
    expect(coarse).toBeGreaterThan(fine);
    expect(at(B, 'hash13(grainCF')).toBeGreaterThan(fine);
    expect(at(B, 'hash13(grainCF')).toBeLessThan(coarse);
    expect(at(B, 'hash13(grainCC')).toBeGreaterThan(coarse);
    expect(CODE.match(/hash13\(/g)).toHaveLength(14);
    expect(CODE.match(/hash13\(grainCF/g)).toHaveLength(7);
    expect(CODE.match(/hash13\(grainCC/g)).toHaveLength(7);
  });

  it('cuts both octaves in the rest-space anchor, the coarse one on its own stretch of the hash lattice', () => {
    expect(B).toContain('let grainCF = floor(anchor / grainCellFine);');
    expect(B).toContain(`let grainCC = floor(anchor / grainCellCoarse) + vec3<f32>(${f(GRAIN_COARSE_LATTICE_OFFSET)});`);
    expect(CODE).not.toMatch(/floor\(p\b/);
  });

  it("sums the octaves' albedo deviations, in the face sheet's units", () => {
    expect(B).toContain('grainDev = grainDev + (hash13(grainCF) - 0.5) * grainWF;');
    expect(B).toContain('grainDev = grainDev + (hash13(grainCC) - 0.5) * grainWC;');
    expect(B).toContain(`albedo = albedo * (1.0 + grainDev * 2.0 * grainAmt / ${f(GRAIN_BASE_TONE)});`);
  });

  it("sums the octaves' neighbour-cell gradients into one tilt at the face's relief gain, in the tangent plane", () => {
    for (const c of ['grainCF', 'grainCC'])
      for (const axis of ['vec3<f32>(1.0, 0.0, 0.0)', 'vec3<f32>(0.0, 1.0, 0.0)', 'vec3<f32>(0.0, 0.0, 1.0)'])
        expect(B).toContain(`hash13(${c} + ${axis}) - hash13(${c} - ${axis})`);
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
