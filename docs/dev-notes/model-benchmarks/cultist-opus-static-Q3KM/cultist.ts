import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CultistBrain, CultistState } from './cultist-ai';
import { CULTIST_TOMMY, GIB_THRESHOLD } from '../gibs/tuning';
import type { GibProfile } from '../gibs/tuning';
import { BillboardAnimator } from '../../animation/billboard-animator';
import type { Vec3 } from '../gibs/particles';
import { SfxEvent } from '../../audio/events';
import type { Sfx } from '../../audio/sfx';

/** Interface implemented by any enemy that can be gibbed by explosions. */
export interface GibbableDude {
  readonly id: string;
  readonly kind: string;
  hp: number;
  pos: Vec3;
  takeDamage(amount: number, impulse: Vec3): void;
  despawn(): void;
}

/** State → SEQ manifest name mapping (placeholder names until asset extraction). */
const STATE_ANIM_MAP: Record<CultistState, string> = {
  [CultistState.Idle]: 'cultist-stand',
  [CultistState.Chase]: 'cultist-chase',
  [CultistState.Aim]: 'cultist-aim',
  [CultistState.Shoot]: 'cultist-shoot',
  [CultistState.Reload]: 'cultist-reload',
  [CultistState.Stagger]: 'cultist-recoil',
  [CultistState.Dead]: 'cultist-death',
};

/** Duration of the "blown away" fling when a cultist dies to explosion damage. */
const FLING_DURATION_SEC = 0.5;
const FLING_IMPULSE_SCALE = 0.015;

export class Cultist implements GibbableDude {
  readonly id: string;
  readonly kind = 'cultist' as const;
  readonly gibProfile: GibProfile = {
    fleshPicnums: [1454, 1268, 1269, 1456, 1267],
    bonePicnums: [421, 446, 447],
    boneWeight: 0.2,
    bodyPartCount: { min: 2, max: 4 },
    chunkCount: { min: 8, max: 14 },
  };

  hp: number = CULTIST_TOMMY.hp;
  private _sfx: Sfx | null = null;
  readonly brain = new CultistBrain(
    { hp: CULTIST_TOMMY.hp, speed: CULTIST_TOMMY.shotsPerBurst },
    {
      onAggroTransition: () => this._sfx?.play(SfxEvent.ZOMBIE_AGGRO, this.pos),
      onShot: () => this._sfx?.play(SfxEvent.CULTIST_TOMMY_SHOT, this.pos),
    },
  );

  /** Wire the SFX engine for cultist sounds. */
  setSfx(sfx: Sfx): void { this._sfx = sfx; }

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
    this.anim.play(STATE_ANIM_MAP[CultistState.Idle], 0);
  }

  static spawn(
    id: string,
    world: RAPIER.World,
    scene: THREE.Scene,
    anim: BillboardAnimator,
    pos: Vec3,
  ): Cultist {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.25), body);

    return new Cultist(id, world, scene, body, anim);
  }

  get pos(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Update AI, movement, and animation state transitions. */
  update(dt: number, playerPos: Vec3, camera: THREE.Camera): void {
    const prev = this.brain.state;
    this.brain.update(dt, this.pos, playerPos);

    // Detect state change → trigger new animation
    if (this.brain.state !== prev) {
      this.onStateEnter(this.brain.state, performance.now() / 1000);
    }

    // SFX: trigger on first shot of a burst
    if (this.brain.state === CultistState.Shoot && prev !== CultistState.Shoot) {
      this._sfx?.play(SfxEvent.CULTIST_TOMMY_SHOT, this.pos);
    }

    const t = this.body.translation();
    if (this.flingVel && this.flingTimer > 0) {
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
      if (this.brain.state !== CultistState.Dead && Math.hypot(v.x, v.z) > 0.01) {
        this.setFacing({ x: v.x, z: v.z });
      }
    }

    // Billboard render update
    const now = performance.now() / 1000;
    const trans = this.body.translation();
    this.anim.update(
      now,
      { x: trans.x, y: trans.y, z: trans.z },
      this.facing,
      camera.position,
    );
  }

  private onStateEnter(state: CultistState, now: number): void {
    this.anim.play(STATE_ANIM_MAP[state], now);
  }

  private setFacing(v: { x: number; z: number }): void {
    const m = Math.hypot(v.x, v.z) || 1;
    this.facing = { x: v.x / m, z: v.z / m };
  }

  takeDamage(amount: number, impulse: Vec3): void {
    const wasAlive = this.brain.state !== CultistState.Dead;
    this.brain.takeDamage(amount);
    this.hp = this.brain.hp;
    if (wasAlive && this.brain.state === CultistState.Dead) {
      this.deathTime = performance.now() / 1000;
    }

    const impulseMag = Math.hypot(impulse.x, impulse.y, impulse.z);
    if (wasAlive && this.brain.state === CultistState.Dead && impulseMag > GIB_THRESHOLD) {
      this.flingVel = {
        x: impulse.x * FLING_IMPULSE_SCALE,
        y: 0,
        z: impulse.z * FLING_IMPULSE_SCALE,
      };
      this.flingTimer = FLING_DURATION_SEC;
    }
  }

  onGibbed(): void {
    this.gibbed = true;
    this.anim.object.visible = false;
  }

  shouldReap(): boolean {
    if (this.gibbed) return true;
    if (this.brain.state !== CultistState.Dead || this.deathTime < 0) return false;
    if (this.flingVel && this.flingTimer > 0) return false;
    const graceSec = this.flingVel ? 0 : 1.5;
    return performance.now() / 1000 - this.deathTime > graceSec;
  }

  despawn(): void {
    this.scene.remove(this.anim.object);
    this.anim.dispose();
    this.world.removeRigidBody(this.body);
  }
}
