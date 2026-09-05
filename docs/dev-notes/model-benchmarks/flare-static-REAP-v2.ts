import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Weapon, FrameCtx, ViewCtx, HudCtx } from './types';
import type { Vec3 } from '../gibs/particles';
import { SfxEvent } from '../../audio/events';

// ——— Pure math (TDD'd) ————————————————————————————————

/** Seconds remaining on a burn timer. Returns 0 when expired. */
export function burnRemainingSec(burnSec: number, elapsedSec: number): number {
  return Math.max(0, burnSec - elapsedSec);
}

/** True when the weapon's phase is projectile-in-flight. */
export function isProjectileActive(phase: string): boolean {
  return phase === 'projectile';
}

/** True when the flare has ignited and is burning. */
export function hasIgnited(phase: string): boolean {
  return phase === 'burning';
}

/**
 * Compute flare's current position.
 *
 * During projectile flight: position follows v*t + 0.5*g*t^2 (gravity on Y only).
 * During burning: position is the collision/impact point.
 * In other phases: returns the flare's spawn position (player's hand).
 */
export function flarePosition(
  phase: string,
  spawnPos: Vec3,
  projVel: Vec3 | null,
  projSpawnTime: number,
  impactPos: Vec3 | null,
  now: number,
): Vec3 {
  if (phase === 'burning' && impactPos) {
    return { ...impactPos };
  }
  if (phase === 'projectile' && projVel) {
    const t = now - projSpawnTime;
    return {
      x: projVel.x * t + spawnPos.x,
      y: projVel.y * t - 0.5 * GRAVITY * t * t + spawnPos.y,
      z: projVel.z * t + spawnPos.z,
    };
  }
  return { ...spawnPos };
}

// ——— Constants ————————————————————————————————

const GRAVITY = 9.81; // m/s² (downward in Y; our coord system is Y-up)
const FLARE_SPEED_MPS = 25; // muzzle velocity
const BURN_DURATION_SEC = 6;

// ——— Per-shot projectile entity ————————————————————————

interface FlareProjectile {
  vel: Vec3;
  spawnPos: Vec3;
  spawnTime: number;
}

/** Global registry of active flares-in-flight; ticked each frame from flare.ts */
const liveProjectiles: FlareProjectile[] = [];

/** Spawn a flare projectile. */
export function spawnProjectile(pos: Vec3, vel: Vec3, now: number): FlareProjectile {
  const proj: FlareProjectile = { vel, spawnPos: { ...pos }, spawnTime: now };
  liveProjectiles.push(proj);
  return proj;
}

/** Advance all projectiles; remove expired ones. Call per fixed step. */
export function updateProjectiles(ctx: FrameCtx, dt: number): void {
  for (let i = liveProjectiles.length - 1; i >= 0; i--) {
    const p = liveProjectiles[i]!;
    if (ctx.now - p.spawnTime >= BURN_DURATION_SEC) {
      liveProjectiles.splice(i, 1);
    }
  }
}

/** Clear the global projectile registry. */
export function resetProjectiles(): void {
  liveProjectiles.length = 0;
}

// ——— Weapon implementation ————————————————————————————

type FlarePhase = 'idle' | 'raising' | 'projectile' | 'burning';

const PHASE_DURATIONS = {
  raisingMs: 300,
} as const;

export class FlareGun implements Weapon {
  readonly id = 'flare';
  readonly ammoMax = 10;
  ammo = this.ammoMax;

  private _phase: FlarePhase = 'idle';
  private phaseEnteredAt = 0;
  private projVel: Vec3 | null = null;
  private projSpawnTime = 0;
  private impactPos: Vec3 | null = null;
  private _burnStartedAt = 0;
  private _burnTotalSec = BURN_DURATION_SEC;

  phase(): FlarePhase { return this._phase; }

  isIgnited(): boolean { return this._phase === 'burning'; }

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0) return;
    if (this._phase !== 'idle') return;
    this.phaseEnteredAt = ctx.now;
    this._phase = 'raising';
    ctx.fpAnimator?.restart('flare-raise', ctx.now);
    ctx.sfx?.play(SfxEvent.FLARE_RAISE);
  }

  onRelease(_ctx: FrameCtx): void {
    // No charge mechanic — flare is fast, not held.
    // Transition is automatic via onFrame when raising duration expires.
  }

  onFrame(ctx: FrameCtx, dt: number): void {
    const elapsedSec = ctx.now - this.phaseEnteredAt;
    const elapsedMs = elapsedSec * 1000;

    switch (this._phase) {
      case 'raising':
        if (elapsedMs >= PHASE_DURATIONS.raisingMs) {
          this.fire(ctx);
        }
        break;
      case 'projectile':
        if (this.impactPos) {
          this._burnStartedAt = ctx.now;
          this._phase = 'burning';
          this.phaseEnteredAt = ctx.now;
          ctx.sfx?.play(SfxEvent.FLARE_IGNITE, {
            x: this.impactPos.x,
            y: this.impactPos.y,
            z: this.impactPos.z,
          });
        }
        break;
      case 'burning':
        if (burnRemainingSec(this._burnTotalSec, elapsedSec) <= 0) {
          this._phase = 'idle';
          this.phaseEnteredAt = ctx.now;
          this.projVel = null;
          this.projSpawnTime = 0;
          this.impactPos = null;
          this._burnStartedAt = 0;
          this._burnTotalSec = BURN_DURATION_SEC;
        }
        break;
      case 'idle':
        break;
    }

    updateProjectiles(ctx, dt);
  }

  /**
   * Trigger projectile collision (called by Rapier collision callbacks).
   * @internal — tests can reach via (weapon as any).triggerCollision(...)
   */
  triggerCollision(ctx: FrameCtx, pos: Vec3): void {
    if (this._phase !== 'projectile') return;
    this.impactPos = { ...pos };
    ctx.sfx?.play(SfxEvent.FLARE_IMPACT, { x: pos.x, y: pos.y, z: pos.z });
  }

  private fire(ctx: FrameCtx): void {
    if (this._phase !== 'raising') return;
    this.projVel = { ...ctx.player.forward };
    this.projSpawnTime = ctx.now;
    spawnProjectile(ctx.player.handPos, this.projVel, ctx.now);
    this.ammo--;
    this._phase = 'projectile';
    this.phaseEnteredAt = ctx.now;
    this.impactPos = null;
    ctx.fpAnimator?.restart('flare-fire', ctx.now);
    ctx.sfx?.play(SfxEvent.FLARE_SHOOT);
  }

  chargeFraction(): number { return 0; }
  renderView(_ctx: ViewCtx): void { /* handled by fpAnimator */ }
  renderHud(_ctx: HudCtx): void { /* handled by ChargeHud */ }
}
