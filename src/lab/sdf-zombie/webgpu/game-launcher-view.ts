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
import { makeGrenade, stepGrenade } from '../launcher-grenade';
import type { FlightState } from '../dynamite-flight';
import type { Vec3 } from '../types';
import { aimDir } from './game-weapon-rig';
import { eyeOf } from './game-player';
import { bundleHitsBody } from './game-dynamite-throw';
import { detonateAt } from './game-dynamite-step';
import { ceilingAt, debrisGround, sectorHitBetween } from './game-hit-trace';
import { WALL_SKIN_M } from './sector-debris';

export interface LauncherView {
  onMouseDown(button: number): boolean;
  consumeEdge(): void;
  /** `cycleDt` drives the fire/reload cycle (bullet time's reload step);
   *  `shotDt` flies the grenades (the player's projectile step, as pellets). */
  tick(cycleDt: number, shotDt: number): void;
  updateRig(): void;
  fire(): boolean;
  reload(): boolean;
  debug(): Record<string, unknown>;
}

/** The drawn shell's size over the glb warhead's: the real 40 mm nose is too
 *  small to read in flight. Drawing only; the flight radius is GRENADE.radiusM. */
const GRENADE_DRAW_SCALE = 2.5;

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
  // THE GRENADES IN FLIGHT. Each draws as a clone of the round's own warhead
  // (the glb's `projectile` node), parented to the scene root and posed from
  // the pure flight (launcher-grenade.ts). Meshes only: no light rides the
  // shell, and the blast's light is the dynamite pool's (detonateAt).
  const warhead = round.getObjectByName('projectile');
  if (!warhead) throw new Error('[launcher] grenade-launcher.glb Round has no projectile');
  const shellGroup = new THREE.Group(); shellGroup.name = 'launcher-grenades';
  ctx.boot.handle.scene.add(shellGroup);
  ctx.boot.deferredApi?.router.register(shellGroup, 'mesh', 'level-only');
  // THE SHELL'S GLOW: the warhead is a 3 cm nose, a pixel at room range, so
  // each shell also carries an additive sprite (the muzzle flash's texture,
  // unlit: no light, so no LightsNode re-key). It is a forward draw outside
  // the routed group, as the muzzle flash is.
  const glowGroup = new THREE.Group(); glowGroup.name = 'launcher-grenade-glows';
  ctx.boot.handle.scene.add(glowGroup);
  const glowMat = new THREE.SpriteMaterial({ map: tex, color: 0xff9a4a, transparent: true, opacity: .9,
    blending: THREE.AdditiveBlending, depthWrite: false });
  interface Shell { state: FlightState; view: THREE.Object3D; glow: THREE.Sprite; nose: THREE.Vector3; baseQ: THREE.Quaternion }
  const shells: Shell[] = [];
  const spareViews: THREE.Object3D[] = [];
  const spareGlows: THREE.Sprite[] = [];
  let launched = 0, detonated = 0;
  let lastBoom: { cause: string | null; at: Vec3 } | null = null;
  const muzzleW = new THREE.Vector3(), breechW = new THREE.Vector3(), velDir = new THREE.Vector3(), turn = new THREE.Quaternion();
  const scaleW = new THREE.Vector3();
  function launch(): void {
    rig.updateMatrixWorld(true);
    muzzle.getWorldPosition(muzzleW); breech.getWorldPosition(breechW);
    let origin: Vec3 = [muzzleW.x, muzzleW.y, muzzleW.z];
    // SECTOR LEVELS: a muzzle past the wall the player hugs would start the
    // shell in the void; start it on the eye's side, as the bundle throw does.
    const eye = eyeOf(ctx.player.player);
    const wallHit = sectorHitBetween(ctx, eye, origin);
    if (wallHit) {
      const d = Math.hypot(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]) || 1;
      const k = Math.max(0, wallHit.t - (0.03 + WALL_SKIN_M) / d);
      origin = [eye[0] + (origin[0] - eye[0]) * k, eye[1] + (origin[1] - eye[1]) * k, eye[2] + (origin[2] - eye[2]) * k];
    }
    // FREE AIM: the reticle's ray, never the camera forward.
    const state = makeGrenade(origin, aimDir(ctx));
    const view = spareViews.pop() ?? warhead!.clone(true);
    view.name = 'launcher-grenade';
    // The drawn shell keeps the warhead's world size and its world attitude at
    // the muzzle; flight turns it from the bore's nose onto the velocity.
    warhead!.getWorldScale(scaleW); view.scale.copy(scaleW).multiplyScalar(GRENADE_DRAW_SCALE);
    const baseQ = new THREE.Quaternion(); warhead!.getWorldQuaternion(baseQ);
    const nose = muzzleW.clone().sub(breechW).normalize();
    view.visible = true;
    shellGroup.add(view);
    const glow = spareGlows.pop() ?? new THREE.Sprite(glowMat);
    glow.name = 'launcher-grenade-glow'; glow.scale.setScalar(.22); glow.renderOrder = 998;
    glow.visible = true; glowGroup.add(glow);
    const shell: Shell = { state, view, glow, nose, baseQ };
    shells.push(shell); placeShell(shell);
    launched++;
    ctx.telemetry.telemetry.event('launcher-grenade-launch', { x: origin[0], y: origin[1], z: origin[2] });
  }
  function placeShell(s: Shell): void {
    s.view.position.set(s.state.pos[0], s.state.pos[1], s.state.pos[2]);
    s.glow.position.copy(s.view.position);
    velDir.set(s.state.vel[0], s.state.vel[1], s.state.vel[2]);
    if (velDir.lengthSq() > 1e-6) turn.setFromUnitVectors(s.nose, velDir.normalize());
    s.view.quaternion.copy(turn).multiply(s.baseQ);
  }
  function stepShells(dt: number): void {
    if (!(dt > 0) || shells.length === 0) return;
    const g = debrisGround(ctx);
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i]!;
      const world = { colliders: ctx.world.colliders, ceilM: ceilingAt(ctx, s.state.pos[0], s.state.pos[2]), ...(g ? { ground: g } : {}) };
      const r = stepGrenade(s.state, dt, world, (from, to) => bundleHitsBody(ctx, from, to) !== null);
      s.state = r.state;
      if (r.boom) {
        shells.splice(i, 1);
        s.view.visible = false; shellGroup.remove(s.view); spareViews.push(s.view);
        s.glow.visible = false; glowGroup.remove(s.glow); spareGlows.push(s.glow);
        detonated++;
        lastBoom = { cause: r.cause, at: [...r.boom] as Vec3 };
        ctx.telemetry.telemetry.event('launcher-grenade-detonate', { cause: r.cause, x: r.boom[0], y: r.boom[1], z: r.boom[2] });
        // THE DYNAMITE'S BLAST, unchanged: wounds, gibs, shove, light, kick.
        detonateAt(ctx, r.boom, false, ctx.world.level.def?.sectors ? r.lastOpen : undefined);
        continue;
      }
      placeShell(s);
    }
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
    launch();
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
    tick(cycleDt, shotDt) { state = stepLauncher(state, cycleDt * ctx.weapon.reloadSpeed); stepShells(shotDt); },
    updateRig, fire, reload,
    debug: () => ({ ...state, grenades: { launched, detonated, lastBoom, flying: shells.map(q => [...q.state.pos]) }, timing: { ...LAUNCHER }, ready: launcherReady(state), beat: launcherBeat(state), hingeRad: barrel.rotation.x,
      visible: rig.visible, flash: flash.visible, carriedRound: fresh.visible, ejectedCase: ejected.visible,
      left: left.position.toArray(), forestock: handFore.toArray(), forestockDistanceM: left.position.distanceTo(handFore),
      right: right.position.toArray(), round: round.position.toArray(),
      projectileVisible: round.getObjectByName('projectile')?.visible ?? null }),
  };
}
