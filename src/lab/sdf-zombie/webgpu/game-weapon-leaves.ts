// src/lab/sdf-zombie/webgpu/game-weapon-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { rngStreams } from './rng';
import { type TracerBasis } from './tracer-sprite';
import { type Frustum } from './free-aim';
import { muzzleWorldPosition } from '../../../game/weapons/muzzle-pos';
import { type Vec3 } from '../types';
import { eyeOf } from './game-player';
import { slotLowerAmount, stepWeaponSlot } from './game-weapon-slots';

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
