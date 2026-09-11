/**
 * G3 parity (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md §3): the
 * TypeScript twin's reconstruction against PyTorch's, both float32 RGBA with clip depth in alpha.
 */
import type { FloatImage } from '../../src/lab/sdf-zombie/webgpu/upscale/upscale-reference';

/** Colour: max |ours - theirs| / max(1, |theirs|). */
export const G3_RGB_TOL = 1e-4;
/** Coverage must agree wherever the decision is at least this far from its threshold. */
export const G3_COVERAGE_BAND = 1e-3;

export interface ParityResult {
  pixels: number;
  covered: number;
  maxRelRgb: number;
  depthMismatch: number;
  coverageMismatch: number;
  coverageMismatchFar: number;
  pass: boolean;
}

/** `margin` is ours: ownHit + coverage residual - 0.5 per output pixel (upscaleReference marginOut). */
export function compareReconstruction(ours: FloatImage, theirs: FloatImage, margin: Float32Array,
  rgbTol = G3_RGB_TOL, band = G3_COVERAGE_BAND): ParityResult {
  if (ours.w !== theirs.w || ours.h !== theirs.h || ours.c !== 4 || theirs.c !== 4) {
    throw new Error(`compareReconstruction: ${ours.w}x${ours.h}x${ours.c} vs ${theirs.w}x${theirs.h}x${theirs.c}`);
  }
  const pixels = ours.w * ours.h;
  if (margin.length !== pixels) throw new Error(`compareReconstruction: margin has ${margin.length} values for ${pixels} pixels`);
  let covered = 0, maxRelRgb = 0, depthMismatch = 0, coverageMismatch = 0, coverageMismatchFar = 0;
  for (let p = 0; p < pixels; p++) {
    const b = p * 4;
    const oc = ours.data[b + 3]! < 1;
    const tc = theirs.data[b + 3]! < 1;
    if (oc !== tc) {
      coverageMismatch++;
      if (Math.abs(margin[p]!) >= band) coverageMismatchFar++;
      continue;
    }
    if (!oc) continue;
    covered++;
    if (ours.data[b + 3] !== theirs.data[b + 3]) depthMismatch++;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(ours.data[b + c]! - theirs.data[b + c]!) / Math.max(1, Math.abs(theirs.data[b + c]!));
      if (d > maxRelRgb) maxRelRgb = d;
    }
  }
  return {
    pixels, covered, maxRelRgb, depthMismatch, coverageMismatch, coverageMismatchFar,
    pass: maxRelRgb <= rgbTol && depthMismatch === 0 && coverageMismatchFar === 0,
  };
}
