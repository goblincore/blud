import { SHOTGUN_CULTIST, SHOTGUN_BLAST, BURN, TOMMY_CULTIST, TOMMY_BULLET } from '../gibs/tuning';
import type { Vec3 } from '../gibs/particles';

export enum CultistState {
  Idle = 'idle',
  Chase = 'chase',
  Aim = 'aim',
  Fire = 'fire',
  Recoil = 'recoil',
  Dead = 'dead',
  Burning = 'burning',
}

/** Fire mode — controls behaviour in Aim→Fire and Fire states. */
export type FireMode = 'shotgun' | 'tommy';

/** Callback hooks for brain → gameplay SFX wiring. */
export interface CultistHooks {
  onAggroTransition?: () => void;
  onAimStart?: () => void;
  onFire?: (origin: Vec3, dir: Vec3) => void;
  onRecoil?: () => void;
  onIdleGroan?: () => void;
  onDeath?: () => void;
  onBurningStart?: () => void;
  onCharredDeath?: () => void;
}

// ——— Pure math (TDD'd) ———————————————————————————

/**
 * Even angular distribution of pellet `i` across a cone of `coneDeg` half-angle.
 * Returns degrees offset from the cone centerline.
 * Pellets fan from -coneDeg to +coneDeg inclusive.
 */
export function pelletSpread(angleIdx: number, total: number, coneDeg: number): number {
  if (total <= 1) return 0;
  // Spread evenly from -coneDeg to +coneDeg
  return -coneDeg + (angleIdx / (total - 1)) * coneDeg * 2;
}

/** Euclidean distance check — true when self is within `range` meters of player. */
export function withinFireRange(self: Vec3, player: Vec3, range: number): boolean {
  const dx = self.x - player.x;
  const dy = self.y - player.y;
  const dz = self.z - player.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= range;
}

/**
 * Straight-line pellet position after traveling `t` seconds at `speed` m/s.
 * No gravity — shotgun pellets are hitscan-fast and travel flat.
 */
export function pelletEndPos(spawn: Vec3, dir: Vec3, t: number, speed: number): Vec3 {
  return {
    x: spawn.x + dir.x * speed * t,
    y: spawn.y + dir.y * speed * t,
    z: spawn.z + dir.z * speed * t,
  };
}

/**
 * Apply random horizontal jitter (rotate around world-up Y axis) to a
 * direction vector. `halfAngleDeg` is the half-angle of the spread cone.
 *
 * Optionally inject `rng` for deterministic testing.
 */
export function applyHorizontalJitter(
  dir: Vec3,
  halfAngleDeg: number,
  rng: () => number = Math.random,
): Vec3 {
  // Random angle in [-halfAngleDeg, +halfAngleDeg]
  const angleDeg = (rng() * 2 - 1) * halfAngleDeg;
  const angleRad = angleDeg * (Math.PI / 180);
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  // Rotate dir around Y axis (right-hand rule: +angle = counterclockwise when looking from +Y)
  return {
    x: dir.x * cosA - dir.z * sinA,
    y: dir.y,
    z: dir.x * sinA + dir.z * cosA,
  };
}

// ——— Brain FSM ——————————————————————————————————

export class CultistBrain {
  state: CultistState = CultistState.Idle;
  hp: number;
  readonly speed: number;
  /** (a) fireMode field — shotgun vs tommy differ only in Fire state behaviour. */
  readonly fireMode: FireMode;

  private aimEnteredAt = -1;
  private recoilEnteredAt = -1;
  private nextGroanAt = 0;
  private hasLineOfSight = false;

  // ——— Burning state ———————————————————————————
  private stuckFlareCount = 0;
  private _isFlareIgnited = false;

