import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CultistBrain, CultistState, type CultistHooks } from './cultist-ai';
import { SHOTGUN_CULTIST, ZOMBIE_GIB_PROFILE } from '../gibs/tuning';
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

// ——— Anim key mapping ——————————————————————————————

/** State → SEQ manifest name mapping. */
const STATE_ANIM_MAP: Record<CultistState, string> = {
  [CultistState.Idle]: 'cultist-shotgun-idle',
  [CultistState.Chase]: 'cultist-shotgun-chase',
  [CultistState.Aim]: 'cultist-shotgun-fire',      // Aim + Fire share the fire anim
  [CultistState.Fire]: 'cultist-shotgun-fire',
  [CultistState.Recoil]: 'cultist-shotgun-recoil',
  [CultistState.Dead]: 'cultist-shotgun-death-normal',
  [CultistState.Burning]: 'cultist-burn-chase',
};

// ——— Fling constants (mirror AxeZombie) ————————————

const FLING_DURATION_SEC = 0.7;
const FLING_IMPULSE_SCALE = 0.018;

export class ShotgunCultist implements GibbableDude {
  readonly id: string;
  readonly kind = 'cultist-shotgun' as const;
  readonly gibProfile: GibProfile = ZOMBIE_GIB_PROFILE; // TODO M5.F2: cultist-specific palette

  hp: number = SHOTGUN_CULTIST.hp;
  private _sfx: Sfx | null = null;
  private _particlePool: ParticlePool | null = null;

  // ——— Stuck-flare state ————————————————————————
  private stuckFlares: StuckFlare[] = [];
  private smokeHandles: TrailHandle[] = [];

