// src/lab/sdf-zombie/webgpu/shutter-game-layer.test.ts
//
// Focused tests for the GAME integration of selective shutter blur: the
// owner-accepted defaults (320°/360/20 = 44.44 ms, 120 px, seed scale 1,
// bias 0.020 m), the exposure/streak clamps, the selection partition that
// keeps the blurred layer and the sharp remainder disjoint, the aspect-
// preserving seed grid, the query flags, and source tripwires proving the
// capture-stage seam is actually wired into post-aa and game-main.
//
// The GPU factory is not instantiated here (that is the WebGPU smoke's job).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import type { Droplet } from '../blood-sim';
import {
  SHUTTER_GAME_ANGLE_DEG, SHUTTER_GAME_REFERENCE_FPS,
  SHUTTER_GAME_DEFAULT_EXPOSURE_SECONDS, SHUTTER_GAME_DEFAULT_MAX_STREAK_PX,
  SHUTTER_GAME_MAX_STREAK_PX, SHUTTER_GAME_MAX_EXPOSURE_SECONDS,
  SHUTTER_GAME_DEFAULT_SEED_SCALE, SHUTTER_GAME_DEFAULT_DEPTH_BIAS_M,
  SHUTTER_GAME_PRESETS, SHUTTER_GAME_DEFAULTS,
  SHUTTER_SHARP_SELECTION, SHUTTER_SELECTED_SELECTION,
  isSelectedGooDroplet, shutterSeedDims, readShutterGameSettings,
  resolveExposureMs, resolveMaxStreakPx, resolveSeedScale, resolveDepthBiasM,
  secondsToShutterMs, shutterExposureLabel,
} from './shutter-game-layer';
import { seedDimsForOutput, SHUTTER_CANDIDATE_TAPS } from './shutter-blur';

function droplet(over: Partial<Droplet> = {}): Droplet {
  return {
    pos: [0, 0, -5], vel: [1, 0, 0], age: 1, life: 10, size: 0.22, kind: 'drop',
    ...over,
  } as Droplet;
}

describe('shutter game — owner-accepted defaults', () => {
  it('is 320 degrees at a reference 20 fps, not the measured frame rate', () => {
    expect(SHUTTER_GAME_ANGLE_DEG).toBe(320);
    expect(SHUTTER_GAME_REFERENCE_FPS).toBe(20);
    expect(SHUTTER_GAME_DEFAULT_EXPOSURE_SECONDS).toBeCloseTo(320 / 360 / 20, 12);
    expect(secondsToShutterMs(SHUTTER_GAME_DEFAULT_EXPOSURE_SECONDS)).toBeCloseTo(44.444444, 4);
  });

  it('ships ON at the accepted exposure / streak / seed / bias', () => {
    expect(SHUTTER_GAME_DEFAULTS.enabled).toBe(true);
    expect(SHUTTER_GAME_DEFAULTS.exposureSeconds).toBeCloseTo(44.444444e-3, 8);
    expect(SHUTTER_GAME_DEFAULTS.maxStreakPx).toBe(SHUTTER_GAME_DEFAULT_MAX_STREAK_PX);
    expect(SHUTTER_GAME_DEFAULTS.maxStreakPx).toBe(120);
    expect(SHUTTER_GAME_DEFAULTS.seedScale).toBe(SHUTTER_GAME_DEFAULT_SEED_SCALE);
    expect(SHUTTER_GAME_DEFAULTS.depthBiasM).toBe(SHUTTER_GAME_DEFAULT_DEPTH_BIAS_M);
    expect(SHUTTER_GAME_DEFAULT_DEPTH_BIAS_M).toBe(0.02);
    expect(SHUTTER_CANDIDATE_TAPS).toBe(24);
  });

  it('offers stronger presets inside the finite exposure cap', () => {
    const ids = SHUTTER_GAME_PRESETS.map(p => p.id);
    expect(ids).toContain('off');
    expect(ids).toContain('66.67');
    expect(ids).toContain('100');
    expect(ids).toContain('default');
    for (const p of SHUTTER_GAME_PRESETS) {
      expect(p.seconds).toBeGreaterThanOrEqual(0);
      expect(p.seconds).toBeLessThanOrEqual(SHUTTER_GAME_MAX_EXPOSURE_SECONDS);
    }
    const def = SHUTTER_GAME_PRESETS.find(p => p.id === 'default')!;
    expect(def.seconds).toBeCloseTo(SHUTTER_GAME_DEFAULT_EXPOSURE_SECONDS, 12);
  });
});

