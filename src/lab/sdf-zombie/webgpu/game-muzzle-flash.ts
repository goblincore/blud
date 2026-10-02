// src/lab/sdf-zombie/webgpu/game-muzzle-flash.ts
//
// The shotgun's per-barrel flame jets (timing and motion: muzzle-flash.ts).
// Built once, never added or removed at runtime, driven by ctx.weapon.flashAge.
//
// WHY THE JETS ARE PLACED EVERY FRAME. The old flash sat at a fixed point on the
// rig. With the heavy recoil the muzzles swing ~15 cm up through the kick and
// the flame has to stay at the bore ends, so each jet reads its muzzle node's
// live world position (and the breech behind it, for the bore direction) after
// the view-model pose and matrices have been composed for the frame.
//
// State lives in a WeakMap keyed by the flash group, not on the weapon slice:
// it is pure presentation and nothing outside this file reads it.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { flamePixels, smokePixels } from './flash-sprite';
import { flashEnvelope } from './game-viewmodel';
import {
  MUZZLE_FLASH, bloomAlpha, bloomScale, coreAlpha, coreScale, jetFlameSides, sparkAlpha, sparkOffset,
  tongueAlpha, tongueLength, tongueWidth,
} from './muzzle-flash';
import { rngStreams } from './rng';

const FLAME_VARIANTS = 3;
/** The point light's peak at the shot. It was 55 for the single-star flash. */
const FLASH_LIGHT_PEAK = 95;

interface Jet {
  on: boolean;
  core: THREE.Mesh;
  bloom: THREE.Mesh;
  tongueRoot: THREE.Group;
  tongues: THREE.Mesh[];
  sparks: THREE.Mesh[];
  coreMat: THREE.MeshBasicMaterial;
  bloomMat: THREE.MeshBasicMaterial;
  tongueMat: THREE.MeshBasicMaterial;
  sparkMat: THREE.MeshBasicMaterial;
  /** Per spark: sideways spread added to the bore direction, and its speed. */
  spread: THREE.Vector3[];
  speed: number[];
}
interface FlashRig { jets: [Jet, Jet]; flame: THREE.DataTexture[]; shot: number }

const rigs = new WeakMap<THREE.Group, FlashRig>();

const additive = (map: THREE.Texture, color: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  map, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, depthTest: false, side: THREE.DoubleSide,
});

function tex(pixels: Uint8Array, size: number): THREE.DataTexture {
  const t = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

/** A unit plane lying along the bore: base at the origin, tip at -Z (forward),
 *  width along X, uv.v running base -> tip. */
function tongueGeometry(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.5);
  return g;
}

function overlay(m: THREE.Mesh): THREE.Mesh {
  m.renderOrder = 999;
  m.frustumCulled = false;
  return m;
}

/** Build the flash group (both jets) and return it. The caller stores it as
 *  ctx.weapon.flashGroup and adds it to the gun rig. `starTextures` are the
 *  existing ragged-star sprites the core reuses. */
