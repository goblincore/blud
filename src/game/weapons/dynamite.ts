import * as THREE from 'three';
import type { Weapon, FrameCtx, ViewCtx, HudCtx } from './types';
import { DYNAMITE_COOK, EXPLOSION_STANDARD } from '../gibs/tuning';
import { SfxEvent } from '../../audio/events';

// ——— Projectile billboard rendering (flying dynamite bundle sprite) ————
//
// Authentic Blood behavior (see docs/dev-notes/2026-04-22-notblood-source-reference.md,
// "Thrown TNT projectile in flight" section):
//   - Thrown bundle is a face-aligned billboard (cstat=256, no alignment flags).
//   - pSprite->ang is set once at spawn and never updated — no tumble.
//   - "Liveness" comes from SEQ-driven picnum cycling through fuse-burn frames
//     (bundle frames 3432→3435; stick frames 3422→3427).
//
// Billboard rendering now driven by sim.projectileRenders() in main.ts;
// configureProjectileRendering/setProjectileCamera supply the fuse-frame textures
// and camera reference for the main.ts render loop to use.

let projectileFrames: THREE.Texture[] = [];
let projectileCamera: THREE.Camera | null = null;

/** Access the shared fuse-frame textures (used by main.ts billboard render loop). */
export function getProjectileFrames(): THREE.Texture[] { return projectileFrames; }
export function getProjectileCamera(): THREE.Camera | null { return projectileCamera; }

/**
 * Configure the shared resources used by all live projectiles.
 *
 * @param frames Ordered list of fuse-burn frame textures, from "just-thrown"
 *   (full fuse) to "about-to-detonate" (fuse exhausted). Blood bundle order:
 *   3432 → 3433 → 3434 → 3435. A single-element array is valid (no cycling).
 */
