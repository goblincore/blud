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
