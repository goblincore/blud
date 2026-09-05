import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CultistBrain, CultistState } from './cultist-ai';
import { CULTIST_TOMMY } from '../gibs/tuning';
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

/** State → SEQ manifest name mapping (from Task 2 extraction). */
const STATE_ANIM_MAP: Record<CultistState, string> = {
  [CultistState.Idle]: 'cultist-stand',
  [CultistState.Chase]: 'cultist-chase',
  [CultistState.Aim]: 'cultist-aim',
  [CultistState.Shoot]: 'cultist-shoot',
  [CultistState.Reload]: 'cultist-reload',
  [CultistState.Stagger]: 'cultist-recoil',
  [CultistState.Dead]: 'cultist-death',
};

export class Cultist implements GibbableDude {
  readonly id: string;
  readonly kind = 'cultist' as const;
  readonly gibProfile: GibProfile = {
    fleshPicnums: [],
    bonePicnums: [],
    boneWeight: 0,
    bodyPartCount: { min: 0, max: 0 },
    chunkCount: { min: 0, max: 0 },
  };

  hp: number = CULTIST_TOMMY.hp;
  private _sfx: Sfx | null = null;
  readonly brain = new CultistBrain(
    { hp: CULTIST_TOMMY.hp, speed: CULTIST_TOMMY.speed },
    {
      onAggroTransition: () => this._sfx?.play(SfxEvent.ZOMBIE_AGGRO, this.pos),
      onShot: () => this._sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos),
    },
  );

  /** Wire the SFX engine for cultist sounds. */
  setSfx(sfx: Sfx): void { this._sfx = sfx; }

  private readonly anim: BillboardAnimator;
  private readonly body: RAPIER.RigidBody;
  private readonly world: RAPIER.World;
  private readonly scene: THREE.Scene;
  private facing = { x: 0, z: 1 };

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
    this.anim.play('cultist-stand', 0);
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
      this.anim.play(STATE_ANIM_MAP[this.brain.state], performance.now() / 1000);
    }

    // Kinematic move driven by AI
    const v = this.brain.desiredVelocity(this.pos, playerPos);
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + v.x * dt, y: t.y, z: t.z + v.z * dt });
    // Update facing direction from velocity (skip when dead)
    if (this.brain.state !== CultistState.Dead && Math.hypot(v.x, v.z) > 0.01) {
      this.setFacing({ x: v.x, z: v.z });
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

    // Fire SFX on state transition to Shoot
    if (prev !== CultistState.Shoot && this.brain.state === CultistState.Shoot) {
      this._sfx?.play(SfxEvent.ZOMBIE_DEATH, this.pos);
    }
  }

  private setFacing(v: { x: number; z: number }): void {
    const m = Math.hypot(v.x, v.z) || 1;
    this.facing = { x: v.x / m, z: v.z / m };
  }

  takeDamage(amount: number, impulse: Vec3): void {
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
  }

  /** Marks the cultist as gibbed. */
  onGibbed(): void {
    this.anim.object.visible = false;
  }

  /** Whether the cultist is ready to be reaped. */
  shouldReap(): boolean {
    return this.brain.isDead();
  }

  despawn(): void {
    this.scene.remove(this.anim.object);
    this.anim.dispose();
    this.world.removeRigidBody(this.body);
  }
}
