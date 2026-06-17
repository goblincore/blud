import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CultistBrain, CultistState, type CultistHooks } from './cultist-ai';
import { SHOTGUN_CULTIST, CULTIST_GIB_PROFILE, EXPLOSION_LAUNCH, CORPSE, BALLISTIC_BOUNDS } from '../gibs/tuning';
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
  [CultistState.Launched]: 'cultist-shotgun-recoil',
};


export class ShotgunCultist implements GibbableDude {
  readonly id: string;
  readonly kind = 'cultist-shotgun' as const;
  readonly gibProfile: GibProfile = CULTIST_GIB_PROFILE; // F2.cultist.gibs: still uses zombie picnums; flag-only divergence (no kickable head)

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
  /** Airborne ballistic motion from explosion concussion (alive or dead). */
  private ballistic: BallisticMotion | null = null;
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

  /** Called when a launched body lands hard enough to burst (impactGibSpeedMps).
   *  Wired by the cluster to a full gib. */
  onImpactGib?: (pos: Vec3) => void;

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

    // NotBlood actor.cpp:6887 — a stuck flare is removed when its host dies; it
    // does NOT linger floating at chest height above the prone corpse. Extinguish
    // on death by any cause (burn DoT / explosion / melee); the loop below then
    // drops it (final smoke burst + cleanup) on this same frame.
    if (this.brain.state === CultistState.Dead) {
      for (const f of this.stuckFlares) f.extinguish();
    }

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

    // Capture pre-damage state BEFORE the DoT block — a Burning→Dead transition
    // happens synchronously inside applyDamage and is invisible to the diff
    // below if prev is captured after it (M5-D onBurnDeath dead-code bug).
    const prev = this.brain.state;

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

    this.brain.update(dt, this.pos, playerPos, this._hasLos);

    // Detect state change → trigger new animation
    if (this.brain.state !== prev) {
      this.onStateEnter(this.brain.state, now, prev);
      // Track death time for reap scheduling
      // deathTime may already be stamped by takeDamage (explosion deaths) — the
      // < 0 guard makes this the fallback for DoT/other deaths, not an overwrite.
      if (this.brain.state === CultistState.Dead && this.deathTime < 0) {
        this.deathTime = now;
        if (prev === CultistState.Burning) {
          this.onBurnDeath?.(this.pos, now);
        }
      }
    }

    const t = this.body.translation();
    if (this.ballistic) {
      // Airborne — integrate ballistic motion (NotBlood ConcussSprite throws
      // dudes alive or dead; the death anim plays on the flying body).
      const impactSpeed = Math.hypot(
        this.ballistic.vel.x, this.ballistic.vel.y, this.ballistic.vel.z,
      );
      const step = stepBallistic(
        { x: t.x, y: t.y, z: t.z },
        this.ballistic,
        dt,
        EXPLOSION_LAUNCH.gravityMps2,
        BALLISTIC_BOUNDS,
        EXPLOSION_LAUNCH.wallRestitution,
      );
      this.body.setNextKinematicTranslation(step.pos);
      this.ballistic.vel = step.vel;
      if (step.landed) {
        this.ballistic = null;
        // Hard landing bursts the body, alive or dead — NotBlood fall/impact
        // damage gibbing.
        if (impactSpeed >= EXPLOSION_LAUNCH.impactGibSpeedMps) {
          this.onImpactGib?.(this.pos);
          return;
        }
        this.brain.land(); // no-op if Dead — corpse just rests where it fell
        // land() runs AFTER this frame's prev/state anim diff — trigger explicitly
        if (this.brain.state === CultistState.Recoil) {
          this.anim.play('cultist-shotgun-recoil', now);
        }
      }
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
    // Burn-death: when transitioning Dead from Burning, the cultist falls with its
    // own real death sprite. The dedicated 'cultist-burn-death' manifest points at
    // baseTile 3784 — a substitute (PRIS-family) extraction that renders a
    // different character; the genuine charred-cultist burn-death SEQs
    // (Blood 12559/12560) are missing from BLOOD.RFF, so no charred-cultist art
    // exists yet. Use the real cultist death anim as an interim until proper
    // charred-corpse art is extracted (tracked by F2.flare.charred-death).
    if (state === CultistState.Dead && prevState === CultistState.Burning) {
      this.anim.play(STATE_ANIM_MAP[CultistState.Dead], now);
      return;
    }
    this.anim.play(STATE_ANIM_MAP[state], now);
  }

  private setFacing(v: { x: number; z: number }): void {
    const m = Math.hypot(v.x, v.z) || 1;
    this.facing = { x: v.x / m, z: v.z / m };
  }

  takeDamage(amount: number, vel: Vec3): void {
    const wasAlive = this.brain.state !== CultistState.Dead;
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
    const died = wasAlive && this.brain.state === CultistState.Dead;
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
        // Sub-160 explosion kill: NotBlood converts to kDamageFall — the NORMAL
        // death anim plays on the intact flying body (gib anim is for gib deaths).
        this.anim.play('cultist-shotgun-death-normal', performance.now() / 1000);
      } else if (this.brain.state !== CultistState.Dead) {
        this.brain.launch();
        // launch() happens between frames — the update() prev/state diff never
        // sees it, so trigger the airborne anim explicitly
        this.anim.play('cultist-shotgun-recoil', performance.now() / 1000);
      }
    } else if (died) {
      // Normal (non-explosion) death. Unlike the zombie, the cultist has no
      // head-pop or kickable-head outcome (resolveDeathOutcome's head paths are
      // zombie-only — isZombie=false here), so there's no decision to consult:
      // just play the death anim. SFX comes from the onDeath hook.
      this.anim.play('cultist-shotgun-death-normal', performance.now() / 1000);
    }
  }

  /** Marks the cultist as gibbed — cluster reaps immediately. */
  onGibbed(): void {
    this.gibbed = true;
    this.anim.object.visible = false;
    // Body torn apart — the fire goes with it (kills the orphan flame that
    // otherwise keeps burning at the last body position for its full 6s).
    for (const f of this.stuckFlares) f.extinguish();
  }

  /** Dead-but-not-gibbed — a persistent, re-gibbable corpse. */
  get isCorpse(): boolean {
    return this.brain.state === CultistState.Dead && !this.gibbed;
  }

  /** Still in ballistic flight (alive launch or flung corpse). */
  get isAirborne(): boolean { return this.ballistic !== null; }

  /** Wallclock seconds when this cultist died (-1 if alive). Used by the corpse cap. */
  getDeathTime(): number { return this.deathTime; }

  /** Ready to be reaped: gibbed immediately, or a corpse past its lifetime
   *  (corpses persist as re-gibbable props — cap enforced by the cluster). */
  shouldReap(): boolean {
    if (this.gibbed) return true;
    if (this.brain.state !== CultistState.Dead || this.deathTime < 0) return false;
    if (this.ballistic) return false; // still flying
    return performance.now() / 1000 - this.deathTime > CORPSE.reapAfterSec;
  }

  despawn(): void {
    // Detach stuck flares BEFORE freeing the Rapier body — the global flare
    // registry still updates them, and translation() on a freed handle traps
    // Rapier WASM (2026-04-28 playtest game-freeze).
    for (const f of this.stuckFlares) f.detach();

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
