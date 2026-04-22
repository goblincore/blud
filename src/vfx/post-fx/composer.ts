import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  VignetteEffect, NoiseEffect, ChromaticAberrationEffect, ScanlineEffect,
} from 'postprocessing';
import type { PostFxConfig } from './config';
import type { PostFxBus } from './post-fx-bus';
import { PaletteDitherEffect } from './palette-dither-pass';
import { BarrelEffect } from './barrel-pass';

export interface PostFxComposer {
  render(dtSec: number, nowSec: number): void;
  setSize(w: number, h: number): void;
  readonly config: PostFxConfig;
}

export function createPostFxComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  bus: PostFxBus,
  cfg: PostFxConfig,
): PostFxComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const vignette = new VignetteEffect({
    offset: cfg.vignette.offset,
    darkness: cfg.vignette.darkness,
  });

  const paletteTex = new THREE.TextureLoader().load('/assets/post-fx/BLOOD.PAL.png');
  paletteTex.magFilter = THREE.NearestFilter;
  paletteTex.minFilter = THREE.NearestFilter;
  paletteTex.generateMipmaps = false;
  const dither = new PaletteDitherEffect(paletteTex, cfg.dither.strength);

  const ca = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(cfg.ca.baseline, 0),
    radialModulation: false,
    modulationOffset: 0,
  });
  const grain = new NoiseEffect({ premultiply: true });
  grain.blendMode.opacity.value = cfg.grain.amount;
  const scanlines = new ScanlineEffect({ density: 2.5 });
  const barrel = new BarrelEffect(cfg.barrel.enabled ? 0.15 : 0);

  // Barrel resamples `inputBuffer` at a warped UV, which discards any
  // per-pixel work done by earlier effects in the SAME EffectPass. To keep
  // it composable with the rest of the stack it must run in its OWN pass,
  // reading the composited output of the main pass as its inputBuffer.
  composer.addPass(new EffectPass(camera, vignette, dither, ca, grain, scanlines));
  composer.addPass(new EffectPass(camera, barrel));

  return {
    render(_dtSec: number, nowSec: number) {
      // Each effect is disabled by zeroing its own primary uniform (matches
      // the barrel pattern, proven to propagate at runtime). blendMode.opacity
      // is also set as a belt-and-suspenders — but some library builds seem
      // not to honor it per-frame, so we don't rely on it alone.
      const intensity = bus.currentCAIntensity(nowSec);
      ca.offset.x = cfg.ca.enabled ? intensity : 0;
      ca.offset.y = cfg.ca.enabled ? intensity * 0.5 : 0;
      ca.blendMode.opacity.value = cfg.ca.enabled ? 1 : 0;

      vignette.darkness = cfg.vignette.enabled ? cfg.vignette.darkness : 0;
      vignette.blendMode.opacity.value = cfg.vignette.enabled ? 1 : 0;

      dither.ditherStrength = cfg.dither.strength;
      dither.bypass = !cfg.dither.enabled;

      grain.blendMode.opacity.value = cfg.grain.enabled ? cfg.grain.amount : 0;
      scanlines.blendMode.opacity.value = cfg.scanlines.enabled ? 0.25 : 0;
      barrel.distortion = cfg.barrel.enabled ? 0.15 : 0;

      composer.render();
    },
    setSize(w: number, h: number) { composer.setSize(w, h); },
    config: cfg,
  };
}
