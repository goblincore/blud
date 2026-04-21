import RAPIER from '@dimforge/rapier3d-compat';
import type { Weapon, FrameCtx, ViewCtx, HudCtx } from './types';
import type { Vec3 } from '../gibs/particles';
import { DYNAMITE_COOK, EXPLOSION_STANDARD } from '../gibs/tuning';

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

  const proj: DynamiteProjectile = { body, fuseLeft, spawnTime: now };
  liveProjectiles.push(proj);
  return proj;
}

/** Advance all projectiles; detonate any whose fuse hit zero. Call per fixed step. */
export function updateProjectiles(ctx: FrameCtx, dt: number): void {
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i]!;
    p.fuseLeft -= dt;
    if (p.fuseLeft <= 0) {
      const t = p.body.translation();
      ctx.gibs.spawnExplosion({ x: t.x, y: t.y, z: t.z }, EXPLOSION_STANDARD, ctx.now);
      ctx.world.removeRigidBody(p.body);
      liveProjectiles.splice(i, 1);
    }
  }
}

export function resetProjectiles(world: RAPIER.World): void {
  for (const p of liveProjectiles) world.removeRigidBody(p.body);
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
