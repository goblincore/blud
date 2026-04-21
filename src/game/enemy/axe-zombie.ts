import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ZombieBrain, ZombieState } from './ai';
import { AXE_ZOMBIE } from '../gibs/tuning';
import { BillboardAnimator } from '../../animation/billboard-animator';
import type { Vec3 } from '../gibs/particles';

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
};

export class AxeZombie implements GibbableDude {
  readonly id: string;
  readonly kind = 'axe-zombie' as const;

  hp: number = AXE_ZOMBIE.hp;
  readonly brain = new ZombieBrain({ hp: AXE_ZOMBIE.hp, speed: AXE_ZOMBIE.speed });

  private readonly anim: BillboardAnimator;
  private readonly body: RAPIER.RigidBody;
  private readonly world: RAPIER.World;
  private readonly scene: THREE.Scene;
  private facing = { x: 0, z: 1 };
  private prevState: ZombieState = ZombieState.Idle;

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

    // Kinematic move
    const v = this.brain.desiredVelocity(this.pos, playerPos);
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + v.x * dt, y: t.y, z: t.z + v.z * dt });

    // Update facing direction from velocity
    if (Math.hypot(v.x, v.z) > 0.01) {
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
  }

  private onStateEnter(state: ZombieState, now: number): void {
    this.anim.play(STATE_ANIM_MAP[state], now);
  }

  private setFacing(v: { x: number; z: number }): void {
    const m = Math.hypot(v.x, v.z) || 1;
    this.facing = { x: v.x / m, z: v.z / m };
  }

  takeDamage(amount: number, _impulse: Vec3): void {
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
  }

  despawn(): void {
    this.scene.remove(this.anim.object);
    this.anim.dispose();
    this.world.removeRigidBody(this.body);
  }
}
