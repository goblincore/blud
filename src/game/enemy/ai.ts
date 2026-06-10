import { AXE_ZOMBIE, BURN } from '../gibs/tuning';
import type { Vec3 } from '../gibs/particles';

export enum ZombieState {
  Idle = 'idle',
  Chase = 'chase',
  Attack = 'attack',
  Stagger = 'stagger',
  Dead = 'dead',
  Burning = 'burning',
  /** Airborne from explosion concussion — AI suspended until landing. */
  Launched = 'launched',
}

/** Callback hooks for brain → gameplay SFX wiring. */
export interface BrainHooks {
  onAggroTransition?: () => void;
  onIdleGroan?: () => void;
  onFootstep?: () => void;
  onBurningStart?: () => void;
  onBurningEnd?: () => void;
  onCharredDeath?: () => void;
}

// ——— Pure math (TDD'd) ———————————————————————————

/**
 * Determine the next brain state given burning context.
 * Extracted as a pure function for testability.
 */
export function nextStateGivenBurningContext(
  current: ZombieState,
  hp: number,
  stuckFlareCount: number,
  prevState: ZombieState,
): ZombieState {
  if (hp <= 0) return ZombieState.Dead;
  if (stuckFlareCount > 0) return ZombieState.Burning;
  // No flares attached
  if (current === ZombieState.Burning) return prevState; // restore
  return current;
}

export class ZombieBrain {
  state: ZombieState = ZombieState.Idle;
  hp: number;
  readonly speed: number;

  private attackCooldownSec = 0;
  private staggerSec = 0;
  private postStaggerSec = 0;
  private hitPending = false;
  private readonly aggroRadiusM = AXE_ZOMBIE.aggroRadiusM;
  private readonly meleeRangeM  = AXE_ZOMBIE.meleeRange;
  private nextGroanAt = 0;
  private distAccum = 0;

  // ——— Burning state ———————————————————————————
  private stuckFlareCount = 0;
  private prevState: ZombieState = ZombieState.Idle;

  constructor(
    init: { hp: number; speed: number },
    private readonly hooks?: BrainHooks,
  ) {
    this.hp = init.hp;
    this.speed = init.speed;
  }

  /** Called each frame by the concrete enemy with the current stuck flare count. */
  setStuckFlareCount(count: number): void {
    this.stuckFlareCount = count;
  }

  /** Explosion concussion threw this zombie airborne (alive). No-op if Dead. */
  launch(): void {
    if (this.state === ZombieState.Dead) return;
    this.state = ZombieState.Launched;
  }

  /** Ballistic flight ended — recover through a brief stagger. */
  land(): void {
    if (this.state !== ZombieState.Launched) return;
    this.state = ZombieState.Stagger;
    this.staggerSec = 0.3;
  }

