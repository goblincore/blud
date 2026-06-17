import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Weapon, FrameCtx, ViewCtx, HudCtx } from './types';
import type { Vec3 } from '../gibs/particles';
import { FLARE_GUN } from '../gibs/tuning';
import { SfxEvent } from '../../audio/events';

// ——— Pure math (TDD'd) ————————————————————————————

/**
 * Arc position of a flare projectile at time t under gravity.
 * Standard parabolic motion: pos = spawn + vel*t + 0.5*g*t²
 * where gravity points down (-Y).
 */
export function flareArcPosition(spawnPos: Vec3, vel: Vec3, t: number, gravity: number): Vec3 {
  return {
    x: spawnPos.x + vel.x * t,
    y: spawnPos.y + vel.y * t - 0.5 * gravity * t * t,
    z: spawnPos.z + vel.z * t,
  };
}

export function isProjectileActive(phase: FlarePhase): boolean {
  return phase === 'projectile';
}

export function raisingComplete(elapsedMs: number, raisingMs: number): boolean {
  return elapsedMs >= raisingMs;
}

// ——— FSM types ————————————————————————————————————

export type FlarePhase = 'idle' | 'raising' | 'projectile';

interface FlareProjectile {
  spawnPos: Vec3;
  vel: Vec3;
  spawnTime: number;
  /** Previous frame's position — origin of the per-frame segment-sweep collision. */
  lastPos: Vec3;
}

/** Maximum travel distance before the projectile is extinguished (void-collision). */
const FLARE_MAX_RANGE_M = 60;

// ——— Projectile billboard rendering —————————————————

/** Tile getter type — matches the shared texture cache in main.ts. */
export type TileTextureGetter = (picnum: number) => THREE.Texture;

let projectileScene: THREE.Scene | null = null;
let projectileTexture: THREE.Texture | null = null;
let projectileCamera: THREE.Camera | null = null;

/**
 * Configure the shared resources used by the flare projectile billboard.
 * Mirrors dynamite.ts's `configureProjectileRendering`.
 */
export function configureProjectileRendering(deps: {
  scene: THREE.Scene;
  getTileTexture: (picnum: number) => THREE.Texture;
}): void {
  projectileScene = deps.scene;
  projectileTexture = deps.getTileTexture(2424); // kMissileFlareRegular picnum
}

export function setProjectileCamera(cam: THREE.Camera): void {
  projectileCamera = cam;
}

/**
 * Create a flare projectile billboard mesh.
 * Blood tile 2424 is 32×32 px — rendered at 0.3m wide in-world.
 */