describe('shutter game — clamps and labels', () => {
  it('clamps exposure ms into [0, 200] and defaults invalid input', () => {
    expect(resolveExposureMs(44.444444)).toBeCloseTo(44.444444, 6);
    expect(resolveExposureMs(-5)).toBe(0);
    expect(resolveExposureMs(1e6)).toBe(SHUTTER_GAME_MAX_EXPOSURE_SECONDS * 1000);
    expect(resolveExposureMs(NaN)).toBeCloseTo(44.444444, 4);
    expect(resolveExposureMs(null)).toBeCloseTo(44.444444, 4);
  });

  it('clamps max streak into [1, 400] and defaults invalid input', () => {
    expect(resolveMaxStreakPx(120)).toBe(120);
    expect(resolveMaxStreakPx(0)).toBe(1);
    expect(resolveMaxStreakPx(9999)).toBe(SHUTTER_GAME_MAX_STREAK_PX);
    expect(resolveMaxStreakPx(undefined)).toBe(SHUTTER_GAME_DEFAULT_MAX_STREAK_PX);
  });

  it('clamps the debug seams', () => {
    expect(resolveSeedScale(1)).toBe(1);
    expect(resolveSeedScale(0)).toBe(0.25);
    expect(resolveSeedScale(9)).toBe(2);
    expect(resolveDepthBiasM(0.02)).toBe(0.02);
    expect(resolveDepthBiasM(-1)).toBe(0);
    expect(resolveDepthBiasM(9999)).toBe(50);
  });

  it('shows the effective milliseconds, never only the angle wording', () => {
    expect(shutterExposureLabel(0)).toBe('off');
    expect(shutterExposureLabel(44.444444e-3)).toBe('44.44 ms');
    expect(shutterExposureLabel(0.1)).toBe('100.00 ms');
  });
});

describe('shutter game — selection partition', () => {
  it('selects airborne drops above the mist cutoff and all scraps', () => {
    expect(isSelectedGooDroplet(droplet({ kind: 'drop', size: 0.22 }))).toBe(true);
    expect(isSelectedGooDroplet(droplet({ kind: 'scrap', size: 0.001 }))).toBe(true);
  });

  it('rejects mist, gut nodes and sub-cutoff drops (they stay sharp)', () => {
    expect(isSelectedGooDroplet(droplet({ kind: 'mist', size: 0.2 }))).toBe(false);
    expect(isSelectedGooDroplet(droplet({ kind: 'gut', size: 0.2 }))).toBe(false);
    expect(isSelectedGooDroplet(droplet({ kind: 'drop', size: 0.01 }))).toBe(false);
  });

  it('sharp + selected partitions are disjoint and complete', () => {
    const drops = [
      droplet({ kind: 'drop', size: 0.22 }),
      droplet({ kind: 'drop', size: 0.01 }),
      droplet({ kind: 'scrap', size: 0.001 }),
      droplet({ kind: 'mist', size: 0.2 }),
      droplet({ kind: 'gut', size: 0.2 }),
    ];
    for (const d of drops) {
      const sharp = SHUTTER_SHARP_SELECTION.droplet(d);
      const sel = SHUTTER_SELECTED_SELECTION.droplet(d);
      expect(sharp).toBe(!sel);
    }
    // Pools/guts ride the sharp half; connections ride the selected half.
    expect(SHUTTER_SHARP_SELECTION.splats).toBe(true);
    expect(SHUTTER_SHARP_SELECTION.extras).toBe(false);
    expect(SHUTTER_SELECTED_SELECTION.splats).toBe(false);
    expect(SHUTTER_SELECTED_SELECTION.extras).toBe(true);
  });
});

describe('shutter game — seed grid follows the density dimensions', () => {
  it('reproduces the accepted 200x150 at that density and scale 1', () => {
    expect(shutterSeedDims(200, 150, 1)).toEqual({ width: 200, height: 150 });
  });

  it('preserves aspect when the density grid exceeds the 512 cap', () => {
    const d = shutterSeedDims(960, 540, 1);
    expect(d.width).toBe(512);
    expect(d.height).toBe(288);
    expect(d.width / d.height).toBeCloseTo(960 / 540, 2);
    // The old independent clamp would have produced a square 512x512.
    expect(seedDimsForOutput(960, 540, 1)).toEqual({ width: 512, height: 288 });
  });

  it('honours the debug seed scale', () => {
    expect(shutterSeedDims(400, 300, 0.5)).toEqual({ width: 200, height: 150 });
  });
});

