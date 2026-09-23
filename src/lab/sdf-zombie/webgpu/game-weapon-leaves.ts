// src/lab/sdf-zombie/webgpu/game-weapon-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { rngStreams, seedFromUnit } from './rng';
import { type TracerBasis, TRACER, faceEyeBasis, tracerBasis, tracerHeadOn, tracerLength, tracerNearFade, tracerNearScale } from './tracer-sprite';
import { type Frustum } from './free-aim';
import { muzzleWorldPosition } from '../../../game/weapons/muzzle-pos';
import { type Vec3 } from '../types';
import { eyeOf } from './game-player';
import { slotLowerAmount, stepWeaponSlot, slotReady } from './game-weapon-slots';
import { aimArm } from './game-arms';
import { type Projectile, GRAPESHOT, spawnPellets, spawnSlug } from './game-weapon';
import { updateHud } from './game-panels-leaves';
import { RELOAD, magazineAfterFire } from './game-viewmodel';
import { predictSlugHitNow } from './game-world-leaves';
import { type BenchAction } from './game-bench-scenario';

/** A view-space point, expressed in the aim rig's space RIGHT NOW. Refresh
 *  the anchor's world matrices first when the rig moved this frame. */
export function viewToRig(ctx: GameContext, view: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(view);
  ctx.weapon.viewModelAnchor.localToWorld(out);
  (ctx.weapon.aimRig ?? ctx.weapon.viewModelAnchor).worldToLocal(out);
  return out;
}

/** Fill a VIEW-space vector from a named locator inside the loaded GLB. */
export function locatorInView(ctx: GameContext, root: THREE.Object3D, name: string, out: THREE.Vector3): boolean {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => { if (o.name === name) found = o; });
  if (!found) return false;
  ctx.weapon.viewModelAnchor.updateMatrixWorld(true);
  out.copy((found as THREE.Object3D).getWorldPosition(new THREE.Vector3()));
  (ctx.weapon.aimRig ?? ctx.weapon.viewModelAnchor).worldToLocal(out);
  return true;
}

/** A breech locator's position in aim-rig space RIGHT NOW. Unlike
 *  locatorInView this is called every frame, so it assumes the caller has
 *  already refreshed the view-model's matrices this frame.
 *
 *  This is what replaces the hardcoded breech vector. That constant was both
 *  4 cm right of the real chambers (it predated the gun being centred) and
 *  static, so it could not follow the barrels through their swing -- which is
 *  the whole of "the shells don't come out of the right location". */
export function breechInRig(ctx: GameContext, i: 0 | 1, out: THREE.Vector3): boolean {
  const n = ctx.weapon.breechNodes[i];
  if (!n) return false;
  n.getWorldPosition(out);
  (ctx.weapon.aimRig ?? ctx.weapon.viewModelAnchor).worldToLocal(out);
  return true;
}

