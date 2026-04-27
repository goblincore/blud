import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ZombieBrain, ZombieState } from './ai';
import { AXE_ZOMBIE, ZOMBIE_GIB_PROFILE } from '../gibs/tuning';
import type { GibProfile } from '../gibs/tuning';
import { BillboardAnimator } from '../../animation/billboard-animator';
import type { Vec3 } from '../gibs/particles';
import { SfxEvent } from '../../audio/events';
import type { Sfx } from '../../audio/sfx';
import { StuckFlare } from '../weapons/stuck-flare';
import { startSmokeColumn, emitSmokeBurst } from '../../vfx/smoke-particles';
import type { TrailHandle, ParticlePool } from '../gibs/particles';

/** Interface implemented by any enemy that can be gibbed by explosions. */
export interface GibbableDude {
  readonly id: string;
  readonly kind: string;
  hp: number;
  pos: Vec3;
  takeDamage(amount: number, impulse: Vec3): void;
  despawn(): void;
}

/** State → SEQ manifest name mapping (from Task 2 extraction). */
const STATE_ANIM_MAP: Record<ZombieState, string> = {
  [ZombieState.Idle]: 'zombie-stand',
  [ZombieState.Chase]: 'zombie-chase',
  [ZombieState.Attack]: 'zombie-attack',
  [ZombieState.Stagger]: 'zombie-recoil',
  [ZombieState.Dead]: 'zombie-death-normal',
  [ZombieState.Burning]: 'zombie-burn-chase',
};

/**
 * Duration of the "blown away" fling when a zombie dies to explosion damage
 * below GIB_THRESHOLD. Blood's actor.cpp (kDamageExplode path, ~line 3463)
 * plays nSeq=2 (zombie-death-explode) and applies impulse; the body tumbles
 * for ~0.6s before settling into a dead sprite. We approximate here by
 * translating the kinematic body along an exponentially-decaying velocity.
 */
const FLING_DURATION_SEC = 0.7;
/** Per-unit-impulse → m/s conversion for the initial fling velocity.
 *  Matches the chunk impulse multiplier (0.025) so fling feels proportional
 *  to gib launch force. */
const FLING_IMPULSE_SCALE = 0.018;

export class AxeZombie implements GibbableDude {
  readonly id: string;
  readonly kind = 'axe-zombie' as const;
  readonly gibProfile: GibProfile = ZOMBIE_GIB_PROFILE;

  hp: number = AXE_ZOMBIE.hp;
  private _sfx: Sfx | null = null;
  private _particlePool: ParticlePool | null = null;

  // ——— Stuck-flare state ————————————————————————
  private stuckFlares: StuckFlare[] = [];
  private smokeHandles: TrailHandle[] = [];

  readonly brain = new ZombieBrain(
    { hp: AXE_ZOMBIE.hp, speed: AXE_ZOMBIE.speed },
    {
      onAggroTransition: () => this._sfx?.play(SfxEvent.ZOMBIE_AGGRO, this.pos),
      onIdleGroan: () => this._sfx?.play(SfxEvent.ZOMBIE_IDLE_GROAN, this.pos),
      onFootstep: () => this._sfx?.play(SfxEvent.ZOMBIE_FOOTSTEP, this.pos),
      onCharredDeath: () => {
        this._particlePool && emitSmokeBurst(this._particlePool, this.pos);
        // TODO: tint death sprite for charred effect (requires shader work)
      },
    },
  );

  /** Wire the SFX engine for zombie sounds. */
  setSfx(sfx: Sfx): void { this._sfx = sfx; }

  /** Wire the particle pool for smoke emission from stuck flares. */
  setParticlePool(pool: ParticlePool): void { this._particlePool = pool; }

  /** Called when burn-death visual sequence should fire (gibs + ground flame). */
  onBurnDeath?: (pos: Vec3, now: number) => void;