  readonly brain = new CultistBrain(
    { hp: SHOTGUN_CULTIST.hp, speed: SHOTGUN_CULTIST.walkSpeedMps },
    {
      onAggroTransition: () => this._sfx?.play(SfxEvent.ZOMBIE_AGGRO, this.pos),
      onAimStart: () => {
        // TODO M5.F2: cultist aim SFX (placeholder: zombie aggro)
      },
      onFire: undefined,   // wired externally by cluster / main.ts
      onRecoil: () => {
        // TODO M5.F2: cultist recoil SFX
      },
      onIdleGroan: () => this._sfx?.play(SfxEvent.ZOMBIE_IDLE_GROAN, this.pos),
      onDeath: () => this._sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos),
    },
  );

  /** Set the onFire hook after construction (wired by main.ts for pellet spawning). */
  setHooks(hooks: Partial<CultistHooks>): void {
    if (hooks.onFire) {
      this.brain.hooks = { ...this.brain.hooks, onFire: hooks.onFire };
    }
  }

  private readonly anim: BillboardAnimator;
  private readonly body: RAPIER.RigidBody;
  private readonly world: RAPIER.World;
  private readonly scene: THREE.Scene;
  private facing = { x: 0, z: 1 };
  private prevState: CultistState = CultistState.Idle;
  private flingVel: Vec3 | null = null;
  private flingTimer = 0;
  private gibbed = false;
  private deathTime = -1;

  /** Track whether the player is in line-of-sight for brain. */
  private _hasLos = false;

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
    this.anim.play('cultist-shotgun-idle', 0);
  }

  static spawn(
    id: string,
    world: RAPIER.World,
    scene: THREE.Scene,
    anim: BillboardAnimator,
    pos: Vec3,
  ): ShotgunCultist {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.25), body);

    return new ShotgunCultist(id, world, scene, body, anim);
  }

  /** Wire the SFX engine. */
  setSfx(sfx: Sfx): void { this._sfx = sfx; }

  /** Wire the particle pool for smoke emission from stuck flares. */
  setParticlePool(pool: ParticlePool): void { this._particlePool = pool; }

  /** Called when burn-death visual sequence should fire (gibs + ground flame). */
  onBurnDeath?: (pos: Vec3, now: number) => void;

  /** The RAPIER rigid body — exposed for collision matching in main.ts. */
  get rigidBody(): RAPIER.RigidBody { return this.body; }

  get pos(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Check if the cultist has LOS to the player (called by main.ts each frame). */
  setLineOfSight(hasLos: boolean): void {
    this._hasLos = hasLos;
  }

  /**
   * Attach a stuck flare to this cultist. Starts a smoke column that follows
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

    // Update stuck-flare count + ignition state → brain decides Burning entry/exit
    this.brain.setStuckFlareCount(this.stuckFlares.length);
    const anyIgnited = this.stuckFlares.some(f => f.isIgnited(now));
    this.brain.setIsFlareIgnited(anyIgnited);

    const prev = this.brain.state;

    this.brain.update(dt, this.pos, playerPos, this._hasLos);

    // Detect state change → trigger new animation
    if (this.brain.state !== prev) {
      this.onStateEnter(this.brain.state, now, prev);
      // Track death time for reap scheduling
      if (this.brain.state === CultistState.Dead && this.deathTime < 0) {
        this.deathTime = now;
        if (prev === CultistState.Burning) {
          this.onBurnDeath?.(this.pos, now);
        }
      }
      // Gib death anim override
      if (this.brain.state === CultistState.Dead && this.flingVel && this.flingTimer > 0) {
        this.anim.play('cultist-shotgun-death-gib', now);
      }
    }

    const t = this.body.translation();
    if (this.flingVel && this.flingTimer > 0) {
      // Blown-away tumble
      const k = this.flingTimer / FLING_DURATION_SEC;
      this.body.setNextKinematicTranslation({
        x: t.x + this.flingVel.x * k * dt,
        y: t.y,
        z: t.z + this.flingVel.z * k * dt,
      });
      this.flingTimer = Math.max(0, this.flingTimer - dt);
    } else {
      // Kinematic move driven by AI
      const v = this.brain.desiredVelocity(this.pos, playerPos);
      this.body.setNextKinematicTranslation({ x: t.x + v.x * dt, y: t.y, z: t.z + v.z * dt });
      // Update facing direction from velocity (skip when dead)
      if (this.brain.state !== CultistState.Dead && Math.hypot(v.x, v.z) > 0.01) {
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

  private onStateEnter(state: CultistState, now: number, prevState?: CultistState): void {
    // Burn-death: when transitioning Dead from Burning, play burn-death sprite
    if (state === CultistState.Dead && prevState === CultistState.Burning) {
      this.anim.play('cultist-burn-death', now);
      return;
    }
    this.anim.play(STATE_ANIM_MAP[state], now);
  }

  private setFacing(v: { x: number; z: number }): void {
    const m = Math.hypot(v.x, v.z) || 1;
    this.facing = { x: v.x / m, z: v.z / m };
  }

  takeDamage(amount: number, impulse: Vec3): void {
    const wasAlive = this.brain.state !== CultistState.Dead;
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
    if (wasAlive && this.brain.state === CultistState.Dead) {
      this.deathTime = performance.now() / 1000;
    }

    // Flung-but-not-gibbed: explosion that killed but didn't gib
    const impulseMag = Math.hypot(impulse.x, impulse.y, impulse.z);
    if (wasAlive && this.brain.state === CultistState.Dead && impulseMag > 50) {
      this.flingVel = {
        x: impulse.x * FLING_IMPULSE_SCALE,
        y: 0,
        z: impulse.z * FLING_IMPULSE_SCALE,
      };
      this.flingTimer = FLING_DURATION_SEC;
      this.anim.play('cultist-shotgun-death-gib', performance.now() / 1000);
    }
  }

  /** Marks the cultist as gibbed — cluster reaps immediately. */
  onGibbed(): void {
    this.gibbed = true;
    this.anim.object.visible = false;
  }

  /** Whether the cultist is ready to be reaped by the cluster. */
  shouldReap(): boolean {
    if (this.gibbed) return true;
    if (this.brain.state !== CultistState.Dead || this.deathTime < 0) return false;
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
