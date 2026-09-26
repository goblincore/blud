// src/lab/sdf-zombie/webgpu/gib-shutter-layer.test.ts
//
// Focused tests for the flying-gib shutter integration: the separate gib
// switch, the SHARED exposure/streak contract, the layer-isolation seam and
// source tripwires proving the game wires the gib pass before the blood pass
// with the selected pieces removed from the base scene first.
//
// The GPU factory is not instantiated here (that is the WebGPU smoke's job).

// NOTE (2026-09-17, game-main decomposition): the receivers pinned below moved
// from main()-scope locals onto the GameContext (`gooLayer` -> `ctx.goo.layer`,
// `gibShutter` -> `ctx.gibs.shutter`, ...). Only the SPELLING changed — every
// pinned number and method name is untouched, so this drift gate still gates
// exactly what it did before. See docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createGibShutterLayer, readGibShutterSettings } from './gib-shutter-layer';
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
  // The large __sdfGame members moved to game-seams-spawn-goo.ts in the
  // 2026-09-17 decomposition; every pinned string below is byte-identical.
  const seamSrc = readFileSync('src/lab/sdf-zombie/webgpu/game-seams-spawn-goo.ts', 'utf8');
  // setGibBlur and its exposure/streak setters moved to game-seams-leftover.ts
  // in leaves wave 1 (2026-09-19), then on to game-seams-fx.ts in the
  // 2026-09-20 leftover split.
  const fxSrc = readFileSync('src/lab/sdf-zombie/webgpu/game-seams-fx.ts', 'utf8');
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

  it('mutual occlusion: the blood pass can drop behind a blurred gib', () => {
    // The gib layer owns a SAMPLEABLE depth so the blood resolve (which runs
    // second) can test against the lifted pieces that are absent from the clean
    // capture's depth. Default OFF, so the lab / gib-off frames are unchanged.
    expect(layerSrc).toContain('layerTarget.depthTexture = new THREE.DepthTexture');
    expect(layerSrc).toContain('get occluderDepth()');
    expect(resolveSrc).toContain('occluderTex: texture_depth_2d');
    expect(resolveSrc).toContain('setOccluderDepth(tex: THREE.DepthTexture | null)');
    expect(resolveSrc).toContain('occlusionClipZ');
    expect(resolveSrc).toContain('uCfg2.value.set(tex ? 1 : 0, 0)');
    expect(gameSrc).toContain('gibDepth = ctx.gibs.shutter.occluderDepth');
    // Runtime A/B control for the evidence: the shipped default is ON.
    expect(gameSrc).toContain('ctx.panels.shutterGame.setOccluderDepth(ctx.gibs.occluderEnabled ? gibDepth : null)');
    // setGibOccluder moved into game-seams-fx.ts with the gibs seam group.
    expect(readFileSync('src/lab/sdf-zombie/webgpu/game-seams-fx.ts', 'utf8'))
      .toContain('setGibOccluder:');
    expect(gameSrc).toContain("get('giboccluder') !== '0'");
  });

  it('game-main lifts pieces before the base draw, then chains gib -> blood', () => {
    const selectIdx = gameSrc.indexOf('ctx.gibs.shutter.select(');
    const renderCbIdx = gameSrc.indexOf('handle.setRenderCallback');
    expect(selectIdx).toBeGreaterThan(-1);
    expect(renderCbIdx).toBeGreaterThan(selectIdx);

    const gibCaptureIdx = gameSrc.indexOf('ctx.gibs.shutter.capture(capture, scene, camera)');
    const setSceneIdx = gameSrc.indexOf('ctx.panels.shutterGame.setSceneTexture(src.texture)');
    const bloodCaptureIdx = gameSrc.indexOf('ctx.panels.shutterGame.capture(capture, ctx.vfx.bloodSim, camera)');
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
    expect(fxSrc).toContain('setGibBlur');
    expect(fxSrc).toContain('ctx.gibs.shutter?.setExposureMs(applied)');
    expect(fxSrc).toContain('ctx.gibs.shutter?.setMaxStreakPx(applied)');
    expect(gameSrc).toContain('shutterPanelHost(ctx.panels.shutterGame, ctx.gibs.shutter)');
  });

  it('prewarms the gib targets against the real capture at boot', () => {
    expect(layerSrc).toContain('prewarm(capture: THREE.RenderTarget): boolean');
    expect(gameSrc).toContain('ctx.gibs.shutter.prewarm(ctx.render.postAa.captureTarget)');
  });

  it('explicitly excludes the deferred route rather than excluding-but-undrawn', () => {
    // The deferred G-buffer route is not validated for the isolated gib draw;
    // the switch is hard-off there so gibs render sharp through their own route
    // instead of vanishing. Reported, not silent. The gate lives in the layer
    // (`supported`) so the API/panel cannot re-enable it either.
    expect(gameSrc).toContain('const gibRouteSupported = !ctx.boot.deferredMode');
    expect(gameSrc).toContain('supported: gibRouteSupported');
    expect(gameSrc).toContain('deferred route: gib motion blur stays off');
    expect(layerSrc).toContain('supported = opts.supported !== false');
    expect(layerSrc).toContain('enabled = supported && !!on');
  });

  it('bounds the per-frame work', () => {
    expect(GIB_BLUR_MAX_PIECES).toBeGreaterThan(0);
    expect(layerSrc).toContain('selectedStates.size >= GIB_BLUR_MAX_PIECES');
    expect(GIB_BLUR_LAYER).toBe(10);
  });

  it('exposes a deterministic pure-spin fixture for rotation evidence', () => {
    // Task 4 needs a fixed-centre piece whose ONLY motion is rotation: the
    // upward kick cancels one frame of gravity, so after `step(1)` the piece
    // has ~zero linear velocity while still turning. Without this the rotation
    // claim could only be tested on the random blast.
    // spawnSpinFixture moved into game-seams-spawn-goo.ts with the rest of the
    // large __sdfGame members (2026-09-17 decomposition); the seam itself is
    // unchanged.
    expect(seamSrc).toContain('spawnSpinFixture:');
    expect(seamSrc).toContain('spinAngVel: spin');
    expect(seamSrc).toContain('CHUNK_TUNING.gravity / 60');
    // The generic fixture seam also returns a stable id and accepts a velocity
    // so a rig can stage a slow slide and track it across the settle.
    expect(seamSrc).toContain('spawnTestChunk: (x: number, y: number, z: number, radius = 0.12, stationary = false, velocity?: Vec3, spin?: Vec3)');
    expect(seamSrc).toContain('velocity ?? (stationary ? [0, 0, 0] : undefined)');
  });
});

