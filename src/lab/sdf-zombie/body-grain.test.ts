// src/lab/sdf-zombie/body-grain.test.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md). The pure half: the constants
// match the face sheet they imitate, the two octaves hand over without a gap or an overshoot, and the
// arithmetic is the one the WGSL block (webgpu/march/body/blocks/post/body-grain.wgsl.ts) repeats per pixel.
import { describe, it, expect } from 'vitest';
import {
  GRAIN_BASE_TONE, GRAIN_CELL_COARSE, GRAIN_CELL_FINE, GRAIN_COARSE_LATTICE_OFFSET, GRAIN_FADE_PX, GRAIN_RELIEF,
  grainAlbedoScale, grainCell, grainFadeDistances, grainMask, grainOctaveFades, grainTiltScale, type GrainMasks,
} from './body-grain';
import { DEFAULT_SHEET, generateFaceSheet } from './blob-face-sheet';

const LAB_K = 0.00203; // the lab turntable's pixel cone: tan(37.5 deg) / 378 px

describe('body grain: the face sheet it imitates', () => {
  it("uses the sheet's base tone (a featureless corner texel at grain 0)", () => {
    // Texel (0, 0) is clear of the brow, eyes, nose, jaw, nostrils and mouth for the default sheet.
    const sheet = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0 });
    expect(sheet.pixels[0]! / 255).toBeCloseTo(GRAIN_BASE_TONE, 2);
  });

  it("uses the face's default relief gain", () => {
    expect(GRAIN_RELIEF).toBe(DEFAULT_SHEET.texRelief);
  });

  it("cuts fine cells between the goblin face texel's two sides (3.1 x 3.7 mm)", () => {
    // goblin.blob face block: headRadius 0.118, headWidth 0.76, headHeight 1.161; a 64-texel sheet at the
    // default projection scales (the goblin's sheet block sets neither).
    const tx = (0.118 * 0.76) / (64 * DEFAULT_SHEET.projScaleX);
    const ty = (0.118 * 1.161) / (64 * DEFAULT_SHEET.projScaleY);
    expect(GRAIN_CELL_FINE).toBeGreaterThan(tx);
    expect(GRAIN_CELL_FINE).toBeLessThan(ty);
  });
});

describe('body grain: two octaves', () => {
  it('makes the coarse cell at least HI/LO times the fine one, so the coarse octave is full wherever the fine fades', () => {
    expect(GRAIN_CELL_COARSE / GRAIN_CELL_FINE).toBeGreaterThanOrEqual(GRAIN_FADE_PX.HI / GRAIN_FADE_PX.LO);
  });

  it('fades each octave at the lab distances the plan reports', () => {
    const fine = grainFadeDistances(GRAIN_CELL_FINE, LAB_K);
    expect(fine.full).toBeCloseTo(0.431, 2);
    expect(fine.half).toBeCloseTo(0.575, 2);
    expect(fine.none).toBeCloseTo(0.862, 2);
    const coarse = grainFadeDistances(GRAIN_CELL_COARSE, LAB_K);
    expect(coarse.full).toBeCloseTo(1.478, 2);
    expect(coarse.half).toBeCloseTo(1.970, 2);
    expect(coarse.none).toBeCloseTo(2.956, 2);
  });

  it('weighs the octaves as the plan tabulates at the lab framings', () => {
    const at = (t: number) => grainOctaveFades(t, LAB_K);
    expect(at(0.38)).toEqual({ fine: 1, coarse: 0 });      // BLOB_DIST 0.45 close-up
    expect(at(0.575).fine).toBeCloseTo(0.5, 2);            // BLOB_DIST 0.65, mid cross-fade
    expect(at(0.575).coarse).toBeCloseTo(0.5, 2);
    expect(at(1.28)).toEqual({ fine: 0, coarse: 1 });      // BLOB_DIST 1.35, the owner's framing
    expect(at(1.97).coarse).toBeCloseTo(0.5, 2);
    expect(at(3.0)).toEqual({ fine: 0, coarse: 0 });
  });

  it('never lets the weights sum past 1, and holds them at exactly 1 out to the coarse full distance', () => {
    const fullC = grainFadeDistances(GRAIN_CELL_COARSE, LAB_K).full;
    for (let t = 0.05; t < 6; t += 0.01) {
      const w = grainOctaveFades(t, LAB_K);
      expect(w.fine + w.coarse).toBeLessThanOrEqual(1 + 1e-12);
      if (t <= fullC) expect(w.fine + w.coarse).toBeCloseTo(1, 10);
    }
  });

  it('puts the coarse octave on its own stretch of the hash lattice (no index shared within 2 m)', () => {
    const fineMax = 2 / GRAIN_CELL_FINE;
    const coarseMin = GRAIN_COARSE_LATTICE_OFFSET - 2 / GRAIN_CELL_COARSE;
    expect(coarseMin).toBeGreaterThan(fineMax);
  });
});

