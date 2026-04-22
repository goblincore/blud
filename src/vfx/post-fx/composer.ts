import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass,
  VignetteEffect, NoiseEffect, ChromaticAberrationEffect, ScanlineEffect,
} from 'postprocessing';
import type { PostFxConfig } from './config';
import type { PostFxBus } from './post-fx-bus';

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
  const ca = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(cfg.ca.baseline, 0),
    radialModulation: false,
    modulationOffset: 0,
  });
  const grain = new NoiseEffect({ premultiply: true });
  grain.blendMode.opacity.value = cfg.grain.amount;
  const scanlines = new ScanlineEffect({ density: 1.25 });

  composer.addPass(new EffectPass(camera, vignette, ca, grain, scanlines));

  return {
    render(_dtSec: number, nowSec: number) {
      const intensity = bus.currentCAIntensity(nowSec);
      ca.offset.x = intensity;
      ca.offset.y = intensity * 0.5;

      vignette.blendMode.opacity.value = cfg.vignette.enabled ? 1 : 0;
      ca.blendMode.opacity.value = cfg.ca.enabled ? 1 : 0;
      grain.blendMode.opacity.value = cfg.grain.enabled ? cfg.grain.amount : 0;
      scanlines.blendMode.opacity.value = cfg.scanlines.enabled ? 0.25 : 0;

      composer.render();
    },
    setSize(w: number, h: number) { composer.setSize(w, h); },
    config: cfg,
  };
}