describe('gib shutter — background subject precompile', () => {
  it('compiles the subject through a camera clone and restores state before yielding', async () => {
    // Defer-compile task (2026-09-19): the subject compile now runs while the
    // live loop draws, so it must not leave the SHARED camera on GIB_BLUR_LAYER
    // (or hold the layer target) across the await. Same contract as
    // SdfLayer.precompileInBackground.
    const previousTarget = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType });
    let currentTarget: THREE.RenderTarget | null = previousTarget;
    let resolveSubject!: () => void;
    const calls: { cam: THREE.Camera; target: THREE.RenderTarget | null }[] = [];
    const compileAsync = vi.fn((_scene: unknown, cam: THREE.Camera) => {
      calls.push({ cam, target: currentTarget });
      return new Promise<void>((r) => { resolveSubject = r; });
    });
    const renderer = {
      getRenderTarget: () => currentTarget,
      setRenderTarget: (t: THREE.RenderTarget | null) => { currentTarget = t; },
      compileAsync,
    } as unknown as THREE.WebGPURenderer;
    const layer = createGibShutterLayer({ renderer, settings: readGibShutterSettings('') });
    const capture = new THREE.RenderTarget(8, 8, { type: THREE.HalfFloatType });
    capture.depthTexture = new THREE.DepthTexture(8, 8);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.set(3);
    const liveMask = camera.layers.mask;
    const object = new THREE.Object3D();

    const p = layer.precompileSubjectInBackground(object, capture, new THREE.Scene(), camera, 5000);

    // The subject compile is the SECOND compileAsync (the first is the resolve
    // warm-up inside ensureTargets); it must use a clone on GIB_BLUR_LAYER.
    const subject = calls[calls.length - 1]!;
    expect(subject.cam).not.toBe(camera);
    expect(subject.cam.layers.mask).toBe(1 << GIB_BLUR_LAYER);
    expect(camera.layers.mask).toBe(liveMask);
    // The layer target is already restored before the compile resolves.
    expect(currentTarget).toBe(previousTarget);

    resolveSubject();
    await expect(p).resolves.toBe(true);
    expect(camera.layers.mask).toBe(liveMask);
    expect(currentTarget).toBe(previousTarget);
    expect(object.layers.mask).toBe(1);

    layer.dispose();
    previousTarget.dispose();
  });
});
