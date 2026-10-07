// src/lab/sdf-zombie/webgpu/game-ambient-rig.ts
//
// applyRig: applies an ambient rig (hemisphere, sun, ambient, fog, clear colour, flashlight visibility) to the scene.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { DUNGEON_RIG, type AmbientRig } from './dungeon-lighting';
import { restampLevelProbes } from './game-bone-cull';
import { applyHemi } from './game-level-lights';


export function applyRig(ctx: GameContext, rig: AmbientRig) {
  ctx.lighting.hemiBase = rig.hemiIntensity;
  applyHemi(ctx);
  ctx.lighting.hemi.color.setRGB(...rig.hemiSky);
  ctx.lighting.hemi.groundColor.setRGB(...rig.hemiGround);
  restampLevelProbes(ctx);
  for (const child of ctx.boot.handle.scene.children) {
    if (child instanceof THREE.DirectionalLight) child.intensity = rig.sunIntensity;
    if (child instanceof THREE.AmbientLight) {
      child.intensity = rig.ambientIntensity;
      child.color.setRGB(...rig.ambientColor);
    }
  }
  const fog = ctx.boot.handle.scene.fog as THREE.Fog | null;
  if (fog) {
    fog.color.setRGB(...rig.fogColor);
    fog.near = rig.fogNear;
    fog.far = rig.fogFar;
  }
  ctx.boot.handle.renderer.setClearColor(new THREE.Color(...rig.fogColor));
  ctx.lighting.flashlight.spot.visible = rig === DUNGEON_RIG;
  ctx.lighting.flashlight.levelShadow.visible = rig === DUNGEON_RIG;
}