describe('body grain: the per-pixel arithmetic', () => {
  it('finds a cell by flooring the rest-space anchor by the cell size', () => {
    expect(grainCell([0.0036, -0.0001, 0.0071], GRAIN_CELL_FINE)).toEqual([1, -1, 2]);
    expect(grainCell([0.0125, -0.0001, 0.025], GRAIN_CELL_COARSE)).toEqual([1, -1, 2]);
  });

  it("multiplies albedo by the face's swing: mean 1, at most +-22% at grain 0.10", () => {
    expect(grainAlbedoScale([{ h: 1, w: 1 }], 0.1)).toBeCloseTo(1.2174, 4);
    expect(grainAlbedoScale([{ h: 0, w: 1 }], 0.1)).toBeCloseTo(0.7826, 4);
    expect((grainAlbedoScale([{ h: 1, w: 1 }], 0.1) + grainAlbedoScale([{ h: 0, w: 1 }], 0.1)) / 2).toBeCloseTo(1, 10);
    // Two octaves at half weight, both at their extreme, swing exactly as far as one at full weight.
    expect(grainAlbedoScale([{ h: 1, w: 0.5 }, { h: 1, w: 0.5 }], 0.1)).toBeCloseTo(1.2174, 4);
    expect(grainAlbedoScale([{ h: 0.9, w: 0 }, { h: 0.1, w: 0 }], 0.1)).toBe(1);
    expect(grainAlbedoScale([], 0.1)).toBe(1);
  });

  it('never swings the albedo past one octave at full weight, at any distance', () => {
    const limit = 0.1 / GRAIN_BASE_TONE + 1e-12;
    for (let t = 0.05; t < 6; t += 0.01) {
      const w = grainOctaveFades(t, LAB_K);
      for (const hF of [0, 1]) for (const hC of [0, 1]) {
        const s = grainAlbedoScale([{ h: hF, w: w.fine }, { h: hC, w: w.coarse }], 0.1);
        expect(Math.abs(s - 1)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("tilts as far as the face's relief: at most 2 x grain x 1.4 = 0.28 per axis at grain 0.10", () => {
    // Face: texRelief x (v_R - v_L), v = 0.46 + (u - 0.5) x 2 x grain, so v_R - v_L = 2 x grain x (u_R - u_L).
    // The body's summed gradient has components of at most wF + wC <= 1, so the same scale tilts at most as far.
    expect(grainTiltScale(0.1)).toBeCloseTo(0.28, 10);
  });

  it('masks to 1 on bare skin and 0 under the face sheet, on gloss, metal, paint, or in a wound', () => {
    const skin: GrainMasks = { faceSheetCover: 0, gloss: 0, metal: 0, painted: 0, wound: 0 };
    expect(grainMask(skin)).toBe(1);
    expect(grainMask({ ...skin, faceSheetCover: 0.25 })).toBeCloseTo(0.75, 10);
    for (const kill of [{ faceSheetCover: 1 }, { gloss: 1 }, { metal: 1 }, { painted: 1 }, { wound: 1 }])
      expect(grainMask({ ...skin, ...kill }), JSON.stringify(kill)).toBe(0);
  });
});
