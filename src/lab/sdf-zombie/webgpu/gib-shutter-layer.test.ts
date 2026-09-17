// src/lab/sdf-zombie/webgpu/gib-shutter-layer.test.ts
//
// Focused tests for the flying-gib shutter integration: the separate gib
// switch, the SHARED exposure/streak contract, the layer-isolation seam and
// source tripwires proving the game wires the gib pass before the blood pass
// with the selected pieces removed from the base scene first.
//
// The GPU factory is not instantiated here (that is the WebGPU smoke's job).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { readGibShutterSettings } from './gib-shutter-layer';
import { SHUTTER_GAME_DEFAULTS, SHUTTER_GAME_MAX_STREAK_PX } from './shutter-game-layer';
import { GIB_BLUR_LAYER, GIB_BLUR_MAX_PIECES, GIB_SHUTTER_DEFAULT_ENABLED } from './gib-motion-blur';

describe('gib shutter — settings share the blood exposure contract', () => {
  it('ships ON by default and disables only via ?gibblur=', () => {
    expect(GIB_SHUTTER_DEFAULT_ENABLED).toBe(true);
    expect(readGibShutterSettings('').enabled).toBe(true);
    expect(readGibShutterSettings('?gibblur=0').enabled).toBe(false);
    expect(readGibShutterSettings('?bloodblur=0').enabled).toBe(true);
  });

  it('inherits the accepted exposure / streak / seed / bias', () => {
    const s = readGibShutterSettings('');
    expect(s.exposureSeconds).toBe(SHUTTER_GAME_DEFAULTS.exposureSeconds);
    expect(s.maxStreakPx).toBe(SHUTTER_GAME_DEFAULTS.maxStreakPx);
    expect(s.seedScale).toBe(SHUTTER_GAME_DEFAULTS.seedScale);
    expect(s.depthBiasM).toBe(SHUTTER_GAME_DEFAULTS.depthBiasM);
    expect(s.maxStreakPx).toBeLessThanOrEqual(SHUTTER_GAME_MAX_STREAK_PX);
  });
});

describe('gib shutter — integration tripwires', () => {
  const layerSrc = readFileSync('src/lab/sdf-zombie/webgpu/gib-shutter-layer.ts', 'utf8');
  const gameSrc = readFileSync('src/lab/sdf-zombie/webgpu/game-main.ts', 'utf8');
  const panelSrc = readFileSync('src/lab/sdf-zombie/webgpu/shutter-panel.ts', 'utf8');
  const resolveSrc = readFileSync('src/lab/sdf-zombie/webgpu/shutter-blur.ts', 'utf8');

  it('isolates selected pieces on a dedicated layer and removes them from base', () => {
    expect(layerSrc).toContain('GIB_BLUR_LAYER');
    expect(layerSrc).toContain('s.mesh.layers.set(GIB_BLUR_LAYER)');
    expect(layerSrc).toContain('camera.layers.set(GIB_BLUR_LAYER)');
    expect(layerSrc).toContain('s.mesh.layers.set(s.baseLayer)');
    // The layer draw is the ONLY scene render, and it is not the full scene.
    expect(layerSrc).toContain('renderer.render(scene, camera)');
    expect(layerSrc).not.toContain('renderer.render(mainScene');
  });

  it('resolves over the CLEAN capture with its own depth, never in place', () => {
    expect(layerSrc).toContain('createShutterResolve');
    expect(layerSrc).toContain('sceneTex: capture.texture');
    expect(layerSrc).toContain('depthTex: capture.depthTexture!');
    expect(layerSrc).toContain('resolve.render(renderer, stageTarget)');
  });

  it('builds rotation-aware per-surface stamps, not a centre vector', () => {
    expect(layerSrc).toContain('planGibMotionStamps');
    expect(layerSrc).toContain('rasterizeSweepSeed');
    expect(layerSrc).toContain('ageSeconds: s.ageSeconds');
  });

  it('the resolve can be repointed at the gib result (blood reads gibs)', () => {
    expect(resolveSrc).toContain('setSceneTexture(tex: THREE.Texture)');
    expect(resolveSrc).toContain('sceneNode.value = tex');
  });

  it('game-main lifts pieces before the base draw, then chains gib -> blood', () => {
    const selectIdx = gameSrc.indexOf('gibShutter.select(');
    const renderCbIdx = gameSrc.indexOf('handle.setRenderCallback');
    expect(selectIdx).toBeGreaterThan(-1);
    expect(renderCbIdx).toBeGreaterThan(selectIdx);

    const gibCaptureIdx = gameSrc.indexOf('gibShutter.capture(capture, scene, camera)');
    const setSceneIdx = gameSrc.indexOf('shutterGame.setSceneTexture(src.texture)');
    const bloodCaptureIdx = gameSrc.indexOf('shutterGame.capture(capture, bloodSim, camera)');
    expect(gibCaptureIdx).toBeGreaterThan(-1);
    expect(setSceneIdx).toBeGreaterThan(gibCaptureIdx);
    expect(bloodCaptureIdx).toBeGreaterThan(setSceneIdx);
  });

  it('exposes a separate gib switch + shared exposure through the panel and API', () => {
    expect(panelSrc).toContain("'Gib motion blur'");
    expect(panelSrc).toContain('setGibEnabled');
    expect(panelSrc).toContain('gib?.setExposureMs(applied)');
    expect(panelSrc).toContain('gib?.setMaxStreakPx(applied)');
    expect(gameSrc).toContain('readGibShutterSettings(location.search)');
    expect(gameSrc).toContain('setGibBlur');
    expect(gameSrc).toContain('gibShutter?.setExposureMs(applied)');
    expect(gameSrc).toContain('gibShutter?.setMaxStreakPx(applied)');
    expect(gameSrc).toContain('shutterPanelHost(shutterGame, gibShutter)');
  });

  it('prewarms the gib targets against the real capture at boot', () => {
    expect(layerSrc).toContain('prewarm(capture: THREE.RenderTarget): boolean');
    expect(gameSrc).toContain('gibShutter.prewarm(postAa.captureTarget)');
  });

  it('explicitly excludes the deferred route rather than excluding-but-undrawn', () => {
    // The deferred G-buffer route is not validated for the isolated gib draw;
    // the switch is hard-off there so gibs render sharp through their own route
    // instead of vanishing. Reported, not silent. The gate lives in the layer
    // (`supported`) so the API/panel cannot re-enable it either.
    expect(gameSrc).toContain('const gibRouteSupported = !deferredMode');
    expect(gameSrc).toContain('supported: gibRouteSupported');
    expect(gameSrc).toContain('deferred route: gib motion blur stays off');
    expect(layerSrc).toContain('supported = opts.supported !== false');
    expect(layerSrc).toContain('enabled = supported && !!on');
  });

  it('bounds the per-frame work', () => {
    expect(GIB_BLUR_MAX_PIECES).toBeGreaterThan(0);
    expect(layerSrc).toContain('selected.length >= GIB_BLUR_MAX_PIECES');
    expect(GIB_BLUR_LAYER).toBe(10);
  });
});