export function buildMuzzleFlash(starTextures: THREE.Texture[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'muzzle-flash';
  group.visible = false;
  group.renderOrder = 999;
  const flame = Array.from({ length: FLAME_VARIANTS }, (_, i) => tex(flamePixels(64, 7 + i * 29), 64));
  const soft = tex(smokePixels(64), 64);
  const quad = new THREE.PlaneGeometry(1, 1);
  const tongueGeo = tongueGeometry();
  const sparkGeo = new THREE.PlaneGeometry(0.011, 0.06);

  const makeJet = (): Jet => {
    const coreMat = additive(starTextures[0]!, 0xfff0c8);
    const bloomMat = additive(soft, 0xff7a1c);
    const tongueMat = additive(flame[0]!, 0xffffff);
    const sparkMat = additive(flame[1]!, 0xffcf70);
    const core = overlay(new THREE.Mesh(quad, coreMat));
    const bloom = overlay(new THREE.Mesh(quad, bloomMat));
    const tongueRoot = new THREE.Group();
    const tongues = [0, Math.PI / 2].map((roll) => {
      const m = overlay(new THREE.Mesh(tongueGeo, tongueMat));
      m.rotation.z = roll;
      tongueRoot.add(m);
      return m;
    });
    const sparks = Array.from({ length: MUZZLE_FLASH.sparkCount }, () => overlay(new THREE.Mesh(sparkGeo, sparkMat)));
    for (const m of [core, bloom, tongueRoot, ...sparks]) { m.visible = false; group.add(m); }
    return {
      on: false, core, bloom, tongueRoot, tongues, sparks, coreMat, bloomMat, tongueMat, sparkMat,
      spread: sparks.map(() => new THREE.Vector3()), speed: sparks.map(() => 0),
    };
  };
  rigs.set(group, { jets: [makeJet(), makeJet()], flame, shot: 0 });
  return group;
}

/** The pull of the trigger: choose the barrels that flame and re-roll each
 *  one's look so repeat fire never strobes one silhouette. `starTextures` are
 *  ctx.weapon.flashTextures. Only touches data -- nothing is added to the scene. */
export function triggerMuzzleFlash(ctx: GameContext, barrels: 1 | 2): void {
  const g = ctx.weapon.flashGroup;
  const rig = g ? rigs.get(g) : undefined;
  if (!g || !rig) return;
  const sides = jetFlameSides(barrels, rig.shot++);
  rig.jets.forEach((jet, k) => {
    jet.on = sides[k]!;
    if (!jet.on) return;
    const star = ctx.weapon.flashTextures[Math.floor(rngStreams.fx() * ctx.weapon.flashTextures.length)];
    if (star && jet.coreMat.map !== star) { jet.coreMat.map = star; jet.coreMat.needsUpdate = true; }
    jet.core.rotation.z = rngStreams.fx() * Math.PI * 2;
    jet.bloom.rotation.z = rngStreams.fx() * Math.PI * 2;
    const flameTex = rig.flame[Math.floor(rngStreams.fx() * rig.flame.length)]!;
    if (jet.tongueMat.map !== flameTex) { jet.tongueMat.map = flameTex; jet.tongueMat.needsUpdate = true; }
    jet.tongueRoot.rotation.z = (rngStreams.fx() - 0.5) * 0.8;   // the plume leans a little differently each shot
    for (let i = 0; i < jet.sparks.length; i++) {
      jet.spread[i]!.set(rngStreams.fx() - 0.5, rngStreams.fx() - 0.5, 0).multiplyScalar(0.9);
      jet.speed[i] = MUZZLE_FLASH.sparkSpeedMin + rngStreams.fx() * (MUZZLE_FLASH.sparkSpeedMax - MUZZLE_FLASH.sparkSpeedMin);
    }
  });
}

/** Which barrels flamed on the last trigger pull: [left, right]. The smoke is
 *  released from the same bores. */
export function firedSides(ctx: GameContext): [boolean, boolean] {
  const rig = ctx.weapon.flashGroup ? rigs.get(ctx.weapon.flashGroup) : undefined;
  return rig ? [rig.jets[0].on, rig.jets[1].on] : [true, true];
}

const _p = new THREE.Vector3();
const _b = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const NEG_Z = new THREE.Vector3(0, 0, -1);

/** The light's brightness: call every frame with the flash clock. */
export function stepFlashLight(ctx: GameContext): void {
  if (ctx.weapon.flashLight) ctx.weapon.flashLight.intensity = FLASH_LIGHT_PEAK * flashEnvelope(ctx.weapon.flashAge);
}

/** Pose and fade the jets for this frame. Call AFTER the view-model pose is
 *  composed and its matrices updated, or the flame trails the barrels by a frame. */
export function stepMuzzleFlash(ctx: GameContext): void {
  const g = ctx.weapon.flashGroup;
  const rig = g ? rigs.get(g) : undefined;
  if (!g || !rig) return;
  const t = ctx.weapon.flashAge;
  const live = t >= 0 && t <= Math.max(MUZZLE_FLASH.windowSec, MUZZLE_FLASH.sparkLifeSec);
  g.visible = live;
  if (!live) return;
  const gunRig = ctx.weapon.gunRig;
  rig.jets.forEach((jet, k) => {
    const muzzle = ctx.weapon.muzzleNodes[k];
    if (!jet.on || !muzzle) { for (const m of [jet.core, jet.bloom, jet.tongueRoot, ...jet.sparks]) m.visible = false; return; }
    muzzle.getWorldPosition(_p);
    gunRig.worldToLocal(_p);
    // The bore direction: breech -> muzzle, in the same space. A gun without
    // breech locators fires straight down the view.
    const breech = ctx.weapon.breechNodes[k];
    if (breech) { breech.getWorldPosition(_b); gunRig.worldToLocal(_b); _fwd.copy(_p).sub(_b).normalize(); }
    else _fwd.copy(NEG_Z);

    const cA = coreAlpha(t), bA = bloomAlpha(t), tA = tongueAlpha(t);
    jet.core.visible = cA > 0.004;
    jet.core.position.copy(_p).addScaledVector(_fwd, 0.035);
    jet.core.scale.setScalar(coreScale(t));
    jet.coreMat.opacity = cA;

    jet.bloom.visible = bA > 0.004;
    jet.bloom.position.copy(_p).addScaledVector(_fwd, 0.07);
    jet.bloom.scale.setScalar(bloomScale(t));
    jet.bloomMat.opacity = bA;

    const len = tongueLength(t);
    jet.tongueRoot.visible = tA > 0.004 && len > 0.002;
    jet.tongueRoot.position.copy(_p);
    jet.tongueRoot.quaternion.copy(_q.setFromUnitVectors(NEG_Z, _fwd));
    for (const m of jet.tongues) m.scale.set(tongueWidth(t), 1, len);
    jet.tongueMat.opacity = tA;

    const sA = sparkAlpha(t);
    jet.sparkMat.opacity = sA;
    for (let i = 0; i < jet.sparks.length; i++) {
      const s = jet.sparks[i]!;
      s.visible = sA > 0.004;
      if (!s.visible) continue;
      _dir.copy(_fwd).add(jet.spread[i]!).normalize();
      const d: [number, number, number] = [_dir.x, _dir.y, _dir.z];
      const off = sparkOffset(t, d, jet.speed[i]!);
      s.position.set(_p.x + off[0], _p.y + off[1], _p.z + off[2]);
      // Streak along the motion as the camera sees it (rig +X/+Y are screen
      // right/up): hot head (the sprite's base, -Y) leads.
      const ahead = sparkOffset(t + 0.01, d, jet.speed[i]!);
      s.rotation.z = Math.atan2(ahead[1] - off[1], ahead[0] - off[0]) + Math.PI / 2;
    }
  });
}