  private readonly anim: BillboardAnimator;
  private readonly body: RAPIER.RigidBody;
  private readonly world: RAPIER.World;
  private readonly scene: THREE.Scene;
  private facing = { x: 0, z: 1 };
  private prevState: ZombieState = ZombieState.Idle;
  /** Non-zero while the zombie is flying from an explosion that killed but didn't gib it. */
  private flingVel: Vec3 | null = null;
  private flingTimer = 0;
  /** Set true once this zombie has been gibbed — cluster reaps it immediately (chunks replace it). */
  private gibbed = false;
  /** Wallclock-seconds timestamp when this zombie entered the Dead state. -1 = still alive. */
  private deathTime = -1;

  constructor(
    id: string,
    world: RAPIER.World,
    scene: THREE.Scene,
    body: RAPIER.RigidBody,
    anim: BillboardAnimator,
  ) {
    this.id = id;
    this.world = world;
    this.scene = scene;
    this.body = body;
    this.anim = anim;

    scene.add(this.anim.object);
    this.anim.play('zombie-stand', 0);
  }

  static spawn(
    id: string,
    world: RAPIER.World,
    scene: THREE.Scene,
    anim: BillboardAnimator,
    pos: Vec3,
  ): AxeZombie {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.25), body);

    return new AxeZombie(id, world, scene, body, anim);
  }

  /** The RAPIER rigid body — exposed for collision matching in main.ts. */
  get rigidBody(): RAPIER.RigidBody { return this.body; }

  get pos(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /**
   * Attach a stuck flare to this enemy. Starts a smoke column that follows
   * the flare's position each frame.
   */
  attachFlare(flare: StuckFlare): void {
    this.stuckFlares.push(flare);
    if (this._particlePool) {
      const h = startSmokeColumn(this._particlePool, () => flare.pos);
      this.smokeHandles.push(h);
    }
  }

  /** Update AI, movement, and animation state transitions. */
  update(dt: number, playerPos: Vec3, camera: THREE.Camera): void {
    const now = performance.now() / 1000;

    // ——— Process stuck flares —————————————————————
    for (let i = this.stuckFlares.length - 1; i >= 0; i--) {
      const flare = this.stuckFlares[i]!;
      const alive = flare.update(now);
      if (!alive) {
        // Expired — emit final smoke burst and clean up
        if (this._particlePool) {
          emitSmokeBurst(this._particlePool, flare.pos);
        }
        this.smokeHandles[i]?.stop();
        this.stuckFlares.splice(i, 1);
        this.smokeHandles.splice(i, 1);
      }
    }

    // Apply per-frame DoT damage from all stuck flares
    let burnDamage = 0;
    for (const flare of this.stuckFlares) {
      burnDamage += flare.damageThisTick(dt, now);
    }
    if (burnDamage > 0) {
      this.brain.applyDamage(burnDamage);
      this.hp = this.brain.hp;
    }

    // Update stuck-flare count → brain decides Burning entry/exit
    this.brain.setStuckFlareCount(this.stuckFlares.length);

    // ——— Normal brain update ————————————————————
    const prev = this.brain.state;
    this.brain.update(dt, this.pos, playerPos);

    // Detect state change → trigger new animation
    if (this.brain.state !== prev) {
      this.onStateEnter(this.brain.state, now, prev);
      // Track death time for reap scheduling (handles both takeDamage and burn-DoT deaths)
      if (this.brain.state === ZombieState.Dead && this.deathTime < 0) {
        this.deathTime = now;
        if (prev === ZombieState.Burning) {
          this.onBurnDeath?.(this.pos, now);
        }
      }
    }

    const t = this.body.translation();
    if (this.flingVel && this.flingTimer > 0) {
      // Blown-away tumble: exponentially decaying impulse translation.
      const k = this.flingTimer / FLING_DURATION_SEC; // 1 → 0
      this.body.setNextKinematicTranslation({
        x: t.x + this.flingVel.x * k * dt,
        y: t.y, // XZ-only; no vertical fling (no floor physics on kinematic)
        z: t.z + this.flingVel.z * k * dt,
      });
      this.flingTimer = Math.max(0, this.flingTimer - dt);
    } else {
      // Kinematic move driven by AI
      const v = this.brain.desiredVelocity(this.pos, playerPos);
      this.body.setNextKinematicTranslation({ x: t.x + v.x * dt, y: t.y, z: t.z + v.z * dt });
      // Update facing direction from velocity (skip when dead)
      if (this.brain.state !== ZombieState.Dead && Math.hypot(v.x, v.z) > 0.01) {
        this.setFacing({ x: v.x, z: v.z });
      }
    }

    // Billboard render update
    const trans = this.body.translation();
    this.anim.update(
      now,
      { x: trans.x, y: trans.y, z: trans.z },
      this.facing,
      camera.position,
    );
  }

  private onStateEnter(state: ZombieState, now: number, prevState?: ZombieState): void {
    // Burn-death: when transitioning Dead from Burning, play burn-death sprite
    if (state === ZombieState.Dead && prevState === ZombieState.Burning) {
      this.anim.play('zombie-death-burn', now);
      return;
    }
    this.anim.play(STATE_ANIM_MAP[state], now);
  }

  private setFacing(v: { x: number; z: number }): void {
    const m = Math.hypot(v.x, v.z) || 1;
    this.facing = { x: v.x / m, z: v.z / m };
  }

  takeDamage(amount: number, impulse: Vec3): void {
    const wasAlive = this.brain.state !== ZombieState.Dead;
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
    if (wasAlive && this.brain.state === ZombieState.Dead) {
      this.deathTime = performance.now() / 1000;
    }

    // Blood-style "blown away but not gibbed" — an explosion that killed the
    // zombie (didn't exceed GIB_THRESHOLD) still flings it with the impulse
    // vector + plays the explode-death SEQ (NotBlood actor.cpp line 3463:
    // kDamageExplode → nSeq=2).
    const impulseMag = Math.hypot(impulse.x, impulse.y, impulse.z);
    if (wasAlive && this.brain.state === ZombieState.Dead && impulseMag > 50) {
      this.flingVel = {
        x: impulse.x * FLING_IMPULSE_SCALE,
        y: 0,
        z: impulse.z * FLING_IMPULSE_SCALE,
      };
      this.flingTimer = FLING_DURATION_SEC;
      // Override death anim: explode-death instead of normal-death
      this.anim.play('zombie-death-explode', performance.now() / 1000);
    } else if (wasAlive && this.brain.state === ZombieState.Dead && impulseMag <= 50) {
      // Normal (non-explode) death — play death SFX
      this._sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos);
    }
  }

  /** Marks the zombie as gibbed — cluster reaps immediately (chunks replace the body). */
  onGibbed(): void {
    this.gibbed = true;
    this.anim.object.visible = false;
  }

  /** Whether the zombie is ready to be reaped by the cluster. True when:
   *  - gibbed (chunks replace the body), or
   *  - dead AND fling-and-die animation has completed (so death visuals play through).
   */
  shouldReap(): boolean {
    if (this.gibbed) return true;
    if (this.brain.state !== ZombieState.Dead || this.deathTime < 0) return false;
    // Wait for fling-and-die to finish (if flung), else short grace period so
    // the death animation has time to play through a frame or two.
    if (this.flingVel && this.flingTimer > 0) return false;
    const graceSec = this.flingVel ? 0 : 1.5;
    return performance.now() / 1000 - this.deathTime > graceSec;
  }

  despawn(): void {
    // Clean up stuck flares: stop smoke columns, emit final burst
    for (const h of this.smokeHandles) h.stop();
    if (this._particlePool) {
      for (const f of this.stuckFlares) {
        emitSmokeBurst(this._particlePool, f.pos);
      }
    }
    this.stuckFlares.length = 0;
    this.smokeHandles.length = 0;

    this.scene.remove(this.anim.object);
    this.anim.dispose();
    this.world.removeRigidBody(this.body);
  }
}
