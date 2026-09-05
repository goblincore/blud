/**
 * Ranged AI brain for Tommy-gun cultist enemies.
 *
 * State machine pattern mirrors ZombieBrain — dt-driven state transitions
 * via accumulated timers, no rendering dependency.
 *
 * Reference: Blood kDudeCultistTommy (actor id 201).
 */

import type { Vec3 } from '../gibs/particles';
import { CULTIST_TOMMY } from '../gibs/tuning';

// ─── State Enum ────────────────────────────────────────────────────────────

export enum CultistState {
  Idle = 'idle',
  Chase = 'chase',
  Aim = 'aim',
  Shoot = 'shoot',
  Reload = 'reload',
  Stagger = 'stagger',
  Dead = 'dead',
}

// ─── Hooks Interface ───────────────────────────────────────────────────────

/** Callbacks for brain → gameplay SFX wiring (mirrors BrainHooks for axe-zombie). */
export interface CultistBrainHooks {
  onAggroTransition?: () => void;
  onShot?: () => void;
}

// ─── Brain Class ───────────────────────────────────────────────────────────

export class CultistBrain {
  state: CultistState = CultistState.Idle;
  hp: number;
  readonly speed: number;

  // Timers
  private aimTimer = 0;           // accumulates toward aim windup completion
  private shotIndex = 0;          // 0..shotsPerBurst-1 within a burst
  private shotCooldown = 0;       // shot-level cooldown (reset per burst)
  private reloadTimer = 0;        // reload countdown
  private staggerTimer = 0;       // stagger countdown
  private postStaggerSec = 0;     // recovery time before re-engaging
  private hitPending = false;     // flag for consumeShot()
  private prevShot = false;       // track if last frame ended in Shoot (for reload detection)

  constructor(
    init: { hp: number; speed: number },
    private readonly hooks?: CultistBrainHooks,
  ) {
    this.hp = init.hp;
    this.speed = init.speed;
  }

  /** Advance the AI by `dt` seconds. */
  update(dt: number, _self: Vec3, player: Vec3): void {
    if (this.state === CultistState.Dead) return;

    if (this.hp <= 0) {
      this.state = CultistState.Dead;
      return;
    }

    // ── Stagger ──────────────────────────────────────────────────────────
    if (this.state === CultistState.Stagger) {
      this.staggerTimer -= dt;
      if (this.staggerTimer <= 0) {
        this.state = this.prevShot ? CultistState.Shoot : CultistState.Aim;
      }
      return;
    }

    if (this.postStaggerSec > 0) {
      this.postStaggerSec -= dt;
      return;
    }

    // ── Reload ───────────────────────────────────────────────────────────
    if (this.state === CultistState.Reload) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        // Player still in preferred range → go back to aim; otherwise chase
        this.shotIndex = 0;
        this.shotCooldown = 0;
        if (this.prevShot) {
          this.state = CultistState.Shoot;
        } else {
          this.state = CultistState.Aim;
        }
      }
      return;
    }

    // ── Aim windup ───────────────────────────────────────────────────────
    if (this.state === CultistState.Aim) {
      this.aimTimer -= dt;
      if (this.aimTimer <= 0) {
        this.state = CultistState.Shoot;
      }
      return;
    }

    // ── Shoot ────────────────────────────────────────────────────────────
    if (this.state === CultistState.Shoot) {
      this.shotCooldown -= dt;
      if (this.shotCooldown <= 0 && this.shotIndex < this.shotsPerBurst) {
        // Fire one shot
        this.shotIndex++;
        this.shotCooldown = this.shotIntervalMs / 1000;
        this.prevShot = true;
      }

      // After firing all shots → Reload
      if (this.shotIndex >= this.shotsPerBurst) {
        this.state = CultistState.Reload;
        this.reloadTimer = this.reloadSec;
      }
      return;
    }

    // ── Chase / Idle ──────────────────────────────────────────────────────
    // Only reached after stagger recovery
    const d = distance(_self, player);

    if (this.state === CultistState.Idle) {
      if (d < this.detectionRangeM) {
        this.state = CultistState.Chase;
      }
      return;
    }

    if (this.state === CultistState.Chase) {
      if (d <= this.preferredRangeM) {
        this.state = CultistState.Aim;
      } else {
        this.state = CultistState.Idle;
      }
      return;
    }

    // Shoot, Reload, Stagger — handled above
  }

  /**
   * Apply damage to this cultist's hp. Triggers stagger (if not dead) or
   * Dead (if hp drops to 0 or below).
   */
  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.state = CultistState.Dead;
    } else {
      this.state = CultistState.Stagger;
      this.staggerTimer = this.staggerSec;
    }
  }

  /**
   * Returns true if `takeDamage` was called this step (dead).
   */
  isDead(): boolean {
    return this.state === CultistState.Dead;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
