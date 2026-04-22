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
    // Bundle silhouette: horizontal wrapped-stick bundle with lit fuse.
    // Blood tile 3433 is ~48×16 px — wider than tall.
    const geom = new THREE.PlaneGeometry(0.42, 0.18);
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

// Blood QAV mapping (see docs/dev-notes/2026-04-22-notblood-source-reference.md):
//   dynamite-raise   = BUNUP2 (10 frames, 420ms) — raise + lighter-flick + ignite + bundle reveal, all in one continuous animation.
//                      Fuse is visually lit by the final frame (tile 3219). No separate ignite state.
//   dynamite-idle    = BUNIDLE (6 frames, loops) — cooking-state hold, fuse lit, flame tiles cycle.
//                      (Ideally we'd play BUNFUSE here for the authentic fuse-burndown visual — see P7 in TASKS.md.)
//   dynamite-throw   = BUNTHRO (17 frames, 714ms)
type DynPhase = 'idle' | 'raising' | 'cooking' | 'throwing';

const PHASE_DURATIONS = {
  raisingMs: 420,   // let BUNUP2 play to completion so the ignite visual finishes
  throwingMs: 336,
} as const;

export class Dynamite implements Weapon {
  readonly id = 'dynamite';
  readonly ammoMax = Number.POSITIVE_INFINITY;
  ammo = Number.POSITIVE_INFINITY;

  private _phase: DynPhase = 'idle';
  private phaseEnteredAt = 0;
  private cookStart = 0;
  private pendingRelease = false;

  phase(): DynPhase { return this._phase; }

  /** True once the BUNUP2 animation completes — visually and behaviorally, the fuse is lit from `cooking` onward. */
  isFuseLit(): boolean { return this._phase === 'cooking' || this._phase === 'throwing'; }

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0) return;
    if (this._phase !== 'idle') return;
    this.enter('raising', ctx);
  }

  onRelease(ctx: FrameCtx): void {
    // Released while BUNUP2 is still playing: queue the release so it resolves on raise-complete.
    // On raise end we honor it by throwing at min charge (fuse-just-lit = ~max remaining fuse).
    if (this._phase === 'raising') {
      this.pendingRelease = true;
      return;
    }
    if (this._phase === 'cooking') {
      this.doThrow(ctx);
    }
  }

  onFrame(ctx: FrameCtx, dt: number): void {
    const elapsedMs = (ctx.now - this.phaseEnteredAt) * 1000;

    switch (this._phase) {
      case 'raising':
        if (elapsedMs >= PHASE_DURATIONS.raisingMs) {
          // BUNUP2 finished — fuse is now visually lit. Start the cook clock and either throw (if release queued) or cook.
          this.cookStart = ctx.now;
          if (this.pendingRelease) {
            this.pendingRelease = false;
            this.doThrow(ctx);
          } else {
            this.enter('cooking', ctx);
          }
        }
        break;
      case 'cooking': {
        const heldSec = ctx.now - this.cookStart;
        if (heldSec >= DYNAMITE_COOK.fuseMaxSec) {
          ctx.gibs.spawnExplosion(ctx.player.pos, EXPLOSION_STANDARD, ctx.now);
          this.enter('idle', ctx);
        }
        break;
      }
      case 'throwing':
        if (elapsedMs >= PHASE_DURATIONS.throwingMs) {
          this.enter('idle', ctx);
        }
        break;
    }

    updateProjectiles(ctx, dt);
  }

  private enter(next: DynPhase, ctx: FrameCtx): void {
    this._phase = next;
    this.phaseEnteredAt = ctx.now;
    switch (next) {
      case 'raising':
        ctx.fpAnimator?.restart('dynamite-raise', ctx.now);
        break;
      case 'cooking':
        ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
        break;
      case 'throwing':
        ctx.fpAnimator?.restart('dynamite-throw', ctx.now);
        break;
      case 'idle':
        this.pendingRelease = false;
        ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
        break;
    }
  }

  private doThrow(ctx: FrameCtx): void {
    const heldSec = ctx.now - this.cookStart;
    const frac = chargeFraction(heldSec);
    const speed = throwVelocityMps(frac);
    const fuseLeft = Math.max(0, remainingFuse(heldSec));
    const vel = throwVector(ctx.player.forward, speed);
    spawnProjectile(ctx.world, ctx.player.handPos, vel, fuseLeft, ctx.now);
    this.ammo--;
    this.enter('throwing', ctx);
  }

  chargeFraction(): number { return 0; }

  chargeFractionAt(now: number): number {
    if (this._phase !== 'cooking') return 0;
    return chargeFraction(now - this.cookStart);
  }

  isCooking(): boolean { return this._phase === 'cooking'; }

  renderView(_ctx: ViewCtx): void { /* handled by fpAnimator */ }
  renderHud(_ctx: HudCtx): void { /* handled by ChargeHud */ }
}
