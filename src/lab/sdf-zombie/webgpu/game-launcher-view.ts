// Opt-in FPV art prototype. Applies pure launcher timing to Blender nodes.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameContext } from './game-context';
import { aimArm } from './game-arms';
import { SHOULDER_L_VIEW, SHOULDER_R_VIEW, BEND_L_VIEW, BEND_R_VIEW } from './game-weapon-rig';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { loopBlocksInput } from './game-loop';
import { flashPixels } from './flash-sprite';
import {
  LAUNCHER, makeLauncherState, fireLauncher, reloadLauncher, stepLauncher,
  launcherBeat, launcherReady, launcherReloadPose, launcherRecoil,
  launcherSmooth, launcherCartridge, launcherSupportHand, type LauncherV3,
} from './game-grenade-launcher';

export interface LauncherView {
  onMouseDown(button: number): boolean;
  consumeEdge(): void;
  tick(dt: number): void;
  updateRig(): void;
  fire(): boolean;
  reload(): boolean;
  debug(): Record<string, unknown>;
}

export async function createLauncherView(ctx: GameContext): Promise<LauncherView> {
  const gltf = await new GLTFLoader().loadAsync('/assets/lab/grenade-launcher.glb');
  const rig = new THREE.Group(); rig.name = 'launcher-rig';
  const gun = new THREE.Group(); gun.name = 'grenade-launcher'; gun.add(gltf.scene);
  rig.add(gun); ctx.weapon.aimRig!.add(rig);
  const need = (name: string): THREE.Object3D => {
    const node = gltf.scene.getObjectByName(name);
    if (!node) throw new Error(`[launcher] grenade-launcher.glb missing ${name}`);
    return node;
  };
  const barrel = need('Barrels'), round = need('Round'), hammer = need('Hammer');
  const lever = need('TopLever'), trigger = need('Trigger');
  const breech = need('Breech'), muzzle = need('Muzzle');
  const fore = need('Fore_Hand'), grip = need('Grip_Hand');
  const roundRestZ = round.position.z;
  const env = ctx.weapon.gunMaterials[0]?.envMap ?? null;
  gltf.scene.traverse(o => {
    const mat = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) { std.envMap = env; std.envMapIntensity = .85; std.needsUpdate = true; }
    }
  });
  if (!ctx.weapon.arms) throw new Error('[launcher] accepted goblin arms unavailable');
  // Clone the accepted articulated arms; share geometry/textures/materials.
  const left = ctx.weapon.arms.left.clone(true), right = ctx.weapon.arms.right.clone(true);
  // arm helper's cached node references must resolve into the clones themselves.
  left.userData = {}; right.userData = {};
  left.name = 'launcher-hand-support'; right.name = 'launcher-hand-grip';
  rig.add(left, right);
  const fresh = round.clone(true), ejected = round.clone(true);
  fresh.name = 'launcher-carried-round'; ejected.name = 'launcher-ejected-case';
  rig.add(fresh, ejected);
  let state = makeLauncherState();
  let pending = false;
  const rest = new THREE.Vector3(0.040, -0.125, -0.31);
  const p = new THREE.Vector3(), b = new THREE.Vector3(), m = new THREE.Vector3();
  const out = new THREE.Vector3(), side = new THREE.Vector3();
  const handFore = new THREE.Vector3(), handGrip = new THREE.Vector3();
  const stage = new THREE.Vector3(), seat = new THREE.Vector3(), stagedRound = new THREE.Vector3();
  const q = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), heldQ = new THREE.Quaternion();
  const shoulder = new THREE.Vector3(), hint = new THREE.Vector3();
  const tuple = (v: THREE.Vector3): LauncherV3 => [v.x, v.y, v.z];
  const locate = (node: THREE.Object3D, target: THREE.Vector3): THREE.Vector3 => rig.worldToLocal(node.getWorldPosition(target));
  const shellTip = (r: THREE.Object3D, spent: boolean) => {
    r.traverse(o => { if (o.name === 'projectile') o.visible = !spent; });
  };
  // Small low-pressure flash, existing ragged sprite; no added lights/shaders.
  const tex = new THREE.DataTexture(flashPixels(64, 79), 64, 64, THREE.RGBAFormat); tex.needsUpdate = true;
  const flashMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffd29b, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(.17, .17), flashMat);
  flash.name = 'launcher-muzzle-flash'; flash.renderOrder = 999; rig.add(flash);
  if (ctx.boot.deferredApi) {
    for (const node of [gun, left, right, fresh, ejected]) ctx.boot.deferredApi.router.register(node, 'mesh', 'level-only');
  }

  function pose(): void {
    const rp = launcherReloadPose(state.reloadAge), rc = launcherRecoil(state.fireAge);
    gun.position.set(rest.x + rp.dx, rest.y + rp.dy + rc.dy, rest.z + rp.dz + rc.dz);
    gun.rotation.set(THREE.MathUtils.degToRad(2 + rp.pitch + rc.pitch), Math.PI + THREE.MathUtils.degToRad(rp.yaw), THREE.MathUtils.degToRad(-4 + rp.roll + rc.roll));
    barrel.rotation.x = rp.hinge * LAUNCHER.openRad;
    lever.rotation.y = -0.48 * (launcherSmooth(0, LAUNCHER.unlockSec, state.reloadAge) - launcherSmooth(LAUNCHER.closeStartSec, LAUNCHER.closeSec, state.reloadAge));
    hammer.rotation.x = state.spent ? .60 * (state.reloadAge === Infinity ? launcherSmooth(0, .035, state.fireAge) : 1 - launcherSmooth(1.45, LAUNCHER.closeSec, state.reloadAge)) : 0;
    trigger.rotation.x = .22 * (1 - launcherSmooth(.08, .20, state.fireAge));
    round.position.z = roundRestZ;
    rig.updateMatrixWorld(true);
    locate(breech, b); locate(muzzle, m);
    out.copy(b).sub(m).normalize();
    side.set(1, 0, 0).applyQuaternion(gun.quaternion).normalize();
    locate(fore, handFore); handFore.addScaledVector(side, .029); handFore.y -= .016;
    locate(grip, handGrip); handGrip.y -= .014;
    stagedRound.copy(b).addScaledVector(out, LAUNCHER.roundLengthM - .045 + LAUNCHER.stageGapM);
    stage.copy(stagedRound).addScaledVector(side, .035); stage.y -= .023;
    seat.copy(b).addScaledVector(out, .015).addScaledVector(side, .035); seat.y -= .023;
    p.fromArray(launcherSupportHand(state.reloadAge, tuple(handFore), tuple(stage), tuple(seat)));
    left.position.copy(p); right.position.copy(handGrip);
    // Shoulders stay in view space while aimRig leans, matching the accepted arms.
    const aim = (arm: THREE.Group, sh: THREE.Vector3, bend: THREE.Vector3) => {
      shoulder.copy(sh); ctx.weapon.viewModelAnchor.localToWorld(shoulder); rig.worldToLocal(shoulder);
      hint.copy(bend).transformDirection(ctx.weapon.viewModelAnchor.matrixWorld);
      hint.transformDirection(new THREE.Matrix4().copy(rig.matrixWorld).invert());
      aimArm(arm, shoulder, hint);
    };
    aim(left, SHOULDER_L_VIEW, BEND_L_VIEW); aim(right, SHOULDER_R_VIEW, BEND_R_VIEW);
    fresh.visible = false; ejected.visible = false;
    shellTip(round, state.spent);
    const c = launcherCartridge(state.reloadAge, state.spent);
    if (state.reloadAge !== Infinity) {
      round.visible = c.seated || c.insert !== null;
      if (state.reloadAge < LAUNCHER.ejectSec) round.position.z = roundRestZ - c.extractM;
      else if (c.insert !== null) round.position.z = roundRestZ - (1 - c.insert) * (LAUNCHER.roundLengthM + LAUNCHER.stageGapM);
      // Fresh round replaces the empty case after the hand-off, never earlier.
      if (state.reloadAge >= LAUNCHER.stageSec) shellTip(round, false);
      round.getWorldQuaternion(q); rig.getWorldQuaternion(parentQ); q.premultiply(parentQ.invert());
      if (c.eject) {
        const length = state.spent ? LAUNCHER.caseLengthM : LAUNCHER.roundLengthM;
        ejected.visible = true; shellTip(ejected, state.spent);
        ejected.position.copy(b).addScaledVector(out, length - .045 + c.eject.out).addScaledVector(side, c.eject.side);
        ejected.position.y += c.eject.up;
        ejected.quaternion.setFromAxisAngle(side, c.eject.spin).multiply(q);
      }
      if (c.carry !== null) {
        fresh.visible = true; shellTip(fresh, false);
        fresh.position.copy(left.position).add(stagedRound).sub(stage);
        heldQ.setFromAxisAngle(side, -.65).multiply(q);
        fresh.quaternion.copy(heldQ).slerp(q, c.carry);
      }
    } else { round.visible = true; }
    flash.position.copy(m).addScaledVector(out, -.022);
    flash.visible = state.fireAge < .075;
    flashMat.opacity = flash.visible ? Math.exp(-48 * state.fireAge) : 0;
    flash.rotation.z = state.shots * 2.399;
  }
  function fire(): boolean {
    if (loopBlocksInput(ctx) || ctx.weapon.slotState.live !== 'launcher' || !slotReady(ctx.weapon.slotState)) return false;
    const next = fireLauncher(state);
    if (next === state) return false;
    state = next;
    ctx.weapon.recoilPitch += 0.026;
    ctx.weapon.shotAlert = true;
    ctx.telemetry.telemetry.event('launcher-shot', { shots: state.shots, prototype: true });
    pose();
    return true;
  }
  function reload(): boolean {
    if (loopBlocksInput(ctx) || ctx.weapon.slotState.live !== 'launcher' || !slotReady(ctx.weapon.slotState)) return false;
    const next = reloadLauncher(state);
    if (next === state) return false;
    state = next; pose(); return true;
  }
  function updateRig(): void {
    const lower = slotLowerAmount(ctx.weapon.slotState, 'launcher');
    rig.position.set(0, -.42 * lower, .06 * lower);
    rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
    rig.visible = lower < .999;
    if (rig.visible) pose();
  }
  updateRig();
  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'launcher') return false;
      if (button === 0) pending = true;
      return true;
    },
    consumeEdge() { if (pending) { pending = false; fire(); } },
    tick(dt) { state = stepLauncher(state, dt * ctx.weapon.reloadSpeed); },
    updateRig, fire, reload,
    debug: () => ({ ...state, timing: { ...LAUNCHER }, ready: launcherReady(state), beat: launcherBeat(state), hingeRad: barrel.rotation.x,
      visible: rig.visible, flash: flash.visible, carriedRound: fresh.visible, ejectedCase: ejected.visible,
      left: left.position.toArray(), forestock: handFore.toArray(), forestockDistanceM: left.position.distanceTo(handFore),
      right: right.position.toArray(), round: round.position.toArray(),
      projectileVisible: round.getObjectByName('projectile')?.visible ?? null }),
  };
}
