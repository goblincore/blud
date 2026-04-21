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
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setLinearDamping(0.05)
    .setAngularDamping(0.2);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.ball(0.1)
    .setRestitution(0.5)
    .setFriction(0.6);
  world.createCollider(colliderDesc, body);
  body.setLinvel(vel, true);
  body.setAngvel({ x: Math.random() * 5, y: Math.random() * 5, z: Math.random() * 5 }, true);

  let mesh: THREE.Mesh | null = null;
  if (projectileScene && projectileTexture) {
    const geom = new THREE.PlaneGeometry(0.35, 0.35);
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

    const vel = {
      x: ctx.player.forward.x * speed,
      y: ctx.player.forward.y * speed + 2.5,  // lob arc: up-bias
      z: ctx.player.forward.z * speed,
    };
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