export function newTracerQuad(ctx: GameContext, map: THREE.Texture): THREE.Mesh {
  const mesh = new THREE.Mesh(ctx.weapon.pelletGeo, new THREE.MeshBasicMaterial({
    map, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Compose one quad's world matrix from a basis, two axis scales and a centre. */
export function setQuadMatrix(ctx: GameContext, 
  m: THREE.Mesh, b: TracerBasis, sx: number, sy: number, cx: number, cy: number, cz: number,
): void {
  const { x, y, z } = b;
  // Row-major to Matrix4.set: the COLUMNS are (x*sx, y*sy, z, centre).
  m.matrix.set(
    x[0] * sx, y[0] * sy, z[0], cx,
    x[1] * sx, y[1] * sy, z[1], cy,
    x[2] * sx, y[2] * sy, z[2], cz,
    0, 0, 0, 1,
  );
  m.matrixWorldNeedsUpdate = true;
}

export function startReload(ctx: GameContext): void {
  ctx.weapon.reloadAge = 0;
  ctx.weapon.reloadSeed = ctx.weapon.pinnedReloadSeed ?? 1 + Math.floor(rngStreams.reload() * 1e6);
}

export function stepBursts(ctx: GameContext, dt: number): void {
  for (const s of ctx.weapon.burstSlots) {
    if (s.age === Infinity) continue;
    s.age += dt;
    const u = s.age / s.life;
    if (u >= 1) {
      s.age = Infinity;
      for (const m of [s.core, s.halo, s.smoke]) m.visible = false;
      continue;
    }
    // A fast hot core, a slower halo, and a dark smoke card that outlives both.
    const fade = 1 - u;
    s.core.material.opacity = Math.pow(fade, 2.4);
    s.halo.material.opacity = 0.75 * Math.pow(fade, 1.3);
    s.smoke.material.opacity = 0.55 * Math.min(1, u * 2.2) * fade;
    const grow = 0.35 + 1.25 * Math.sqrt(u);
    s.core.scale.setScalar(s.h * 1.25 * grow);
    s.halo.scale.setScalar(s.h * 2.1 * grow);
    s.smoke.scale.setScalar(s.h * 2.6 * grow);
    s.smoke.position.y += dt * s.h * 0.55;
  }
}

/** The live frustum half-angle tangents. ONE definition: the barrel angle
 *  (weaponAngles, in the frame loop) and the shot ray (aimDir, right below)
 *  must not be able to disagree about where the reticle is -- that
 *  disagreement is exactly the class of bug this whole pass exists to fix,
 *  and duplicating this formula is how it would come back the first time
 *  someone tweens camera.fov for ADS or recoil.
 *
 *  Named aimFrustum, not frustum -- that name is already the module-scope
 *  THREE.Frustum used for on-screen-body culling, a different concept
 *  entirely (a view volume for culling vs. these bare half-angle tangents). */
export function aimFrustum(ctx: GameContext): Frustum {
  const tanV = Math.tan((ctx.boot.handle.camera.fov * Math.PI) / 360);
  return { tanV, tanH: tanV * ctx.boot.handle.camera.aspect };
}

export const _bd = new THREE.Vector3();
export const _o = new THREE.Vector3();
/** The bore's basis in RIG space this frame: `out` runs from the muzzles to
 *  the breeches (the way a case leaves a chamber), `side` from the left
 *  chamber to the right. Read off the same live locators as breechInRig, so
 *  it follows the barrels through their swing. Everything that leaves or
 *  enters a chamber is expressed in this basis: a case thrown in rig +Y from
 *  a bore tilted 66 degrees off it goes through the chamber wall. */
export const _bfA = new THREE.Vector3();
/** The bore's basis in RIG space this frame: `out` runs from the muzzles to
 *  the breeches (the way a case leaves a chamber), `side` from the left
 *  chamber to the right. Read off the same live locators as breechInRig, so
 *  it follows the barrels through their swing. Everything that leaves or
 *  enters a chamber is expressed in this basis: a case thrown in rig +Y from
 *  a bore tilted 66 degrees off it goes through the chamber wall. */
export const _bfB = new THREE.Vector3();
/** Scratch, so the per-shot path allocates nothing. */
export const _muzA = new THREE.Vector3();
/** Scratch, so the per-shot path allocates nothing. */
export const _muzB = new THREE.Vector3();

/** A view-space DIRECTION in rig space (two points, subtracted). */
export function viewDirToRig(ctx: GameContext, view: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  viewToRig(ctx, _o.set(0, 0, 0), out);
  const tip = viewToRig(ctx, view, _bd);
  return out.sub(tip).negate().normalize();
}

export function boreFrameInRig(ctx: GameContext, out: THREE.Vector3, side: THREE.Vector3): boolean {
  const mL = ctx.weapon.muzzleNodes[0], mR = ctx.weapon.muzzleNodes[1];
  const bL = ctx.weapon.breechNodes[0], bR = ctx.weapon.breechNodes[1];
  if (!mL || !mR || !bL || !bR) return false;
  const rig = ctx.weapon.aimRig ?? ctx.weapon.viewModelAnchor;
  rig.worldToLocal(bL.getWorldPosition(_bfA));
  rig.worldToLocal(bR.getWorldPosition(_bfB));
  out.copy(_bfA).add(_bfB).multiplyScalar(0.5);
  side.copy(_bfB).sub(_bfA).normalize();
  rig.worldToLocal(mL.getWorldPosition(_bfA));
  rig.worldToLocal(mR.getWorldPosition(_bfB));
  _bfA.add(_bfB).multiplyScalar(0.5);
  out.sub(_bfA).normalize();
  return true;
}

/**
 * World-space muzzle. Reads the GLB's OWN Muzzle_L/R locators when the gun is
 * loaded, so it follows the weapon's real heading -- including the free-aim
 * swing -- instead of being a second description of where the gun is that can
 * drift from the first. It did drift: the previous inline version put the
 * spawn point at forward -0.500 from the eye while the visible muzzle sits at
 * forward +0.600, so every projectile was born 1.1 m BEHIND the barrel and
 * flew through the player's head.
 *
 * The fallback keeps the headless contract: predictSlugHitNow() and the CDP
 * gates fire with no GLB loaded, which is why an eye-relative formula exists
 * at all. It now goes through muzzle-pos.ts's tested helper rather than
 * re-deriving the basis by hand with the sign wrong.
 */
export function muzzleWorld(ctx: GameContext): Vec3 {
  const eye = eyeOf(ctx.player.player);
  if (ctx.weapon.gunReady && ctx.weapon.muzzleNodes.length === 2) {
    ctx.weapon.muzzleNodes[0]!.getWorldPosition(_muzA);
    ctx.weapon.muzzleNodes[1]!.getWorldPosition(_muzB);
    _muzA.add(_muzB).multiplyScalar(0.5);
    return [_muzA.x, _muzA.y, _muzA.z];
  }
  const cp = Math.cos(ctx.player.player.pitch);
  const fwd = { x: Math.sin(ctx.player.player.yaw) * cp, y: Math.sin(ctx.player.player.pitch), z: -Math.cos(ctx.player.player.yaw) * cp };
  const right = { x: Math.cos(ctx.player.player.yaw), y: 0, z: Math.sin(ctx.player.player.yaw) };
  const up = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };
  const m = muzzleWorldPosition(
    { x: eye[0], y: eye[1], z: eye[2] }, { right, up, forward: fwd },
    0.2, -0.12, 0.5,
  );
  return [m.x, m.y, m.z];
}

/** Hold pose, rig space: low and off to one side, canted so the fuse end
 *  reads against the dark. Which side is the off-hand side follows the
 *  existing view-model convention (the shorty is yawed 180°, so its chambers
 *  land screen-left and the rig's +x is what the player sees on the left). */
export const BUNDLE_HOLD = {
  pos: new THREE.Vector3(0.235, -0.245, -0.42),
  rot: new THREE.Euler(
    THREE.MathUtils.degToRad(-28), THREE.MathUtils.degToRad(18), THREE.MathUtils.degToRad(28),
  ),
};
// The burst stand-in (stage 3 replaces this with webgpu/explosion-vfx.ts).
// Additive cards in the effects overlay — the SAME routing the tracers use
// (character-effects.ts's header explains why: that scene is drawn after the
// SDF composite with the completed depth buffer, so the composite cannot
// erase the burst and bodies can still occlude it).
// -----------------------------------------------------------------------
export const BURST_SLOTS = 6;

export function spawnBurstStandIn(ctx: GameContext, at: Vec3, heightM: number, kind: 'air' | 'ground'): void {
  const s = ctx.weapon.burstSlots[ctx.weapon.burstCursor++ % BURST_SLOTS]!;
  s.age = 0;
  s.life = kind === 'ground' ? 0.62 : 0.5;
  s.h = heightM;
  // Ground bursts sit ON the floor and bloom up; air bursts centre.
  const y = kind === 'ground' ? at[1] + heightM * 0.35 : at[1];
  for (const m of [s.core, s.halo, s.smoke]) { m.position.set(at[0], y, at[2]); m.visible = true; }
}

export function stepWeaponSlots(ctx: GameContext, dt: number): void {
  ctx.weapon.slotState = stepWeaponSlot(ctx.weapon.slotState, dt);

  const gunLower = slotLowerAmount(ctx.weapon.slotState, 'shotgun');
  // Drop out of frame AND dip the muzzles: that reads as putting a gun away,
  // where a fade reads as a bug.
  ctx.weapon.gunRig.position.set(0, -0.42 * gunLower, 0.06 * gunLower);
  ctx.weapon.gunRig.rotation.set(THREE.MathUtils.degToRad(38) * gunLower, 0, 0);
  ctx.weapon.gunRig.visible = gunLower < 0.999;

  const bundleLower = slotLowerAmount(ctx.weapon.slotState, 'dynamite');
  ctx.bake.bundleRig.position.set(
    BUNDLE_HOLD.pos.x,
    BUNDLE_HOLD.pos.y - 0.34 * bundleLower,
    BUNDLE_HOLD.pos.z,
  );
  // Only the LIVE weapon's model is drawn: during the drop the bundle is
  // still holstered, and it appears the instant the frame changes hands.
  ctx.bake.bundleRig.visible = ctx.weapon.slotState.live === 'dynamite' && ctx.weapon.heldProp !== null;
  // Slot 3: the same one-transform holster travel.
  ctx.weapon.flare?.updateRig();
}

export function aimDir(ctx: GameContext): Vec3 {
  const cp = Math.cos(ctx.player.player.pitch);
  const fwd: Vec3 = [
    Math.sin(ctx.player.player.yaw) * cp, Math.sin(ctx.player.player.pitch), -Math.cos(ctx.player.player.yaw) * cp,
  ];
  if (!ctx.player.freeAimOn) return fwd;
  // FIRE THROUGH THE RETICLE. With free aim the reticle is the aim point, so
  // a shot down the camera's forward axis would land wherever the player
  // happens to be FACING rather than where they are AIMING -- the one thing
  // this scheme exists to separate. Offset the ray by the reticle's angular
  // position inside the frustum.
  const { tanV, tanH } = aimFrustum(ctx);
  const right: Vec3 = [Math.cos(ctx.player.player.yaw), 0, Math.sin(ctx.player.player.yaw)];
  // up = right x fwd, for a right-handed basis
  const up: Vec3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const cx = ctx.weapon.aim.x * tanH, cy = ctx.weapon.aim.y * tanV;
  const d: Vec3 = [
    fwd[0] + right[0] * cx + up[0] * cy,
    fwd[1] + right[1] * cx + up[1] * cy,
    fwd[2] + right[2] * cx + up[2] * cy,
  ];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** AIM CONVERGENCE (2026-08-26 defect-2 fix candidate): the muzzle sits
 *  ~20 cm right and ~12 cm low of the EYE, and pellets used to fly PARALLEL
 *  to the camera ray — so at ANY range impacts landed that whole offset off
 *  the crosshair. Standard FPS remedy: every projectile converges on the
 *  point where the camera ray meets AIM_CONVERGE_M. Close shots still group;
 *  the parallel-ray offset is gone by construction. */
export const AIM_CONVERGE_M = 8;

export function convergedDir(ctx: GameContext, origin: Vec3): Vec3 {
  const eye = eyeOf(ctx.player.player);
  const a = aimDir(ctx);
  const target: Vec3 = [
    eye[0] + a[0] * AIM_CONVERGE_M,
    eye[1] + a[1] * AIM_CONVERGE_M,
    eye[2] + a[2] * AIM_CONVERGE_M,
  ];
  const d: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** The two elbows, rig space. See aimArm. */
/** The two SHOULDERS, rig space: behind and below the camera, either side
 *  of the body. A two-bone arm runs from each hand to these (game-arms.ts
 *  aimArm): forearm to an IK elbow, upper arm on to the shoulder, whose
 *  ball ends behind the eye whatever the view pitch. The elbows bend down
 *  and OUTWARD (the hints), the way arms holding a gun at the hip do. */
//
//  IN VIEW SPACE (the camera's frame, viewModelAnchor), NOT the aim rig's.
//  Free aim pitches the rig about the grip, and a shoulder that rode the
//  rig swung round in front of the camera on a hard look up: the upper arm
//  crossed the near plane, was cut off, and the hand read as floating
//  (owner's screenshot). The body does not turn with the gun; the shoulders
//  stay put behind the eye and the arms are re-aimed at them every frame.
//
//  The BEND HINTS are view-space directions too: OUTWARD (away from the gun,
//  left for the left arm) and a little down. game-arms.ts floors the bend
//  at ARM_MIN_BEND_RAD, so under a hard look up -- hand high on the
//  fore-end, shoulder low behind -- the forearm leaves the hand sideways
//  past the receiver instead of straight through it (owner's screenshots).
export const SHOULDER_L_VIEW = new THREE.Vector3(-0.22, -0.26, 0.06);
export const SHOULDER_R_VIEW = new THREE.Vector3(0.26, -0.30, 0.06);
export const BEND_L_VIEW = new THREE.Vector3(-1, -0.4, 0);
export const BEND_R_VIEW = new THREE.Vector3(1, -0.4, 0);
export const _sh = new THREE.Vector3();
/** Aim both arms at their shoulders. Called every frame after the rig pose
 *  is set, and again wherever a hand is moved. */
export const _bendR = new THREE.Vector3();
/** Aim both arms at their shoulders. Called every frame after the rig pose
 *  is set, and again wherever a hand is moved. */
export const _bendL = new THREE.Vector3();

export function aimArms(ctx: GameContext): void {
  ctx.weapon.viewModelAnchor.updateMatrixWorld(true);
  if (ctx.weapon.gripHandGroup) {
    viewDirToRig(ctx, BEND_R_VIEW, _bendR);
    aimArm(ctx.weapon.gripHandGroup, viewToRig(ctx, SHOULDER_R_VIEW, _sh), _bendR);
  }
  if (ctx.weapon.foreHandGroup) {
    viewDirToRig(ctx, BEND_L_VIEW, _bendL);
    aimArm(ctx.weapon.foreHandGroup, viewToRig(ctx, SHOULDER_L_VIEW, _sh), _bendL);
  }
}

export interface TracerView { streak: THREE.Mesh; ember: THREE.Mesh }

export function newTracerView(ctx: GameContext): TracerView {
  const view = { streak: newTracerQuad(ctx, ctx.vfx.tracerTex), ember: newTracerQuad(ctx, ctx.vfx.emberTex) };
  // The EFFECTS overlay, not the main scene: the overlay draws after the
  // SDF composite against the completed depth buffer, so a streak crossing
  // in front of a body stays visible and one behind it is occluded. In the
  // main pass the streak writes no depth, and the flesh composite — depth-
  // testing only against the wall behind — painted straight over it
  // (owner-caught: tracers clipped by the soldier's body).
  ctx.vfx.characterEffects.scene.add(view.streak);
  ctx.vfx.characterEffects.scene.add(view.ember);
  return view;
}

/**
 * Point one pooled view at one live projectile, from an eye at `eye`.
 * The streak's HEAD sits on the projectile and the smear trails behind it,
 * so the thing that collides and the thing that glows are the same point;
 * the ember sits ON the projectile and takes over as the streak collapses.
 */
export function placeTracer(ctx: GameContext, v: TracerView, p: Projectile, eye: Vec3): void {
  const ex = eye[0] - p.pos[0], ey = eye[1] - p.pos[1], ez = eye[2] - p.pos[2];
  const toEye: Vec3 = [ex, ey, ez];
  const dist = Math.hypot(ex, ey, ez);
  const fade = tracerNearFade(dist);
  const basis = tracerBasis(p.vel, toEye);
  if (!basis || fade <= 0) { hideTracer(ctx, v); return; }

  const len = tracerLength(Math.hypot(p.vel[0], p.vel[1], p.vel[2]));
  // Near the eye the width and the ember shrink with distance so a pellet
  // passing the camera stays a glow, never a screen-filling disc. See
  // tracerNearScale — the fade alone does not cover an ARRIVING shot.
  const near = tracerNearScale(dist);
  const wid = p.radius * TRACER.widthScale * near;
  v.streak.visible = true;
  (v.streak.material as THREE.MeshBasicMaterial).opacity = fade;
  setQuadMatrix(ctx, v.streak, basis, len, wid,
    p.pos[0] - basis.x[0] * len * 0.5,
    p.pos[1] - basis.x[1] * len * 0.5,
    p.pos[2] - basis.x[2] * len * 0.5);

  const headOn = tracerHeadOn(p.vel, toEye) * fade;
  const face = headOn > 0 ? faceEyeBasis(toEye) : null;
  if (!face) { v.ember.visible = false; return; }
  const d = p.radius * TRACER.emberScale * near;
  v.ember.visible = true;
  (v.ember.material as THREE.MeshBasicMaterial).opacity = headOn;
  setQuadMatrix(ctx, v.ember, face, d, d, p.pos[0], p.pos[1], p.pos[2]);
}

export function hideTracer(ctx: GameContext, v: TracerView): void {
  v.streak.visible = false;
  v.ember.visible = false;
}

/** The muzzle in VIEW space, read off the GLB's own Muzzle_L/Muzzle_R
 *  locators rather than guessed. The first pass put the flash at
 *  (0.085, -0.060, -0.560) -- 4 cm left, 4.5 cm high and 3 cm SHORT of the
 *  real muzzle -- so it burned halfway down the barrel instead of at the
 *  bores, which is a good part of why it read wrong. */
export const MUZZLE_VIEW = new THREE.Vector3(0.125, -0.105, -0.600);

export function fire(ctx: GameContext, barrels: 1 | 2): boolean {
  // SLOT GATE. The grapeshot only speaks while it is the live weapon and the
  // switch has settled — __sdfGame.fire()/fireSlug() go through here too, so
  // a driver cannot fire the shotgun through a lit bundle.
  if (ctx.weapon.slotState.live !== 'shotgun' || !slotReady(ctx.weapon.slotState)) return false;
  if (!ctx.weapon.gunReady || ctx.weapon.cooldown > 0) return false;
  if (ctx.weapon.reloadAge <= RELOAD.totalSec) return false;   // busy breaking/loading
  if (!ctx.weapon.infiniteAmmo && ctx.weapon.shells <= 0) { startReload(ctx); return false; } // click -> start reloading
  // Gunfire in a room turns every head in it, cone or no cone. Placed after
  // the guards on purpose: a dry click or a shot during a reload must not
  // alert anything, or the flag fires on inputs that made no noise.
  barrels = (ctx.weapon.infiniteAmmo ? barrels : Math.min(ctx.weapon.shells, barrels)) as 1 | 2;
  ctx.telemetry.telemetry.event('shot', { kind: ctx.weapon.slugMode ? 'slug' : 'pellet', barrels });
  ctx.weapon.shotAlert = true;
  ctx.weapon.cooldown = GRAPESHOT.fireCooldownSec;
  ctx.weapon.recoilPitch += GRAPESHOT.kickRadPerBarrel * barrels;
  if (!ctx.weapon.infiniteAmmo) {
    ctx.weapon.shells = magazineAfterFire(ctx.weapon.shells, barrels);
    if (ctx.weapon.shells <= 0) startReload(ctx);
  }
  updateHud(ctx);
  ctx.weapon.flashAge = 0;
  ctx.weapon.fireAge = 0;
  ctx.weapon.fireBarrels = barrels;
  if (ctx.weapon.flashGroup && ctx.weapon.flashMaterial) {
    // Fresh roll AND a fresh star per shot, so repeat fire never strobes an
    // identical silhouette.
    ctx.weapon.flashGroup.rotation.z = rngStreams.fx() * Math.PI * 2;
    const tex = ctx.weapon.flashTextures[Math.floor(rngStreams.fx() * ctx.weapon.flashTextures.length)];
    if (tex) { ctx.weapon.flashMaterial.map = tex; ctx.weapon.flashMaterial.needsUpdate = true; }
  }
  // Release a few smoke puffs at the muzzle. Both barrels make more smoke.
  {
    let released = 0;
    const want = barrels === 2 ? 5 : 3;
    for (const puff of ctx.vfx.smokePuffs) {
      if (released >= want) break;
      if (puff.age !== Infinity) continue;
      puff.age = 0;
      puff.roll = rngStreams.fx() * Math.PI * 2;
      puff.mesh.position.set(
        MUZZLE_VIEW.x + (rngStreams.fx() - 0.5) * 0.03,
        MUZZLE_VIEW.y + (rngStreams.fx() - 0.5) * 0.03,
        MUZZLE_VIEW.z - 0.02 - rngStreams.fx() * 0.05,
      );
      puff.vel.set(
        (rngStreams.fx() - 0.5) * 0.25,
        0.10 + rngStreams.fx() * 0.18,
        -0.55 - rngStreams.fx() * 0.35,
      );
      puff.mesh.rotation.z = puff.roll;
      released++;
    }
  }
  if (ctx.weapon.slugMode) {
    // One lump down one known ray instead of a pellet volley.
    ctx.weapon.pellets.push(spawnSlug(muzzleWorld(ctx), convergedDir(ctx, muzzleWorld(ctx))));
    return true;
  }
  const muz = muzzleWorld(ctx);
  const dir = convergedDir(ctx, muz);
  // spawnPellets spreads around `dir`; convergence just re-centres the cone.
  // One `misc` draw per volley is the pellet seed (mulberry32 inside).
  ctx.weapon.pellets.push(...spawnPellets(muz, dir, barrels, seedFromUnit(rngStreams.misc())));
  return true;
}

/**
 * Aim at a body the ballistic predictor CONFIRMS is hittable.
 *
 * Two things this must not do, both learned by measurement (2026-08-31):
 *
 *   1. Do not stamp at a cluster CENTRE. A torso centre sits INSIDE the
 *      field: it anchors the crater pathologically, and a slug's severRadius
 *      cuts both hip necks into an instant collapse. The centre is used only
 *      to POINT the camera; the shot itself resolves to a surface.
 *   2. Do not aim at whatever is nearest. Room 4 spawns its zombies around
 *      the room centre, so a bench standing at the centre had a body 0.97 m
 *      away — close enough that the aim pitched 26 degrees DOWN into it, the
 *      predictor returned actorId -1, and all eight pellets expired having
 *      hit nothing. The bench then reported "firing" segments that contained
 *      no wounds at all.
 *
 * So: candidates in distance order, skipping anything inside MIN_STANDOFF,
 * and the first one the predictor confirms wins. Returns false if none do,
 * which leaves the aim untouched — a bench that silently re-aimed until it
 * connected would be measuring something the scenario never described.
 */
export const MIN_STANDOFF = 1.5;

export function aimAtNearestSurface(ctx: GameContext, limb?: string, actorId?: number): boolean {
  const eye = eyeOf(ctx.player.player);
  const candidates = ctx.world.actors
    .filter(a => actorId === undefined || a.id === actorId)
    .map((a) => {
      const c = a.posed().clusters.find(cc => cc.limb === (limb ?? 'torso') && (actorId === undefined || cc.alive))?.center;
      return c ? { c: [...c] as Vec3, d: Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) } : null;
    })
    .filter((x): x is { c: Vec3; d: number } => x !== null && x.d >= MIN_STANDOFF)
    .sort((a, b) => a.d - b.d);

  const yaw0 = ctx.player.player.yaw;
  const pitch0 = ctx.player.player.pitch;
  for (const cand of candidates) {
    // YAW CONVENTION: the page's forward is (sin yaw, −cos yaw) — camera
    // lookAt (below), aimDir and muzzleWorld all agree — so facing a target
    // at offset (dx, dz) is atan2(dx, −dz). walkTo (above) already did this
    // right; these two bench sites had the z sign flipped since cdba91f,
    // which mirrored the aim across the player's z plane. It only ever
    // "worked" while bodies happened to sit near that plane; with the group
    // fully on one side the bench faced a wall, benched an empty frustum
    // and fired every shot into it (measured 2026-09-02: census 0, 0
    // wounds, p50 1.5 ms). NOTE the aim search is still needed even with
    // the sign right: the predictor simulates SLUG GRAVITY, so dead-on
    // yaw/pitch at the torso can still miss low — try candidates, keep the
    // first the predictor confirms.
    ctx.player.player.yaw = Math.atan2(cand.c[0] - eye[0], -(cand.c[2] - eye[2]));
    ctx.player.player.pitch = Math.atan2(cand.c[1] - eye[1], Math.hypot(cand.c[0] - eye[0], cand.c[2] - eye[2]));
    // Scoped diagnostics settle the real viewmodel after this orientation
    // and verify the predictor there; its muzzle transform is stale here.
    if (actorId !== undefined || predictSlugHitNow(ctx).actorId >= 0) return true;
  }
  ctx.player.player.yaw = yaw0;
  ctx.player.player.pitch = pitch0;
  return false;
}

/** ONE SCENARIO ACTION, applied to the live page — the seam the perf
 *  bench and the frame-hash recorder BOTH drive (deterministic demo
 *  recordings stage 2, 2026-09-10). Extracted verbatim from the bench's
 *  inline `perform`: the teleport heuristics inside were tuned against the
 *  bench census (2026-08-31 — the room centre missed every shot and an
 *  outer corner aimed at a wall), so if this drifts, a recorded demo stops
 *  replaying the scenario the bench measured. One implementation, not two.
 */
export function performBenchAction(ctx: GameContext, a: BenchAction): void {
switch (a.kind) {
  case 'teleport': {
    const r = ctx.world.level.rooms.find(x => x.id === a.room);
    if (r) {
      // Stand back from where the BODIES actually are, facing
      // them. Two heuristics were tried and both failed against
      // the census (2026-08-31): the room centre put a zombie
      // 0.97 m away so every shot pitched down into it and
      // missed, and an outer corner pointed the camera at a wall
      // with bodies 1 -> 0 on screen. The room's own actors are
      // the only thing that reliably says where to look.
      const mine = ctx.world.actors.filter(x => x.room === a.room);
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      let tx = cx;
      let tz = cz;
      if (mine.length) {
        tx = mine.reduce((n, x) => n + x.pose().pos[0], 0) / mine.length;
        tz = mine.reduce((n, x) => n + x.pose().pos[2], 0) / mine.length;
      }
      // Back off along the direction from the room centre toward
      // the outer wall, so the whole group stays in front.
      const away = Math.hypot(tx - cx, tz - cz);
      let ax = away > 0.2 ? (cx - tx) / away : 0;
      let az = away > 0.2 ? (cz - tz) / away : 1;
      // Degenerate group (all at the centre): back off along -z.
      if (!Number.isFinite(ax) || (ax === 0 && az === 0)) { ax = 0; az = 1; }
      const STANDOFF = 4.0;
      const inset = 0.6;
      const px = Math.min(r.maxX - inset, Math.max(r.minX + inset, tx + ax * STANDOFF));
      const pz = Math.min(r.maxZ - inset, Math.max(r.minZ + inset, tz + az * STANDOFF));
      ctx.player.player.pos = [px, 0, pz];
      ctx.player.player.vel = [0, 0, 0];
      // atan2(dx, −dz): the page's forward is (sin yaw, −cos
      // yaw) — see aimAtNearestSurface. Was atan2(dx, +dz)
      // (z-mirrored) since cdba91f.
      ctx.player.player.yaw = Math.atan2(tx - px, -(tz - pz));
      ctx.player.player.pitch = 0;
      ctx.player.player.grounded = true;
    }
    break;
  }
  case 'freeze': ctx.demo.wanderFrozen = a.on; break;
  case 'look': ctx.player.player.yaw = a.yaw; ctx.player.player.pitch = a.pitch; break;
  case 'aimSurface': aimAtNearestSurface(ctx); break;
  case 'fire': fire(ctx, a.barrels); break;
  case 'fireSlug': {
    const keep = ctx.weapon.slugMode;
    ctx.weapon.slugMode = true;
    try { fire(ctx, 1); } finally { ctx.weapon.slugMode = keep; }
    break;
  }
  // RECORDED INPUT (stage 3): stage the frame; `tick` consumes it through
  // applyInputFrame, exactly as the standalone replay driver does. Applying
  // it here as well would double the shot. `replayActive` must be on (the
  // bench's demo path sets it) or tick would overwrite this frame from the
  // live listeners.
  case 'input': ctx.player.currentInputFrame = a.frame; break;
}
}