describe('shutter game — query flags', () => {
  it('defaults to ON at the accepted settings with no query', () => {
    const s = readShutterGameSettings('');
    expect(s.enabled).toBe(true);
    expect(secondsToShutterMs(s.exposureSeconds)).toBeCloseTo(44.444444, 4);
    expect(s.maxStreakPx).toBe(120);
    expect(s.seedScale).toBe(1);
    expect(s.depthBiasM).toBe(0.02);
  });

  it('reversible off / on', () => {
    expect(readShutterGameSettings('?bloodblur=0').enabled).toBe(false);
    expect(readShutterGameSettings('?bloodblur=off').enabled).toBe(false);
    expect(readShutterGameSettings('?bloodblur=1').enabled).toBe(true);
    expect(readShutterGameSettings('?bloodblur=on').enabled).toBe(true);
  });

  it('reads and clamps the exposure / streak / debug flags', () => {
    const s = readShutterGameSettings('?blurms=100&blurmax=200&blurseed=0.5&blurbias=0.05');
    expect(secondsToShutterMs(s.exposureSeconds)).toBeCloseTo(100, 6);
    expect(s.maxStreakPx).toBe(200);
    expect(s.seedScale).toBe(0.5);
    expect(s.depthBiasM).toBe(0.05);
    const clamped = readShutterGameSettings('?blurms=99999&blurmax=99999&blurseed=99&blurbias=-3');
    expect(secondsToShutterMs(clamped.exposureSeconds)).toBe(200);
    expect(clamped.maxStreakPx).toBe(SHUTTER_GAME_MAX_STREAK_PX);
    expect(clamped.seedScale).toBe(2);
    expect(clamped.depthBiasM).toBe(0);
  });

  it('ignores a non-numeric flag rather than silently zeroing it', () => {
    const s = readShutterGameSettings('?blurms=abc');
    expect(secondsToShutterMs(s.exposureSeconds)).toBeCloseTo(44.444444, 4);
  });
});

describe('shutter game — integration tripwires', () => {
  const layerSrc = readFileSync('src/lab/sdf-zombie/webgpu/shutter-game-layer.ts', 'utf8');
  const gameSrc = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');
  const postSrc = readFileSync('src/lab/sdf-zombie/webgpu/post-aa.ts', 'utf8');
  const gooSrc = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');

  it('the capture stage reads the capture and writes its own target (no feedback)', () => {
    expect(layerSrc).toContain('createShutterResolve');
    expect(layerSrc).toContain('resolve.render(renderer, stageTarget)');
    expect(layerSrc).toContain('sceneTex: capture.texture');
    expect(layerSrc).toContain('depthTex: capture.depthTexture!');
    expect(layerSrc).not.toContain('renderer.render(scene, camera)');
  });

  it('clamps exposure against particle age (no pre-birth streaks)', () => {
    expect(layerSrc).toContain('clampToAge: true');
  });

  it('post-aa runs the stage after the chain and before FXAA/VHS', () => {
    expect(postSrc).toContain('captureStage(sceneTarget)');
    expect(postSrc).toContain('captureStage !== null');
    expect(postSrc).toContain('setCaptureStage');
    const chainIdx = postSrc.indexOf('chain();');
    const stageIdx = postSrc.indexOf('captureStage(sceneTarget)');
    const fxaaIdx = postSrc.indexOf("setPassLabel('post:fxaa')");
    expect(chainIdx).toBeGreaterThan(-1);
    expect(stageIdx).toBeGreaterThan(chainIdx);
    expect(fxaaIdx).toBeGreaterThan(stageIdx);
  });

  it('goo-layer exposes the partition seam and both sync paths honour it', () => {
    expect(gooSrc).toContain('setSelection(sel');
    // Two droplet loops (area priority + insertion order) must both filter.
    const filters = gooSrc.match(/if \(selection && !selection\.droplet\(d\)\) continue;/g) ?? [];
    expect(filters.length).toBe(2);
  });

  it('game-main poses the sharp half, installs the stage and exposes live setters', () => {
    expect(gameSrc).toContain('shutterGame?.poseSharp()');
    expect(gameSrc).toContain('postAa.setCaptureStage');
    expect(gameSrc).toContain('readShutterGameSettings(location.search)');
    expect(gameSrc).toContain('setBloodBlurExposure');
    expect(gameSrc).toContain('setBloodBlurMaxStreak');
    expect(gameSrc).toContain('setBloodBlurSeedScale');
    expect(gameSrc).toContain('setBloodBlurDepthBias');
    // The pose must precede the sync it partitions.
    const poseIdx = gameSrc.indexOf('shutterGame?.poseSharp()');
    const syncIdx = gameSrc.indexOf('gooLayer?.sync(bloodSim, camera)', poseIdx);
    expect(syncIdx).toBeGreaterThan(poseIdx);
  });
});
