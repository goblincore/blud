// src/lab/sdf-zombie/webgpu/shutter-timing.ts
//
// PURE SHUTTER EXPOSURE CONTRACT (selective shutter blur, task 1).
//
// Exposure is a length of time, in SECONDS, during which a selected moving
// surface contributes to a frame. It is deliberately NOT derived from the
// measured render delta: the same preset gives the same blur at 30, 60 and
// 120 fps presentation, which is the whole point of a real camera shutter.
// The renderer never reads `dt` here.
//
// Units are explicit everywhere because the two classic bugs in this feature
// are (a) treating a shutter ANGLE as seconds and (b) letting a frame hitch
// inflate the window. `angleToExposureSeconds` requires a caller-supplied
// reference cadence for exactly that reason.
//
// No three import, no DOM: this module is the testable heart of the feature
// and is shared by the page, the reference resolver and its tests.

/** Trailing shutter interval `[now - exposure, now]` is the shipped model.
 *  A centred shutter would need future pose prediction or presentation delay;
 *  the plan calls the trailing form an intentional aesthetic approximation. */
export type ShutterProfile = 'trailing-box';

export type ShutterPresetId = 'off' | '1-240' | '1-120' | '1-60' | '1-30';

export interface ShutterPreset {
  id: ShutterPresetId;
  label: string;
  /** Exposure length in seconds. 0 means OFF (instantaneous, sharp). */
  seconds: number;
}

/**
 * The approved preset table. `seconds` is the source of truth; the label is
 * display only. Order is longest-shutter last so a UI can present them
 * fastest-first without inventing an order.
 *
 * 1/1000-style decimals are written as exact divisions so a test can assert
 * the equation, not a rounded literal.
 */
export const SHUTTER_PRESETS: readonly ShutterPreset[] = [
  { id: 'off', label: 'Off (sharp)', seconds: 0 },
  { id: '1-240', label: '1/240 s', seconds: 1 / 240 },
  { id: '1-120', label: '1/120 s', seconds: 1 / 120 },
  { id: '1-60', label: '1/60 s', seconds: 1 / 60 },
  { id: '1-30', label: '1/30 s', seconds: 1 / 30 },
];

/** The four shutter times the initial comparison should cover (plan table). */
export const COMPARISON_PRESETS: readonly ShutterPresetId[] = ['off', '1-120', '1-60', '1-30'];

/** Explicit reference cadence for angle math. Never the live measured FPS. */
export const DEFAULT_REFERENCE_FPS = 60;

/** Hard bounds so a UI slider cannot request an unbounded sample count. */
export const MAX_SHUTTER_SAMPLES = 64;
export const MIN_EXPOSURE_SECONDS = 1 / 1000;

export function shutterPreset(id: ShutterPresetId): ShutterPreset {
  return SHUTTER_PRESETS.find(p => p.id === id) ?? SHUTTER_PRESETS[0]!;
}

/** Milliseconds for display beside the preset ("8.3 ms"). */
export function exposureMs(seconds: number): number {
  return seconds * 1000;
}

/** A user-facing label that carries BOTH units the plan asks for. */
export function formatExposure(seconds: number): string {
  if (!(seconds > 0)) return 'off (0 ms)';
  return `${(1 / seconds).toFixed(0)} s exposure = ${exposureMs(seconds).toFixed(2)} ms`;
}

/**
 * Shutter ANGLE -> exposure seconds. The plan's formula:
 *   exposureSeconds = angle / 360 / referenceFps
 * so 180 degrees at 60 fps is 1/120 s and at 30 fps is 1/60 s.
 *
 * `referenceFps` MUST be passed explicitly. A non-finite or non-positive
 * cadence returns 0 rather than guessing the live FPS — silently substituting
 * measured FPS is the bug this signature exists to prevent.
 */
export function angleToExposureSeconds(angleDeg: number, referenceFps: number): number {
  if (!Number.isFinite(angleDeg) || angleDeg <= 0) return 0;
  if (!Number.isFinite(referenceFps) || referenceFps <= 0) return 0;
  return angleDeg / 360 / referenceFps;
}

export type ShutterMode = 'off' | 'seconds' | 'angle';

export interface ShutterSetting {
  mode: ShutterMode;
  /** Seconds of exposure when mode === 'seconds'. */
  seconds: number;
  /** Shutter angle in degrees when mode === 'angle'. */
  angleDeg: number;
  /** Explicit reference cadence for mode === 'angle'. */
  referenceFps: number;
}

export function shutterSettingFromPreset(id: ShutterPresetId): ShutterSetting {
  const p = shutterPreset(id);
  return { mode: p.seconds > 0 ? 'seconds' : 'off', seconds: p.seconds, angleDeg: 180, referenceFps: DEFAULT_REFERENCE_FPS };
}

/** Resolve any setting to a finite, non-negative exposure in seconds. */
export function resolveExposureSeconds(setting: ShutterSetting): number {
  if (setting.mode === 'off') return 0;
  if (setting.mode === 'angle') {
    return angleToExposureSeconds(setting.angleDeg, setting.referenceFps);
  }
  if (!Number.isFinite(setting.seconds) || setting.seconds <= 0) return 0;
  return setting.seconds;
}

export function clampSampleCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_SHUTTER_SAMPLES, Math.floor(n)));
}

/**
 * Per-category artistic multiplier on the base exposure. It changes the
 * effective interval only; it is not applied to scene brightness.
 */
export function effectiveExposureSeconds(baseSeconds: number, categoryAmount: number): number {
  if (!Number.isFinite(baseSeconds) || baseSeconds <= 0) return 0;
  if (!Number.isFinite(categoryAmount) || categoryAmount <= 0) return 0;
  return baseSeconds * categoryAmount;
}

export interface ShutterInterval {
  from: number;
  to: number;
}

/**
 * Trailing interval `[now - exposure, now]`. Negative start is allowed while
 * the event is younger than the exposure; the timeline samples clamp to its
 * own bounds and an empty pre-birth span contributes no coverage.
 */
export function trailingInterval(nowSec: number, exposureSeconds: number): ShutterInterval {
  const exposure = Number.isFinite(exposureSeconds) && exposureSeconds > 0 ? exposureSeconds : 0;
  return { from: nowSec - exposure, to: nowSec };
}

/**
 * Geometric streak length at constant PROJECTED speed:
 *   streakPixels = speedPixelsPerSecond * exposureSeconds
 * e.g. 600 px/s at 1/120, 1/60, 1/30 -> 5, 10, 20 px. This is before the
 * particle's own width, the coverage threshold and the safety cap.
 */
export function streakPixels(speedPixelsPerSecond: number, exposureSeconds: number): number {
  if (!Number.isFinite(speedPixelsPerSecond) || speedPixelsPerSecond <= 0) return 0;
  if (!Number.isFinite(exposureSeconds) || exposureSeconds <= 0) return 0;
  return speedPixelsPerSecond * exposureSeconds;
}

/** The quality cap: a bounded work budget, not a physical quantity. */
export function clampStreakPixels(pixels: number, maxPixels: number): number {
  if (!Number.isFinite(pixels) || pixels <= 0) return 0;
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) return 0;
  return Math.min(pixels, maxPixels);
}
