import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Weapon, FrameCtx, ViewCtx, HudCtx } from './types';
import type { Vec3 } from '../gibs/particles';
import { DYNAMITE_COOK, EXPLOSION_STANDARD } from '../gibs/tuning';

// ——— Projectile billboard rendering (flying dynamite bundle sprite) ————

let projectileScene: THREE.Scene | null = null;
let projectileTexture: THREE.Texture | null = null;
let projectileCamera: THREE.Camera | null = null;

export function configureProjectileRendering(scene: THREE.Scene, tex: THREE.Texture): void {
  projectileScene = scene;
  projectileTexture = tex;
}
export function setProjectileCamera(cam: THREE.Camera): void { projectileCamera = cam; }

// ——— Pure math (TDD'd) ————————————————————————————————

export function chargeFraction(heldSec: number): number {
  return Math.max(0, Math.min(1, heldSec / DYNAMITE_COOK.maxChargeSec));
}

export function throwVelocityMps(chargeFrac: number): number {
  const c = Math.max(0, Math.min(1, chargeFrac));
  return DYNAMITE_COOK.minVelocityMps
       + c * (DYNAMITE_COOK.maxVelocityMps - DYNAMITE_COOK.minVelocityMps);
}

export function remainingFuse(cookSec: number): number {
  return DYNAMITE_COOK.fuseMaxSec - cookSec;
}

/**
 * Build the throw velocity vector.
 *
 * Port of Blood's `actFireThing` dispatch (actor.cpp:7106):
 *   xvel, yvel = nSpeed * cos/sin(ang)
 *   zvel       = nSpeed * (slope + -9460)
 *
 * We take the player's forward vector (already includes yaw + pitch from look),
 * rotate it *upward* by `pitchLobDeg` around the player's right axis (so it
 * stays aim-relative regardless of pitch), then scale by `speed`.
 *
 * Result: aiming level → ~30° arc, aiming up → ~30° higher still, aiming
 * straight down → the lob pulls it back up to ~-60° instead of vertical,
 * which matches how Blood's throw always has an upward bias on top of aim.
 */
export function throwVector(
  forward: Vec3,
  speed: number,
  pitchLobDeg: number = DYNAMITE_COOK.pitchLobDeg,
): Vec3 {
  // Normalize forward (caller should pass unit vectors, but guard anyway).
  const fLen = Math.hypot(forward.x, forward.y, forward.z) || 1;
  const fx = forward.x / fLen;
  const fy = forward.y / fLen;
  const fz = forward.z / fLen;

  // Player's "right" axis is forward × worldUp (Y-up, right-handed):
  //   (fx, fy, fz) × (0, 1, 0) = (-fz, 0, fx)
  // Only the horizontal components matter for the right-axis direction.
  const rLen = Math.hypot(fz, fx) || 1;
  const rx = -fz / rLen;
  const rz = fx / rLen;

  // Rotate forward around `right` by +pitchLobDeg (upward).
  // Rodrigues: v' = v cosθ + (r × v) sinθ + r (r·v)(1 - cosθ)
  // r·v = rx*fx + 0*fy + rz*fz = (fz*fx + -fx*fz)/rLen = 0, so the last term drops.
  // r × v = (0*fz - rz*fy, rz*fx - rx*fz, rx*fy - 0*fx)
  //       = (-rz*fy, rz*fx - rx*fz, rx*fy)
  const theta = (pitchLobDeg * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const crossX = -rz * fy;
  const crossY = rz * fx - rx * fz;
  const crossZ = rx * fy;

  const dx = fx * cosT + crossX * sinT;
  const dy = fy * cosT + crossY * sinT;
  const dz = fz * cosT + crossZ * sinT;

  return { x: dx * speed, y: dy * speed, z: dz * speed };
}

// ——— Projectile (per-shot entity) ——————————————————————

interface DynamiteProjectile {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh | null;
  fuseLeft: number;
  spawnTime: number;
}

/** Global registry of live dynamite projectiles; ticked each frame from dynamite.ts */
const liveProjectiles: DynamiteProjectile[] = [];

/**
 * Spawn a dynamite projectile. Called by Dynamite.onRelease and Dynamite.selfExplode.
 * If `fuseLeft` is ≤ 0 the projectile detonates on the first tick (in-flight = 0 s).
 */
export function spawnProjectile(
  world: RAPIER.World,
  pos: Vec3,
  vel: Vec3,
  fuseLeft: number,
  now: number,
): DynamiteProjectile {
  // Port of Blood thingInfo[kThingArmedTNTStick - kThingBase] (actor.cpp:1998):
  //   mass=14, clipdist=16, elastic=24576, dmgResist=1600, cstat=256
  // elastic is Blood's 16.16 fixed-point bounce coefficient: 24576 / 65536 ≈ 0.375.
  // clipdist=16 BU ≈ 0.0625 m; our ball collider at 0.1 m is a touch larger so it
  // doesn't tunnel through thin colliders.
  // Low linear damping so the stick actually carries through its arc — Blood
  // only applies gravity + xy-airdrag (very small) to thrown things.
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setLinearDamping(0.02)
    .setAngularDamping(0.15);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.ball(0.08)
    .setRestitution(0.375)
    .setFriction(0.5)
    .setDensity(0.4); // lighter than default so the same velocity carries further
  world.createCollider(colliderDesc, body);
  body.setLinvel(vel, true);
  // Tumble like a thrown stick — roll around its long axis primarily.
  body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 12 }, true);

  let mesh: THREE.Mesh | null = null;
  if (projectileScene && projectileTexture) {
    // Stick silhouette: narrow + tall. Blood tile 3423 is ~18×40 px.
    const geom = new THREE.PlaneGeometry(0.18, 0.4);
    const mat = new THREE.MeshBasicMaterial({
      map: projectileTexture,
      transparent: true,
      depthWrite: false,
    });
    mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    projectileScene.add(mesh);
  }

  const proj: DynamiteProjectile = { body, mesh, fuseLeft, spawnTime: now };
  liveProjectiles.push(proj);
  return proj;
}