  update(dt: number, self: Vec3, player: Vec3): void {
    if (this.state === ZombieState.Dead) return;

    const nowSec = performance.now() / 1000;

    if (this.hp <= 0) {
      if (this.state === ZombieState.Burning) {
        this.hooks?.onCharredDeath?.();
      }
      this.state = ZombieState.Dead;
      return;
    }

    // Airborne — AI suspended; the entity integrates ballistic motion and
    // calls land() when the body reaches the ground.
    // NOTE: Burning entry is intentionally deferred while airborne — flares
    // stuck mid-flight ignite the Burning state on the first update after landing.
    if (this.state === ZombieState.Launched) return;

    // ——— Burning state transitions —————————————————
    // Enter Burning when flares are stuck and we're not already burning.
    if (this.stuckFlareCount > 0 && this.state !== ZombieState.Burning) {
      this.prevState = this.state;
      this.state = ZombieState.Burning;
      this.hooks?.onBurningStart?.();
    }

    // Exit Burning when all flares expired.
    if (this.stuckFlareCount === 0 && this.state === ZombieState.Burning) {
      this.state = this.prevState;
      this.hooks?.onBurningEnd?.();
    }

    // ——— Burning behaviour ————————————————————————
    // Walk toward player at reduced speed (NotBlood faithful: 0.80×).
    if (this.state === ZombieState.Burning) {
      return; // don't run normal attack/chase logic while burning
    }

    const prev = this.state;
    this.attackCooldownSec = Math.max(0, this.attackCooldownSec - dt);

    if (this.state === ZombieState.Stagger) {
      this.staggerSec -= dt;
      if (this.staggerSec <= 0) {
        this.state = ZombieState.Chase;
        this.postStaggerSec = 0.1; // brief recovery before re-engaging melee
      }
      return;
    }

    if (this.postStaggerSec > 0) {
      this.postStaggerSec -= dt;
      return; // recovering — stay in current state (Chase)
    }

    const d = distance(self, player);

    if (this.state === ZombieState.Idle) {
      if (d < this.aggroRadiusM) this.state = ZombieState.Chase;
      else {
        // Idle groan scheduler
        if (nowSec >= this.nextGroanAt) {
          this.hooks?.onIdleGroan?.();
          this.nextGroanAt = nowSec + 8 + Math.random() * 12;
        }
        return; // still outside aggro — stay idle
      }
    }

    if (d < this.meleeRangeM) {
      // Transition to attack (once per cooldown)
      if (this.state !== ZombieState.Attack) {
        this.state = ZombieState.Attack;
        this.hitPending = this.attackCooldownSec <= 0;
        if (this.hitPending) this.attackCooldownSec = AXE_ZOMBIE.attackCooldownSec;
      } else if (this.attackCooldownSec <= 0) {
        // Re-arm another swing
        this.hitPending = true;
        this.attackCooldownSec = AXE_ZOMBIE.attackCooldownSec;
      }
    } else {
      this.state = ZombieState.Chase;
    }

    // Aggro transition hook
    if (prev === ZombieState.Idle && this.state === ZombieState.Chase) {
      this.hooks?.onAggroTransition?.();
    }

    // Footstep hook — count distance while chasing
    if (this.state === ZombieState.Chase) {
      const v = this.desiredVelocity(self, player);
      this.distAccum += Math.hypot(v.x, v.z) * dt;
      if (this.distAccum >= 0.8) {
        this.hooks?.onFootstep?.();
        this.distAccum = 0;
      }
    }
  }

  desiredVelocity(self: Vec3, player: Vec3): Vec3 {
    if (
      this.state === ZombieState.Dead ||
      this.state === ZombieState.Attack ||
      this.state === ZombieState.Launched
    ) return { x: 0, y: 0, z: 0 };

    // Burning — walk toward player at reduced speed (NotBlood: 0.80×)
    if (this.state === ZombieState.Burning) {
      const dx = player.x - self.x;
      const dy = player.y - self.y;
      const dz = player.z - self.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return { x: 0, y: 0, z: 0 };
      const burnSpeed = this.speed * BURN.zombieBurnSpeedMul;
      return { x: (dx / len) * burnSpeed, y: 0, z: (dz / len) * burnSpeed };
    }

    const dx = player.x - self.x;
    const dy = player.y - self.y;
    const dz = player.z - self.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return { x: 0, y: 0, z: 0 };
    if (len > this.aggroRadiusM) return { x: 0, y: 0, z: 0 };
    return { x: (dx / len) * this.speed, y: (dy / len) * this.speed, z: (dz / len) * this.speed };
  }

  applyDamage(amount: number): void {
    this.hp -= amount;
    if (this.hp <= 0) {
      if (this.state === ZombieState.Burning) {
        this.hooks?.onCharredDeath?.();
      }
      this.state = ZombieState.Dead;
    } else if (this.state !== ZombieState.Burning && this.state !== ZombieState.Launched) {
      // Don't stagger out of Burning (panic-thrash IS the stagger) or
      // Launched (mid-air — landing handles recovery)
      this.state = ZombieState.Stagger;
      this.staggerSec = 0.25;
    }
  }

  /** True if an attack swing connected this step. Caller resolves damage. */
  consumeHit(): boolean {
    if (this.hitPending) { this.hitPending = false; return true; }
    return false;
  }
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