export function configureProjectileRendering(_scene: THREE.Scene, frames: THREE.Texture[]): void {
  projectileFrames = frames;
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
 * Select which fuse-burn frame to show given remaining fuse.
 *
 * Maps fuse-remaining fraction to a frame index: full fuse → frame 0, no fuse
 * left → last frame. Matches Blood SEQ progression for bundle tiles
 * 3432 (fresh) → 3435 (about to detonate).
 *
 * Pure function, TDD'd.
 */
export function fuseFrameIndex(fuseLeft: number, fuseMax: number, numFrames: number): number {
  if (numFrames <= 1) return 0;
  if (fuseMax <= 0) return numFrames - 1;
  const frac = Math.max(0, Math.min(1, fuseLeft / fuseMax));
  const idx = Math.floor((1 - frac) * numFrames);
  return Math.min(idx, numFrames - 1);
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
  forward: { x: number; y: number; z: number },
  speed: number,
  pitchLobDeg: number = DYNAMITE_COOK.pitchLobDeg,
): { x: number; y: number; z: number } {
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

// ——— Weapon implementation ————————————————————————————

// Blood QAV mapping (see docs/dev-notes/2026-04-22-notblood-source-reference.md):
//   dynamite-raise     = BUNUP2 (10 frames, 420ms) — weapon-equip animation: hands rise
//                        into view, lighter flicks, flame meets wick, bundle settles into
//                        hold pose. Plays ONCE on equip (not on every trigger press).
//   dynamite-idle      = BUNIDLE (6 frames, loops) — idle holding pose, fuse visually lit,
//                        waiting for trigger press.
//   dynamite-fuse-burn = BUNFUSE (66 frames, time-scaled to 1980ms to fit our 2s fuseMaxSec) —
//                        authentic fuse-burndown with sparks appearing near the end; non-looping so
//                        the animation visibly climaxes right before the state machine self-explodes.
//   dynamite-throw     = BUNTHRO (17 frames, 714ms)
type DynPhase = 'equipping' | 'idle' | 'cooking' | 'throwing';

const PHASE_DURATIONS = {
  equippingMs: 420,  // BUNUP2 runtime
  throwingMs: 336,
} as const;

export class Dynamite implements Weapon {
  readonly id = 'dynamite';
  readonly ammoMax = Number.POSITIVE_INFINITY;
  ammo = Number.POSITIVE_INFINITY;

  /**
   * Hook wired from main.ts: called on throw to spawn a sim projectile.
   * Dynamite only knows the throw speed (from charge fraction) and the mode
   * (primary = impact-detonate; future alt-fire = pure fuse). Everything else —
   * eye position, aim yaw/pitch, fuseTics — is captured by the main.ts closure.
   *
   * @param speedMps  throw speed m/s derived from the cook charge
   * @param impact    true = impact-detonate mode; false = pure fuse countdown
   */
  throwHook: ((speedMps: number, impact: boolean) => void) | null = null;

  // New weapon instance always starts by equipping — either at game boot or
  // (future) on weapon-switch from another weapon. Lazy-inits in onFrame.
  private _phase: DynPhase = 'equipping';
  private phaseEnteredAt = -1;  // sentinel: lazy-init on first onFrame
  private cookStart = 0;
  private _fuseHissSrc: AudioBufferSourceNode | null = null;

  phase(): DynPhase { return this._phase; }

  /** Called by WeaponRegistry when switching TO the dynamite. Resets to equipping phase. */
  equip(ctx: FrameCtx): void {
    this._fuseHissSrc?.stop();
    this._fuseHissSrc = null;
    this.enter('equipping', ctx);
  }

  /** Called by WeaponRegistry when switching AWAY from the dynamite. Kills fuse hiss. */
  unequip(_ctx: FrameCtx): void {
    this._fuseHissSrc?.stop();
    this._fuseHissSrc = null;
  }

  /** Fuse is visually lit from the moment BUNUP2 completes (end of equipping) onward. */
  isFuseLit(): boolean {
    return this._phase === 'idle' || this._phase === 'cooking' || this._phase === 'throwing';
  }

  onPress(ctx: FrameCtx): void {
    if (this.ammo <= 0) return;
    // Trigger only works from idle — during equipping, throwing, or cooking it's a no-op.
    if (this._phase !== 'idle') return;
    this.cookStart = ctx.now;
    this.enter('cooking', ctx);
  }

  onRelease(ctx: FrameCtx): void {
    if (this._phase !== 'cooking') return;
    this.doThrow(ctx);
  }

  onFrame(ctx: FrameCtx, _dt: number): void {
    // Lazy init: first frame we see, enter the starting phase properly so the animator
    // gets the equip animation and phaseEnteredAt gets a valid timestamp.
    if (this.phaseEnteredAt < 0) {
      this.enter(this._phase, ctx);
    }

    const elapsedMs = (ctx.now - this.phaseEnteredAt) * 1000;

    switch (this._phase) {
      case 'equipping':
        if (elapsedMs >= PHASE_DURATIONS.equippingMs) {
          this.enter('idle', ctx);
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
  }

  private enter(next: DynPhase, ctx: FrameCtx): void {
    this._phase = next;
    this.phaseEnteredAt = ctx.now;
    // Stop looping fuse hiss on any phase exit (throwing / idle / overcook explosion)
    if (next === 'throwing' || next === 'idle') {
      this._fuseHissSrc?.stop();
      this._fuseHissSrc = null;
    }
    switch (next) {
      case 'equipping':
        ctx.fpAnimator?.restart('dynamite-raise', ctx.now);
        ctx.sfx?.play(SfxEvent.LIGHTER_STRIKE);
        break;
      case 'idle':
        ctx.fpAnimator?.restart('dynamite-idle', ctx.now);
        break;
      case 'cooking':
        ctx.fpAnimator?.restart('dynamite-fuse-burn', ctx.now);
        {
          const src = ctx.sfx?.play(SfxEvent.FUSE_HISS) ?? null;
          if (src) { src.loop = true; this._fuseHissSrc = src; }
        }
        break;
      case 'throwing':
        ctx.fpAnimator?.restart('dynamite-throw', ctx.now);
        ctx.sfx?.play(SfxEvent.THROW_GRUNT);
        break;
    }
  }

  private doThrow(ctx: FrameCtx): void {
    const heldSec = ctx.now - this.cookStart;
    const frac = chargeFraction(heldSec);
    const speed = throwVelocityMps(frac);
    // Primary-fire = impact-detonate (NotBlood weapon.cpp:2728 → ThrowBundle's
    // pXSprite->Impact=1 path). Cook still drives throw velocity; the in-flight
    // fuse is repurposed as a safety timeout — if the bundle misses everything,
    // it still detonates after IMPACT_SAFETY_FUSE_SEC. 5s is generous and lets
    // a fully-cooked-then-thrown bundle clear the entire arena before fallback.
    //
    // The throwHook is wired from main.ts → sim.spawnProjectile. Main.ts captures
    // the current eye position, aimYaw, aimPitch, and fuseTics via closure. If the
    // hook is not wired (unit tests), the throw is a no-op at the projectile level —
    // the ammo/phase transition still happens correctly.
    this.throwHook?.(speed, /*impactMode=*/true);
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