function createProjectileMesh(): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(0.3, 0.3);
  const mat = new THREE.MeshBasicMaterial({
    map: projectileTexture,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ——— Weapon implementation ————————————————————————

export class FlareGun implements Weapon {
  readonly id = 'flare';
  readonly ammoMax: number = FLARE_GUN.ammoMax;
  ammo: number = this.ammoMax;

  private _phase: FlarePhase = 'idle';
  private phaseEnteredAt: number = -1;
  private projectile: FlareProjectile | null = null;
  private projectileMesh: THREE.Mesh | null = null;

  // Hooks for collision detection + StuckFlare spawning. Set externally
  // (e.g. by main.ts which has the RAPIER world).
  spawnStuckFlare?: (pos: Vec3, attachedBody: RAPIER.RigidBody | null) => void;
  raycastFn?: (from: Vec3, dir: Vec3, maxDist: number) => { pos: Vec3; body: RAPIER.RigidBody | null } | null;

  phase(): FlarePhase { return this._phase; }

  /** Called by main.ts when the player switches TO the flare gun. */
  equip(ctx: FrameCtx): void {
    ctx.fpAnimator?.restart('flare-raise', ctx.now);
  }

  /** Called by main.ts when the player switches AWAY from the flare gun. */
  unequip(ctx: FrameCtx): void {
    ctx.fpAnimator?.restart('flare-lower', ctx.now);
  }

  chargeFraction(): number {
    if (this._phase !== 'raising') return 0;
    return 0; // no charge mechanic — raising is a fixed delay, not variable
  }

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0) return;
    if (this._phase !== 'idle') return;
    ctx.fpAnimator?.restart('flare-fire', ctx.now);
    this._phase = 'raising';
    this.phaseEnteredAt = ctx.now;
    ctx.sfx?.play(SfxEvent.FLARE_SHOOT);
  }

  onRelease(_ctx: FrameCtx): void {
    // No-op: flare commits once raising completes — no release-cancel.
  }

  onFrame(ctx: FrameCtx, dt: number): void {
    // Lazy init: first frame sets the start time.
    if (this.phaseEnteredAt < 0) {
      this.phaseEnteredAt = ctx.now;
    }

    const elapsedMs = (ctx.now - this.phaseEnteredAt) * 1000;

    switch (this._phase) {
      case 'raising':
        if (raisingComplete(elapsedMs, FLARE_GUN.raisingMs)) {
          this.fire(ctx);
        }
        break;
      case 'projectile':
        this.advanceProjectile(ctx, dt);
        break;
      case 'idle':
        break;
    }
  }

  private fire(ctx: FrameCtx): void {
    const fwd = ctx.player.forward;
    const vel: Vec3 = {
      x: fwd.x * FLARE_GUN.muzzleVelMps,
      y: fwd.y * FLARE_GUN.muzzleVelMps,
      z: fwd.z * FLARE_GUN.muzzleVelMps,
    };
    this.projectile = {
      spawnPos: { ...ctx.player.handPos },
      vel,
      spawnTime: ctx.now,
      lastPos: { ...ctx.player.handPos },
    };
    this.ammo--;
    this._phase = 'projectile';
    this.phaseEnteredAt = ctx.now;

    // Spawn the projectile billboard mesh
    if (projectileScene && projectileTexture) {
      this.projectileMesh = createProjectileMesh();
      projectileScene.add(this.projectileMesh);
    }
  }

  private advanceProjectile(ctx: FrameCtx, _dt: number): void {
    if (!this.projectile) return;
    const t = ctx.now - this.projectile.spawnTime;

    // Lifetime safety net (defense in depth): guarantee a flare can never
    // live forever even if it threads through all geometry. The per-frame
    // floor/wall collision below is the PRIMARY despawn; this is secondary.
    if (t > FLARE_GUN.maxLifetimeSec) {
      console.warn('[flare] projectile exceeded max lifetime — extinguishing');
      this.extinguish(ctx);
      return;
    }

    const newPos = flareArcPosition(
      this.projectile.spawnPos,
      this.projectile.vel,
      t,
      FLARE_GUN.gravityMps2,
    );

    // Update projectile billboard position
    if (this.projectileMesh && projectileCamera) {
      this.projectileMesh.position.set(newPos.x, newPos.y, newPos.z);
      this.projectileMesh.lookAt(projectileCamera.position);
      this.projectileMesh.visible = true;
    }

    // Per-frame SEGMENT SWEEP: raycast from the previous frame's position to
    // the current one. This mirrors NotBlood's frame-by-frame clipmove
    // (actor.cpp MoveMissile) so a descending arc actually intersects the
    // floor/walls it falls into. The old spawn→current chord stopped pointing
    // at the floor once the arc passed its apex, so the flare sailed through
    // the ground and never resolved.
    const lastPos = this.projectile.lastPos;
    const segVec = {
      x: newPos.x - lastPos.x,
      y: newPos.y - lastPos.y,
      z: newPos.z - lastPos.z,
    };
    const segLen = Math.hypot(segVec.x, segVec.y, segVec.z);

    if (segLen >= 1e-4) {
      const segDir = { x: segVec.x / segLen, y: segVec.y / segLen, z: segVec.z / segLen };
      const hit = this.raycastFn?.(lastPos, segDir, segLen);
      if (hit) {
        this.spawnStuckFlare?.(hit.pos, hit.body);
        ctx.sfx?.play(SfxEvent.FLARE_IMPACT, hit.pos);
        this.extinguish(ctx);
        return;
      }
      this.projectile.lastPos = newPos;
    }

    // World-bounds escape: silently extinguish if the projectile has traveled
    // too far from its spawn (secondary to collision + lifetime).
    const distFromSpawn = Math.hypot(
      newPos.x - this.projectile.spawnPos.x,
      newPos.y - this.projectile.spawnPos.y,
      newPos.z - this.projectile.spawnPos.z,
    );
    if (distFromSpawn > FLARE_MAX_RANGE_M) {
      console.warn('[flare] projectile left world bounds — extinguishing');
      this.extinguish(ctx);
    }
  }

  /** Render hook — concrete renderer reads `getProjectilePos()` to draw the bundle sprite. */
  getProjectilePos(now: number): Vec3 | null {
    if (!this.projectile) return null;
    const t = now - this.projectile.spawnTime;
    return flareArcPosition(this.projectile.spawnPos, this.projectile.vel, t, FLARE_GUN.gravityMps2);
  }

  /** Hide and clean up the projectile billboard mesh. */
  private hideProjectileMesh(): void {
    if (this.projectileMesh) {
      projectileScene?.remove(this.projectileMesh);
      this.projectileMesh.geometry.dispose();
      (this.projectileMesh.material as THREE.Material).dispose();
      this.projectileMesh = null;
    }
  }

  /** Teardown shared by every despawn path (collision / range / lifetime). */
  private extinguish(ctx: FrameCtx): void {
    this.hideProjectileMesh();
    ctx.fpAnimator?.restart('flare-idle', ctx.now);
    this.projectile = null;
    this._phase = 'idle';
    this.phaseEnteredAt = ctx.now;
  }

  /** True if there is an active projectile in flight. */
  hasProjectile(): boolean {
    return this.projectile !== null;
  }

  renderView(_ctx: ViewCtx): void {
    // handled by fpAnimator
  }

  renderHud(_ctx: HudCtx): void {
    // TODO: ammo readout
  }
}
