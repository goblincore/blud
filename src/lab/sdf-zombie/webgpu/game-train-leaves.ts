// src/lab/sdf-zombie/webgpu/game-train-leaves.ts
//
// THE TRAIN in the game (carriage kit spec §5, §6): window glass becomes the scrolling
// night scenery (TRAIN_WINDOW, hand-written WGSL), swaying kit pieces (lamps, curtains)
// swing on the train's rhythm, and the camera rolls and bobs. Decisions are pure
// (train-motion.ts, train-window.ts). A level whose art has neither `window:` glass nor
// `sway` pieces gets null and nothing changes.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, positionWorld, uniform, vec3, vec4, wgslFn } from 'three/tsl';
import type { GameContext } from './game-context';
import { SKY_PRESETS } from './outdoor-presets';
import { SKY_COLOR } from './sky.wgsl';
import { cameraSway, curtainSway, lampSwing } from './train-motion';
import { STORM_HASH, STORM_NOISE, TRAIN_STORM, TRAIN_WINDOW } from './train-window.wgsl';
import { WINDOW_PRESETS } from './train-window';

const DEG = Math.PI / 180;
/** A curtain's swing at full sway (curtainSway = 1). */
const CURTAIN_DEG = 3;
const Z = new THREE.Vector3(0, 0, 1);

interface Sway {
  mesh: THREE.InstancedMesh;
  kind: 'lamp' | 'curtain';
  base: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[];
}

export interface TrainRuntime {
  speed: number;
  time: { value: number };
  /** Metres the scenery has scrolled (the window shader's clock). */
  travelled: { value: number };
  windows: THREE.Mesh[];
  sway: Sway[];
  /** This frame's camera roll (radians) and bob (metres); the gate reads them. */
  roll: number;
  bob: number;
  /** The storm outside (dynamic light spec §3): the flash (0..1) and the live bolt
   *  (side ±1 or 0, along-track z, seed, age), written by the dynamic-light leaf. */
  storm: { flash: { value: number }; bolt: { value: THREE.Vector4 } } | null;
}