/** Advance all projectiles; detonate any whose fuse hit zero. Call per fixed step. */
export function updateProjectiles(ctx: FrameCtx, dt: number): void {
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i]!;
    p.fuseLeft -= dt;
    const t = p.body.translation();
    if (p.mesh) {
      p.mesh.position.set(t.x, t.y, t.z);
      if (projectileCamera) p.mesh.lookAt(projectileCamera.position);
    }
    if (p.fuseLeft <= 0) {
      ctx.gibs.spawnExplosion({ x: t.x, y: t.y, z: t.z }, EXPLOSION_STANDARD, ctx.now);
      if (p.mesh) {
        projectileScene?.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
      }
      ctx.world.removeRigidBody(p.body);
      liveProjectiles.splice(i, 1);
    }
  }
}

export function resetProjectiles(world: RAPIER.World): void {
  for (const p of liveProjectiles) {
    if (p.mesh) {
      projectileScene?.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    world.removeRigidBody(p.body);
  }
  liveProjectiles.length = 0;
}

// ——— Weapon implementation ————————————————————————————

export class Dynamite implements Weapon {
  readonly id = 'dynamite';
  readonly ammoMax = Number.POSITIVE_INFINITY;
  ammo = Number.POSITIVE_INFINITY;

  private cooking = false;
  private cookStart = 0;
  private throwingUntil = 0;

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0 || this.cooking || ctx.now < this.throwingUntil) return;
    this.cooking = true;
    this.cookStart = ctx.now;
    ctx.fpAnimator?.play('dynamite-idle', ctx.now);
  }

  onRelease(ctx: FrameCtx): void {
    if (!this.cooking) return;
    const heldSec = ctx.now - this.cookStart;
    const frac = chargeFraction(heldSec);
    const speed = throwVelocityMps(frac);
    const fuseLeft = Math.max(0, remainingFuse(heldSec));

    // Blood's throw is aim-relative: forward rotated upward by ~30° around the
    // player's right axis, then scaled by speed. See throwVector docstring.
    const vel = throwVector(ctx.player.forward, speed);
    spawnProjectile(ctx.world, ctx.player.handPos, vel, fuseLeft, ctx.now);

    this.ammo--;
    this.cooking = false;
    this.throwingUntil = ctx.now + 0.3; // throw anim duration
    ctx.fpAnimator?.restart('dynamite-throw', ctx.now);
  }

  onFrame(ctx: FrameCtx, dt: number): void {
    // Over-cook self-gib
    if (this.cooking && (ctx.now - this.cookStart) >= DYNAMITE_COOK.fuseMaxSec) {
      ctx.gibs.spawnExplosion(ctx.player.pos, EXPLOSION_STANDARD, ctx.now);
      this.cooking = false;
      ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
    }
    // Return to idle after throw animation finishes
    if (!this.cooking && this.throwingUntil > 0 && ctx.now >= this.throwingUntil) {
      this.throwingUntil = 0;
      ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
    }
    updateProjectiles(ctx, dt);
  }

  chargeFraction(): number {
    if (!this.cooking) return 0;
    // Static snapshot — HUD should prefer chargeFractionAt(now)
    return 0;
  }

  /** Live fraction (HUD uses this; we expose it cleanly). */
  chargeFractionAt(now: number): number {
    if (!this.cooking) return 0;
    return chargeFraction(now - this.cookStart);
  }

  isCooking(): boolean { return this.cooking; }

  renderView(_ctx: ViewCtx): void { /* wired in Task 11 */ }
  renderHud(_ctx: HudCtx): void { /* wired in Task 11 */ }
}
