// src/lab/sdf-zombie/body-grain.test.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md). The pure half: the constants
// match the face sheet they imitate, the single fine octave fades by the pixel cone (the coarse octave was removed
// 2026-10-02 at the owner's request, see body-grain.ts), and the arithmetic is the one the WGSL block
// (webgpu/march/body/blocks/post/body-grain.wgsl.ts) repeats per pixel.
import { describe, it, expect } from 'vitest';
import {
  GRAIN_ALBEDO_SHARE, GRAIN_BASE_TONE, GRAIN_CELL_FINE, GRAIN_RELIEF,
  grainAlbedoScale, grainCell, grainFade, grainFadeDistances, grainMask, grainTiltScale, type GrainMasks,
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

describe('body grain: one fine octave', () => {
  it('fades out at the lab distances the plan reports (and has nothing beyond 0.86 m, by the owner\'s choice)', () => {
    const fine = grainFadeDistances(GRAIN_CELL_FINE, LAB_K);
    expect(fine.full).toBeCloseTo(0.431, 2);
    expect(fine.half).toBeCloseTo(0.575, 2);
    expect(fine.none).toBeCloseTo(0.862, 2);
  });

  it('is full up close, half at the cross-over, and gone at the owner\'s 1.35 m framing', () => {
    expect(grainFade(0.38, LAB_K)).toBe(1);             // BLOB_DIST 0.45 close-up
    expect(grainFade(0.575, LAB_K)).toBeCloseTo(0.5, 2);
    expect(grainFade(1.28, LAB_K)).toBe(0);              // BLOB_DIST 1.35: no big squares any more
    expect(grainFade(3.0, LAB_K)).toBe(0);
  });

  it('never exceeds 1 and never rises with distance', () => {
    let prev = 1;
    for (let t = 0.05; t < 6; t += 0.01) {
      const w = grainFade(t, LAB_K);
      expect(w).toBeLessThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });
});

describe('body grain: the per-pixel arithmetic', () => {
  it('finds a cell by flooring the rest-space anchor by the cell size', () => {
    expect(grainCell([0.0036, -0.0001, 0.0071], GRAIN_CELL_FINE)).toEqual([1, -1, 2]);
  });

  it("multiplies albedo by a share of the face's swing: mean 1, at most +-7.6% at grain 0.10", () => {
    // The face varies by 2 x grain / 0.46 = +-21.7% at 0.10; the body takes GRAIN_ALBEDO_SHARE of that.
    expect(GRAIN_ALBEDO_SHARE).toBe(0.35);
    expect(grainAlbedoScale(1, 1, 0.1)).toBeCloseTo(1 + 0.2174 * 0.35, 4);
    expect(grainAlbedoScale(0, 1, 0.1)).toBeCloseTo(1 - 0.2174 * 0.35, 4);
    expect((grainAlbedoScale(1, 1, 0.1) + grainAlbedoScale(0, 1, 0.1)) / 2).toBeCloseTo(1, 10);
    expect(grainAlbedoScale(0.9, 0, 0.1)).toBe(1);
  });

  it('never swings the albedo further than the share allows, at any distance', () => {
    const limit = (0.1 / GRAIN_BASE_TONE) * GRAIN_ALBEDO_SHARE + 1e-12;
    for (let t = 0.05; t < 6; t += 0.01)
      for (const h of [0, 1]) expect(Math.abs(grainAlbedoScale(h, grainFade(t, LAB_K), 0.1) - 1)).toBeLessThanOrEqual(limit);
  });

  it("tilts as far as the face's relief: at most 2 x grain x 1.4 = 0.28 per axis at grain 0.10", () => {
    // Face: texRelief x (v_R - v_L), v = 0.46 + (u - 0.5) x 2 x grain, so v_R - v_L = 2 x grain x (u_R - u_L).
    // The body's gradient has components of at most the weight <= 1, so the same scale tilts at most as far, and the
    // tilt is deliberately NOT scaled down with the albedo share: the grain should read as relief (owner, 2026-10-02).
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