  /** Direction toward player at the moment of firing — used by onFire hook. */
  private fireDir: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    init: { hp: number; speed: number; fireMode?: FireMode },
    hooks?: CultistHooks,
    private readonly getNowSec: () => number = () => performance.now() / 1000,
  ) {
    this._hooks = hooks ?? {};
    this.hp = init.hp;
    this.speed = init.speed;
    this.fireMode = init.fireMode ?? 'shotgun';
  }

  private _hooks: CultistHooks;
  get hooks(): CultistHooks { return this._hooks; }
  set hooks(h: CultistHooks) { this._hooks = h; }

  /** Called by the concrete enemy each frame with the current stuck flare count. */
  setStuckFlareCount(count: number): void {
    this.stuckFlareCount = count;
  }

  /** Called by the concrete enemy each frame — true when any stuck flare has ignited. */
  setIsFlareIgnited(ignited: boolean): void {
    this._isFlareIgnited = ignited;
  }

  /**
   * Called each frame by the concrete enemy.
   * @param dt delta time in seconds
   * @param self position of the cultist
   * @param player position of the player
   * @param lineOfSight whether the cultist has LOS to the player
   */
  update(dt: number, self: Vec3, player: Vec3, lineOfSight: boolean): void {
    if (this.state === CultistState.Dead) return;

    const nowSec = this.getNowSec();
    this.hasLineOfSight = lineOfSight;

    // ——— Burning state transitions —————————————————
    // Enter Burning when flares are stuck and at least one has ignited.
    if (this.stuckFlareCount > 0 && this._isFlareIgnited && this.state !== CultistState.Burning) {
      this.state = CultistState.Burning;
      this._hooks.onBurningStart?.();
      return; // skip normal AI this frame
    }

    // Exit Burning when all flares expired (fire went out)
    if (this.stuckFlareCount === 0 && this.state === CultistState.Burning) {
      this.state = CultistState.Chase;
    }

    if (this.hp <= 0) {
      const wasBurning = this.state === CultistState.Burning;
      if (wasBurning) {
        this._hooks.onCharredDeath?.();
      }
      this.state = CultistState.Dead;
      this._hooks.onDeath?.();
      return;
    }

    // ——— Burning behaviour ————————————————————————
    if (this.state === CultistState.Burning) {
      // Sprint toward player, no firing
      return;
    }

    const prev = this.state;

    switch (this.state) {
      case CultistState.Idle: {
        const d = distance(self, player);
        if (d < SHOTGUN_CULTIST.aggroRadiusM) {
          this.state = CultistState.Chase;
        } else if (nowSec >= this.nextGroanAt) {
          this._hooks.onIdleGroan?.();
          this.nextGroanAt = nowSec + 8 + Math.random() * 12;
        }
        break;
      }

      case CultistState.Chase: {
        const d = distance(self, player);
        if (d > SHOTGUN_CULTIST.aggroRadiusM) {
          // Lose interest — no search state
          this.state = CultistState.Idle;
        } else if (d <= SHOTGUN_CULTIST.fireRangeM && this.hasLineOfSight) {
          this.state = CultistState.Aim;
          this.aimEnteredAt = nowSec;
          this._hooks.onAimStart?.();
        }
        break;
      }

      case CultistState.Aim: {
        // Re-check: if player retreats out of range, abort aim
        const d = distance(self, player);
        if (d > SHOTGUN_CULTIST.fireRangeM || !this.hasLineOfSight) {
          this.state = CultistState.Chase;
          break;
        }
        if (nowSec - this.aimEnteredAt >= SHOTGUN_CULTIST.fireWindupSec) {
          if (this.fireMode === 'tommy') {
            // Tommy: enter continuous Fire state (no one-shot burst)
            this.state = CultistState.Fire;
          } else {
            // Shotgun: one-frame state — Aim→Fire→Recoil in same update
            this.fireDir = direction(self, player);
            this._hooks.onFire?.(self, this.fireDir);
            this.state = CultistState.Recoil;
            this.recoilEnteredAt = nowSec;
            this._hooks.onRecoil?.();
          }
        }
        break;
      }

      case CultistState.Fire: {
        if (this.fireMode === 'tommy') {
          // Continuous fire — one bullet per update call
          const d = distance(self, player);
          if (d > TOMMY_CULTIST.fireRangeM || !this.hasLineOfSight) {
            this.state = CultistState.Chase;
            break;
          }
          const baseDir = direction(self, player);
          const jitteredDir = applyHorizontalJitter(baseDir, TOMMY_BULLET.spreadHalfAngleDeg);
          this._hooks.onFire?.(self, jitteredDir);
          // Stay in Fire — continuous until player leaves range/LOS or takes damage
        } else {
          // Shotgun: Fire is an instantaneous state — if we somehow land here
          // (e.g. from applyDamage hitting between Aim→Fire), transition to Recoil.
          this.state = CultistState.Recoil;
          this.recoilEnteredAt = nowSec;
        }
        break;
      }

      case CultistState.Recoil: {
        if (nowSec - this.recoilEnteredAt >= SHOTGUN_CULTIST.recoilDurationSec) {
          this.state = CultistState.Chase;
        }
        break;
      }
    }

    // Aggro transition hook
    if (prev === CultistState.Idle && this.state === CultistState.Chase) {
      this._hooks.onAggroTransition?.();
    }
  }

  desiredVelocity(self: Vec3, player: Vec3): Vec3 {
    if (this.state === CultistState.Dead) return { x: 0, y: 0, z: 0 };

    // Burning: sprint toward player at 1.4× speed
    if (this.state === CultistState.Burning) {
      const dx = player.x - self.x;
      const dy = player.y - self.y;
      const dz = player.z - self.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return { x: 0, y: 0, z: 0 };
      const burnSpeed = this.speed * BURN.panicSpeedMultiplier;
      return { x: (dx / len) * burnSpeed, y: 0, z: (dz / len) * burnSpeed };
    }

    // Only move during Chase — cultist plants feet to fire
    if (this.state !== CultistState.Chase) return { x: 0, y: 0, z: 0 };

    const dx = player.x - self.x;
    const dy = player.y - self.y;
    const dz = player.z - self.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return { x: 0, y: 0, z: 0 };
    if (len > SHOTGUN_CULTIST.aggroRadiusM) return { x: 0, y: 0, z: 0 };

    return {
      x: (dx / len) * this.speed,
      y: (dy / len) * this.speed,
      z: (dz / len) * this.speed,
    };
  }

  applyDamage(amount: number): void {
    this.hp -= amount;
    if (this.hp <= 0) {
      const wasBurning = this.state === CultistState.Burning;
      if (wasBurning) {
        this._hooks.onCharredDeath?.();
      }
      this.state = CultistState.Dead;
      this._hooks.onDeath?.();
      return;
    }
    // While Burning: just decrement HP, no Recoil interruption
    if (this.state === CultistState.Burning) return;
    // Don't trigger Recoil if already Dead or already Recoil
    if (this.state === CultistState.Dead || this.state === CultistState.Recoil) return;
    this.state = CultistState.Recoil;
    this.recoilEnteredAt = this.getNowSec();
  }
}

// ——— Internal helpers ——————————————————————————————

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function direction(from: Vec3, to: Vec3): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: dx / len, y: dy / len, z: dz / len };
}
