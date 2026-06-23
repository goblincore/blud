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

/** Sim-driven cosmetic anim hint — derived from `DudeRender.ai` in main.ts and
 *  fed in via `setSimDrive`. The sim owns the cultist's AI; this is the cosmetic
 *  anim-state mapping (Idle→idle, Chase/Goto/Search/Dodge/SThrow→walk,
 *  SFire→fire, Recoil→recoil). */
export type CultistSimAnim = 'idle' | 'walk' | 'fire' | 'recoil';

const SIM_ANIM_MAP: Record<CultistSimAnim, string> = {
  idle: 'cultist-shotgun-idle',
  walk: 'cultist-shotgun-chase',
  fire: 'cultist-shotgun-fire',
  recoil: 'cultist-shotgun-recoil',
};

/** One frame of sim drive for the cosmetic cultist (meters + radians). main.ts
 *  reads `sim.dudeRenders()[idx]`, maps the ai → `CultistSimAnim`, and calls
 *  `setSimDrive` each fixed step. `yMeters` is kept for API parity but unused —
 *  the body's y stays at its spawn height (see the billboard anchor note). */
export interface CultistSimDrive {
  xMeters: number; yMeters: number; zMeters: number;
  yawRad: number;
  anim: CultistSimAnim;
}


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

  // ——— Sim drive (Plan 4) ————————————————————————————
  // The deterministic sim owns the cultist's AI / movement / fire / aggro; this
  // cosmetic object keeps the sim dude's index so main.ts can feed each frame's
  // interpolated transform + anim hint in via `setSimDrive`. The Rapier body is
  // now a passive collision proxy (for flare sticking) driven from the sim.
  /** Index into `sim.dudeRenders()` for this cultist (-1 = not sim-driven). */
  simDudeIndex = -1;
  /** Latest sim drive (position + facing + anim hint); null when dead/unset. */
  private simDrive: CultistSimDrive | null = null;
  /** Bridge: called when this cosmetic cultist dies so the sim dude stops acting. */
  onSimKill?: () => void;
  /** Bridge: called on a non-lethal player-weapon hit so the sim AI reacts. */
  onSimRecoil?: () => void;

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

  /** Feed one frame of sim drive (position + facing + anim hint). Called by
   *  main.ts each fixed step before `update`. Null/`clearSimDrive` lets the
   *  cosmetic death/launch path take over (a dead sim dude has health 0). */
  setSimDrive(d: CultistSimDrive): void { this.simDrive = d; }
  clearSimDrive(): void { this.simDrive = null; }

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

    // Sim owns the cultist's AI / movement / fire / LOS (Plan 4). Only the
    // legacy cosmetic burn-state is managed here (flares are a player→dude
    // weapon the sim doesn't model); the full FSM is intentionally NOT run.
    this.brain.updateBurnState(this.stuckFlares.length, anyIgnited);

    // Death / burn-state change. The sim owns the AI-state anim, so only the
    // legacy cosmetic states (Dead / Burning) drive an anim here; the
    // sim-driven anim (idle/walk/fire/recoil) is applied below from simDrive.
    if (this.brain.state !== prev) {
      if (this.brain.state === CultistState.Dead && this.deathTime < 0) {
        // deathTime may already be stamped by takeDamage (explosion deaths) —
        // the < 0 guard makes this the fallback for DoT/burn deaths.
        this.deathTime = now;
        this.onStateEnter(CultistState.Dead, now, prev);
        if (prev === CultistState.Burning) this.onBurnDeath?.(this.pos, now);
        this.onSimKill?.(); // bridge: sim dude stops acting (health → 0)
      } else if (this.brain.state === CultistState.Burning) {
        this.onStateEnter(CultistState.Burning, now, prev);
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
    } else if (this.simDrive && this.brain.state !== CultistState.Dead) {
      // SIM-DRIVEN position (Plan 4): the Rapier body is now a passive collision
      // proxy (flare sticking) driven from the deterministic sim each frame.
      // Only x/z are driven — y stays at spawn height (the billboard anchor
      // expects the body center near y=1; the sim dude's feet are at y=0).
      this.body.setNextKinematicTranslation({
        x: this.simDrive.xMeters, y: t.y, z: this.simDrive.zMeters,
      });
      // Facing from the sim yaw. Blood facing θ moves toward (-sinθ,-cosθ) in
      // (x,z) (see sim trig.yawRotate); the billboard's angle-variant picker
      // wants that world direction.
      this.facing = {
        x: -Math.sin(this.simDrive.yawRad),
        z: -Math.cos(this.simDrive.yawRad),
      };
      // Sim anim hint (burn anim was played above if Burning). play() is
      // idempotent for the same name, so this only restarts on a real change.
      if (this.brain.state !== CultistState.Burning) {
        this.anim.play(SIM_ANIM_MAP[this.simDrive.anim], now);
      }
    }
    // else: Dead (or no sim drive yet) — body rests at its last position; the
    //   death anim was played by takeDamage / the burn-death path above.

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

    // Bridge player→dude damage to the sim (Plan 4 boundary decision: player
    // weapons stay legacy-driven). On death the sim dude is killed (stops
    // acting); a non-lethal hit forces a Recoil→Dodge reaction so the AI reacts.
    if (wasAlive) {
      if (died) this.onSimKill?.();
      else this.onSimRecoil?.();
    }

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
    // Bridge: the GibSystem destroys the body directly (not via takeDamage), so
    // kill the sim dude here too — otherwise it keeps acting after being gibbed.
    if (this.deathTime < 0) this.deathTime = performance.now() / 1000;
    this.onSimKill?.();
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