/** Set the window glass and collect the swaying pieces; null when the art has neither. */
export function createTrain(ctx: GameContext): TrainRuntime | null {
  const objects = (ctx.world.art?.objects ?? []) as THREE.Mesh[];
  const windows = objects.filter(m => {
    const mat = m.material as THREE.Material;
    return !Array.isArray(m.material) && typeof mat.name === 'string' && mat.name.startsWith('window:');
  });
  const sway: Sway[] = [];
  for (const m of objects) {
    const kind = m.userData.sway;
    if ((kind !== 'lamp' && kind !== 'curtain') || !(m as THREE.InstancedMesh).isInstancedMesh) continue;
    const im = m as THREE.InstancedMesh, mat4 = new THREE.Matrix4(), base: Sway['base'] = [];
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, mat4);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      mat4.decompose(p, q, s);
      base.push({ p, q, s });
    }
    sway.push({ mesh: im, kind, base });
  }
  if (windows.length === 0 && sway.length === 0) return null;

  const time = uniform(0), travelled = uniform(0);
  // The storm (owner, 2026-09-26): every train window looks out on it; ?window=night for the calm view.
  const storm = windows.length > 0 && new URLSearchParams(location.search).get('window') !== 'night';
  const flash = uniform(0), bolt = uniform(new THREE.Vector4());
  const preset = WINDOW_PRESETS.night, sky = SKY_PRESETS.night;
  // wgslFn's result proxies its FunctionNode, so it works as an include as is (the types
  // only accept the node).
  const skyFn = wgslFn(SKY_COLOR) as unknown as NonNullable<Parameters<typeof wgslFn>[1]>[number];
  const windowFn = wgslFn(TRAIN_WINDOW, [skyFn]);
  type Include = NonNullable<Parameters<typeof wgslFn>[1]>[number];
  const hashFn = wgslFn(STORM_HASH) as unknown as Include;
  const noiseFn = wgslFn(STORM_NOISE, [hashFn]) as unknown as Include;
  const stormFn = wgslFn(TRAIN_STORM, [hashFn, noiseFn]);
  const node = storm ? stormFn({
    wpos: positionWorld, eye: cameraPosition, t: travelled, time,
    cfg0: vec4(1, preset.poleDist, preset.polePitch, preset.poleHeight),
    cfg1: vec4(preset.postDist, preset.postPitch, preset.postHeight, preset.treeDist),
    cfg2: vec4(preset.treeHeight, preset.hillDist, preset.hillHeight, 0),
    flash, bolt,
  }) as unknown as ReturnType<typeof vec3> : windowFn({
    // `t` is the distance travelled (metres) with speed 1: the CPU integrates speed, so a
    // speed change never makes the scenery jump.
    wpos: positionWorld, eye: cameraPosition, t: travelled,
    cfg0: vec4(1, preset.poleDist, preset.polePitch, preset.poleHeight),
    cfg1: vec4(preset.postDist, preset.postPitch, preset.postHeight, preset.treeDist),
    cfg2: vec4(preset.treeHeight, preset.hillDist, preset.hillHeight, 0),
    zenith: vec3(...sky.zenith), horizon: vec3(...sky.horizon), band: vec3(...sky.band),
    moonDir: vec3(...sky.moon.dir), moonColor: vec3(...sky.moon.color),
    moonCfg: vec4(Math.cos(sky.moon.discDeg * DEG), Math.cos(sky.moon.discDeg * 0.85 * DEG), sky.moon.intensity,
      1 / Math.max(1e-4, 1 - Math.cos(sky.moon.haloDeg * DEG))),
  }) as unknown as ReturnType<typeof vec3>;
  const glass = new MeshBasicNodeMaterial();
  glass.colorNode = vec4(node, 1);
  glass.fog = false;
  glass.name = 'train.window-scenery';
  for (const w of windows) {
    w.material = glass;
    // Unlit: the per-room light-list pass must not convert it back to a lit material.
    w.userData.skipLevelLights = true;
    // Glass lets the storm in: no shadow (userData too, or the boot's shadow pass turns it back on).
    w.userData.shadow = false;
    w.castShadow = false;
  }
  return {
    speed: preset.speed, time: time as unknown as { value: number }, travelled: travelled as unknown as { value: number },
    windows, sway, roll: 0, bob: 0,
    storm: storm ? { flash: flash as unknown as { value: number }, bolt: bolt as unknown as { value: THREE.Vector4 } } : null,
  };
}

const qz = new THREE.Quaternion(), qm = new THREE.Quaternion(), m4 = new THREE.Matrix4();

/** Per sim step: advance the scenery clock, swing lamps and curtains, compute the camera sway. */
export function stepTrain(ctx: GameContext, dt: number): void {
  const rt = ctx.world.train;
  if (!rt) return;
  rt.time.value += dt;
  rt.travelled.value += rt.speed * dt;
  const t = rt.time.value;
  const s = cameraSway(t, rt.speed);
  rt.roll = s.roll;
  rt.bob = s.bob;
  for (const sw of rt.sway) {
    for (let i = 0; i < sw.base.length; i++) {
      const b = sw.base[i]!;
      const angle = sw.kind === 'lamp' ? lampSwing(t, rt.speed, i * 0.7) : curtainSway(t, rt.speed, i * 0.9) * CURTAIN_DEG * DEG;
      qz.setFromAxisAngle(Z, angle);
      qm.multiplyQuaternions(qz, b.q);
      sw.mesh.setMatrixAt(i, m4.compose(b.p, qm, b.s));
    }
    sw.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** After the camera looks along the player's view: add the bob and roll (never the player). */
export function applyTrainCamera(ctx: GameContext, camera: THREE.Camera): void {
  const rt = ctx.world.train;
  if (!rt) return;
  camera.position.y += rt.bob;
  camera.rotateZ(rt.roll);
}

/** Seams: `__sdfGame.train()` and `setTrainSpeed(mps)`. */
export function createTrainSeams(ctx: GameContext) {
  return {
    train: () => {
      const rt = ctx.world.train;
      return rt ? { speed: rt.speed, time: rt.time.value, windows: rt.windows.length, swaying: rt.sway.length, roll: rt.roll, bob: rt.bob } : null;
    },
    setTrainSpeed: (mps: number) => {
      const rt = ctx.world.train;
      if (!rt) return null;
      rt.speed = Math.max(0, mps);
      return rt.speed;
    },
  };
}
