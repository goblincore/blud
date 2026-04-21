import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ZombieBrain, ZombieState } from './ai';
import { AXE_ZOMBIE } from '../gibs/tuning';
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

export interface ZombieTextureAtlas {
  idle(): THREE.Texture;
  walk(stepFrac: number): THREE.Texture;  // 0..1 stride phase
  attack(phaseFrac: number): THREE.Texture; // 0..1 swing phase
  dead(): THREE.Texture;
}

export class AxeZombie implements GibbableDude {
  readonly id: string;
  readonly kind = 'axe-zombie' as const;

  hp: number = AXE_ZOMBIE.hp;
  readonly brain = new ZombieBrain({ hp: AXE_ZOMBIE.hp, speed: AXE_ZOMBIE.speed });

  private stepPhase = 0;
  private attackPhase = 0;

  constructor(
    id: string,
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly body: RAPIER.RigidBody,
    private readonly mesh: THREE.Mesh,
    private readonly atlas: ZombieTextureAtlas,
  ) {
    this.id = id;
  }

  static spawn(
    id: string,
    world: RAPIER.World,
    scene: THREE.Scene,
    atlas: ZombieTextureAtlas,
    pos: Vec3,
  ): AxeZombie {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.25), body);

    const geom = new THREE.PlaneGeometry(1.0, 1.6);
    const mat = new THREE.MeshBasicMaterial({ map: atlas.idle(), transparent: true });
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);

    return new AxeZombie(id, world, scene, body, mesh, atlas);
  }

  get pos(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  update(dt: number, playerPos: Vec3, camera: THREE.Camera): void {
    this.brain.update(dt, this.pos, playerPos);

    // Kinematic move
    const v = this.brain.desiredVelocity(this.pos, playerPos);
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + v.x * dt, y: t.y, z: t.z + v.z * dt });

    // Animation frame selection
    this.stepPhase = (this.stepPhase + dt * 2) % 1.0;
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    switch (this.brain.state) {
      case ZombieState.Idle:    mat.map = this.atlas.idle(); break;
      case ZombieState.Chase:   mat.map = this.atlas.walk(this.stepPhase); break;
      case ZombieState.Stagger: mat.map = this.atlas.walk(this.stepPhase); break;
      case ZombieState.Attack:
        this.attackPhase = (this.attackPhase + dt * 2) % 1.0;
        mat.map = this.atlas.attack(this.attackPhase);
        break;
      case ZombieState.Dead:    mat.map = this.atlas.dead(); break;
    }
    mat.needsUpdate = true;

    // Render transform
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.lookAt(camera.position);
    this.mesh.rotation.x = 0; // keep upright — only yaw follows camera
    this.mesh.rotation.z = 0;
  }

  takeDamage(amount: number, _impulse: Vec3): void {
    this.brain.applyDamage(amount);
    this.hp = this.brain.hp;
  }

  despawn(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.world.removeRigidBody(this.body);
  }
}
