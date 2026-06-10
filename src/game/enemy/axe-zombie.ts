import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ZombieBrain, ZombieState } from './ai';
import { AXE_ZOMBIE, ZOMBIE_GIB_PROFILE, EXPLOSION_LAUNCH, CORPSE } from '../gibs/tuning';
import type { GibProfile } from '../gibs/tuning';
import { stepBallistic, type BallisticMotion } from './ballistic';
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
  takeDamage(amount: number, vel: Vec3): void;
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
  [ZombieState.Launched]: 'zombie-recoil',
};


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
  /** Called on the 25% normal-death head-pop (Blood signature). Wired by the cluster. */
  onHeadPop?: (pos: Vec3) => void;

  private readonly anim: BillboardAnimator;
  private readonly body: RAPIER.RigidBody;
  private readonly world: RAPIER.World;
  private readonly scene: THREE.Scene;
  private facing = { x: 0, z: 1 };
  private prevState: ZombieState = ZombieState.Idle;
  /** Airborne ballistic motion from explosion concussion (alive or dead). */
  private ballistic: BallisticMotion | null = null;
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
    if (this.ballistic) {
      // Airborne — integrate ballistic motion (NotBlood ConcussSprite throws
      // dudes alive or dead; the death anim plays on the flying body).
      const step = stepBallistic(
        { x: t.x, y: t.y, z: t.z },
        this.ballistic,
        dt,
        EXPLOSION_LAUNCH.gravityMps2,
      );
      this.body.setNextKinematicTranslation(step.pos);
      this.ballistic.vel = step.vel;
      if (step.landed) {
        this.ballistic = null;
        this.brain.land(); // no-op if Dead — corpse just rests where it fell
        // land() runs AFTER this frame's prev/state anim diff — trigger explicitly
        // (same state-change-invisible-to-diff trap as the M5-D onBurnDeath bug)
        if (this.brain.state === ZombieState.Stagger) {
          this.anim.play('zombie-recoil', now);
        }
      }
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

  takeDamage(amount: number, vel: Vec3): void {
    const wasAlive = this.brain.state !== ZombieState.Dead;
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
    const died = wasAlive && this.brain.state === ZombieState.Dead;
    if (died) this.deathTime = performance.now() / 1000;

    // Concussion launch — NotBlood ConcussSprite applies velocity to dudes
    // alive or dead, decoupled from damage outcome.
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (speed >= EXPLOSION_LAUNCH.minLaunchSpeedMps) {
      // Keep the original floor height if re-launched mid-flight — otherwise the
      // body would "land" at its current altitude instead of the ground.
      const groundY = this.ballistic?.groundY ?? this.body.translation().y;
      this.ballistic = { vel: { x: vel.x, y: vel.y, z: vel.z }, groundY };
      if (died) {
        // Sub-160 explosion kill: NotBlood converts to kDamageFall — death anim
        // plays on the flying body, which lands and persists as a corpse.
        this.anim.play('zombie-death-explode', performance.now() / 1000);
        this._sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos);
      } else if (this.brain.state !== ZombieState.Dead) {
        this.brain.launch();
        // launch() happens between frames — the update() prev/state diff never
        // sees it, so trigger the airborne anim explicitly
        this.anim.play('zombie-recoil', performance.now() / 1000);
      }
    } else if (died) {
      // Normal (non-explosion) death
      this._sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos);
      // Blood signature: 25% of normal zombie deaths pop the head off
      // (NotBlood actor.cpp:3205, Chance(0x4000))
      if (this.gibProfile.spawnsKickableHead && Math.random() < EXPLOSION_LAUNCH.headPopChance) {
        this.onHeadPop?.(this.pos);
      }
    }
  }

  /** Marks the zombie as gibbed — cluster reaps immediately (chunks replace the body). */
  onGibbed(): void {
    this.gibbed = true;
    this.anim.object.visible = false;
  }

  /** Dead-but-not-gibbed — a persistent, re-gibbable corpse. */
  get isCorpse(): boolean {
    return this.brain.state === ZombieState.Dead && !this.gibbed;
  }

  /** Wallclock seconds when this zombie died (-1 if alive). Used by the corpse cap. */
  getDeathTime(): number { return this.deathTime; }

  /** Ready to be reaped: gibbed immediately (chunks replace the body), or a
   *  corpse past its lifetime (corpses persist as re-gibbable props — NotBlood
   *  kThingBloodChunks; CORPSE.maxCorpses cap is enforced by the cluster). */
  shouldReap(): boolean {
    if (this.gibbed) return true;
    if (this.brain.state !== ZombieState.Dead || this.deathTime < 0) return false;
    if (this.ballistic) return false; // still flying
    return performance.now() / 1000 - this.deathTime > CORPSE.reapAfterSec;
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
