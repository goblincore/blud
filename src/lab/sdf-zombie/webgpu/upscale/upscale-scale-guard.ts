/**
 * THE setSdfScale GUARD (2026-09-25). Pure — no three.js — so it tests GPU-free.
 *
 * The upscale stage is built around ONE march scale: it upscales exactly 2x
 * (UPSCALE_SCALE), or 4x when stacked on the checker accumulation, whose
 * rebuilt 2x-march grid is its input. The WGSL prelude hard-codes the 2x step
 * (it samples the input at big/2), so any other scale with the stage on is
 * garbage: at scale 1 input == output and the frame shows the top-left
 * QUARTER of the march magnified 2x (flesh slides bottom-right, the segment-mesh
 * bones stay put — "skeleton, no flesh"). That state was what every harness
 * that pinned setSdfScale(1.0) captured from 2026-09-13 to 2026-09-25.
 *
 * Rule: a scale change that does not match the live stage drops the stage to
 * NATIVE (the U-key A/B native mode, so the A/B state stays consistent), then
 * applies the requested scale. The converse is deliberately absent: setting
 * UPSCALE_SCALE again never re-enables a stage — it stays off until the caller
 * turns it back on (U key / __sdfGame.setUpscale).
 */
import { UPSCALE_SCALE } from './upscale-model';

/** Scale bounds applySdfScale has always clamped to. */
export const SDF_SCALE_MIN = 0.2;
export const SDF_SCALE_MAX = 1;

/** The march scale a live stage needs: 2x, or 4x stacked on the checker accumulation. */
export function upscaleMarchScale(stacked: boolean): number {
  return stacked ? UPSCALE_SCALE / 2 : UPSCALE_SCALE;
}

export interface ScaleWithUpscaler {
  /** The clamped scale to apply. */
  scale: number;
  /** 'keep' = leave the stage as it is (on or off); 'native' = switch it off first. */
  upscaler: 'keep' | 'native';
}

export function resolveScaleWithUpscaler(scale: number, upscalerOn: boolean, stacked = false): ScaleWithUpscaler {
  const s = Math.min(SDF_SCALE_MAX, Math.max(SDF_SCALE_MIN, scale));
  if (!upscalerOn) return { scale: s, upscaler: 'keep' };
  const need = upscaleMarchScale(stacked);
  // Within float noise of the stage's scale: snap to it exactly (0.49999999999999994 is 0.5).
  return Math.abs(s - need) < 1e-6 ? { scale: need, upscaler: 'keep' } : { scale: s, upscaler: 'native' };
}
