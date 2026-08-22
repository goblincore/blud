// src/lab/sdf-zombie/blob-face-sheet.test.ts
import { describe, it, expect } from 'vitest';
import { generateFaceSheet, DEFAULT_SHEET, type FaceSheetParams } from './blob-face-sheet';

/** Greyscale value at a uv position, for asserting a feature landed somewhere. */
const at = (s: ReturnType<typeof generateFaceSheet>, u: number, v: number) =>
  s.pixels[Math.floor(v * s.size) * s.size + Math.floor(u * s.size)]!;

describe('generateFaceSheet', () => {
  it('fills the whole buffer at the requested size', () => {
    const s = generateFaceSheet(DEFAULT_SHEET, 64);
    expect(s.pixels).toHaveLength(64 * 64);
    expect(s.size).toBe(64);
  });

  // The mean is what the shader divides out. A hardcoded or stale value shifts
  // the entire head's brightness, so it has to come off the pixels produced.
  it('measures the mean off its own pixels rather than assuming one', () => {
    const s = generateFaceSheet(DEFAULT_SHEET, 64);
    const actual = s.pixels.reduce((n, b) => n + b, 0) / (64 * 64 * 255);
    expect(s.mean).toBeCloseTo(actual, 10);
    expect(s.mean).toBeGreaterThan(0.2);
    expect(s.mean).toBeLessThan(0.95);
  });

  it('is deterministic for a seed, and different across seeds', () => {
    const a = generateFaceSheet({ ...DEFAULT_SHEET, seed: 7 });
    const b = generateFaceSheet({ ...DEFAULT_SHEET, seed: 7 });
    const c = generateFaceSheet({ ...DEFAULT_SHEET, seed: 8 });
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
    expect(Array.from(a.pixels)).not.toEqual(Array.from(c.pixels));
  });

  // The eyes are the one feature that LIGHTENS, because the shader's emissive
  // mask is smoothstep(threshold, 1, luma(tex)) — brightness is what glows.
  // This test was originally written the other way round, asserting the eyes
  // were darker; the generated face then lit up red across its whole surface,
  // because a bright base cleared the glow threshold everywhere. Keep the
  // direction of this assertion.
  it('puts the eyes BRIGHTER than the cheek beside them, so they key the glow', () => {
    const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0 });
    const eye = at(s, 0.5 - DEFAULT_SHEET.eyeGap / 2, DEFAULT_SHEET.eyeRise);
    const cheek = at(s, 0.5 - DEFAULT_SHEET.eyeGap / 2, DEFAULT_SHEET.eyeRise + 0.18);
    expect(eye).toBeGreaterThan(cheek + 60);
  });

  // Everything that is not an eye must sit BELOW the glow threshold, or the
  // face glows in patches. The zombie sheet's measured mean is 0.406; a
  // generated sheet that drifts far above that is bright enough to bloom.
  it('keeps the sheet dark overall so only the eyes can glow', () => {
    const s = generateFaceSheet(DEFAULT_SHEET);
    expect(s.mean).toBeLessThan(0.6);
    const bright = [...s.pixels].filter(b => b > 200).length;
    expect(bright / s.pixels.length).toBeLessThan(0.06);
  });

  it('puts a bright catchlight in each eye when eyeGlint is on, and none when off', () => {
    // The glint is drawn at eyeDX + 0.32*eyeSize in u, eyeRise - 0.34*eyeSize
    // in v (upper-outer corner); the opposite (lower-inner) corner stays dark.
    const e = DEFAULT_SHEET.eyeSize;
    const u = 0.5 + DEFAULT_SHEET.eyeGap / 2;
    const on = generateFaceSheet({ ...DEFAULT_SHEET, eyeGlow: 0.05, eyeGlint: 0.82, grain: 0 });
    const glint = at(on, u + 0.32 * e, DEFAULT_SHEET.eyeRise - 0.34 * e);
    const dark = at(on, u - 0.30 * e, DEFAULT_SHEET.eyeRise + 0.20 * e);
    expect(glint).toBeGreaterThan(dark + 40);
    // With glint off the same upper-outer corner stays as dark as the eye.
    const off = generateFaceSheet({ ...DEFAULT_SHEET, eyeGlow: 0.05, eyeGlint: 0, grain: 0 });
    expect(at(off, u + 0.32 * e, DEFAULT_SHEET.eyeRise - 0.34 * e)).toBeLessThan(60);
  });

  it('puts the mouth darker than the chin below it', () => {
    const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0 });
    const mouth = at(s, 0.5, DEFAULT_SHEET.mouthRise);
    const chin = at(s, 0.5, Math.min(0.97, DEFAULT_SHEET.mouthRise + 0.15));
    expect(mouth).toBeLessThan(chin - 20);
  });

  it('is symmetric about the vertical axis once grain is off', () => {
    const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0 }, 64);
    for (let y = 0; y < 64; y += 7)
      for (let x = 0; x < 32; x += 5)
        expect(s.pixels[y * 64 + x]).toBe(s.pixels[y * 64 + (63 - x)]);
  });

  // Grain exists so the two halves are not identical — a perfectly symmetric
  // face reads as a mask rather than a creature.
  it('breaks that symmetry once grain is on', () => {
    const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0.2 }, 64);
    let differing = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 32; x++)
        if (s.pixels[y * 64 + x] !== s.pixels[y * 64 + (63 - x)]) differing++;
    expect(differing).toBeGreaterThan(64 * 32 * 0.5);
  });

  it('removes a feature entirely when its amplitude is zero', () => {
    // jawShade off too: it darkens a band near the chin, which is exactly
    // where this samples. A feature being removable is the property under
    // test, so every feature overlapping the probe has to be off.
    const off: FaceSheetParams = {
      ...DEFAULT_SHEET, grain: 0, mouthOpen: 0, nostril: 0, jawShade: 0, noseRidge: 0,
    };
    const s = generateFaceSheet(off);
    const mouth = at(s, 0.5, DEFAULT_SHEET.mouthRise);
    const chin = at(s, 0.5, Math.min(0.97, DEFAULT_SHEET.mouthRise + 0.15));
    expect(Math.abs(mouth - chin)).toBeLessThan(3);
  });

  it('darkens the brow band as browHeavy rises', () => {
    const browAt = (h: number) => {
      const s = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0, browHeavy: h });
      return at(s, 0.5 - DEFAULT_SHEET.eyeGap / 2, DEFAULT_SHEET.eyeRise - 0.085);
    };
    expect(browAt(0.9)).toBeLessThan(browAt(0.1) - 20);
  });

  it('never produces a value outside a byte', () => {
    const wild = generateFaceSheet({
      ...DEFAULT_SHEET, grain: 5, browHeavy: 9, nostril: 9, eyeSize: 0.4,
    });
    for (const b of wild.pixels) expect(b).toBeGreaterThanOrEqual(0), expect(b).toBeLessThanOrEqual(255);
  });
});
