import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec3 } from './particles';

// ——— Tuning ————————————————————————————————————

/**
 * NotBlood does NOT have a launched-corpse mechanic — death from explosion
 * (kDamageExplode) fully gibs the enemy. This is a Blud-original embellishment
 * for gameplay feel: when explosion damage exceeds the gib threshold AND impulse
 * magnitude exceeds LAUNCHED_CORPSE.impulseThreshold, the enemy spawns a single
 * dynamic-body corpse that tumbles, bounces off arena geometry, and settles as
 * a static decal.
 */
export const LAUNCHED_CORPSE = {
  impulseThreshold: 8.0,
  linearDamping: 0.1,
  angularDamping: 0.3,
  restingVelocityMps: 0.2,
  settleFrames: 60,           // 1 second @ 60fps
  bodySize: { halfX: 0.4, halfY: 0.6, halfZ: 0.4 },
  spriteScale: 1.5,           // meters — larger than enemy sprite for readability
  minAgeSec: 0.5,             // don't settle before this age (tumbling phase)
  maxAgeSec: 15.0,            // force-despawn after this
} as const;

// ——— Corpse entity ————————————————————————————

export interface LaunchedCorpseDeps {
  world: RAPIER.World;
  scene: THREE.Scene;
  getTileTexture: (tile: number) => THREE.Texture | null;
}

/**
 * A single dynamic-body corpse that tumbles after an above-threshold explosion
 * kill. Settles into a static decal once it has been near-resting for settleFrames.
 */
export class LaunchedCorpse {
  private body: RAPIER.RigidBody;
  private mesh: THREE.Mesh;
  private spawnTime: number;
  private settleCount = 0;
  private expired = false;

  constructor(
    pos: Vec3,
    impulse: Vec3,
    spriteTile: number,
    now: number,
    deps: LaunchedCorpseDeps,
  ) {
    this.spawnTime = now;

    // Dynamic body — capsule for corpse-like shape
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + LAUNCHED_CORPSE.bodySize.halfY, pos.z)
      .setLinearDamping(LAUNCHED_CORPSE.linearDamping)
      .setAngularDamping(LAUNCHED_CORPSE.angularDamping)
      .setCanSleep(false);
    this.body = deps.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(
      LAUNCHED_CORPSE.bodySize.halfY,
      LAUNCHED_CORPSE.bodySize.halfX,
    )
      .setRestitution(0.35)
      .setFriction(0.6)
      .setDensity(0.5);
    deps.world.createCollider(colliderDesc, this.body);

    // Apply explosion impulse
    this.body.setLinvel(
      { x: impulse.x * 0.015, y: impulse.y * 0.015 + 3.0, z: impulse.z * 0.015 },
      true,
    );
    this.body.setAngvel(
      { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 },
      true,
    );

    // Billboard sprite
    const tex = deps.getTileTexture(spriteTile);
    const geom = new THREE.PlaneGeometry(
      LAUNCHED_CORPSE.spriteScale,
      LAUNCHED_CORPSE.spriteScale,
    );
    const mat = new THREE.MeshBasicMaterial({
      map: tex ?? undefined,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.frustumCulled = false;
    deps.scene.add(this.mesh);
  }

  /** Update sprite to follow body, check settle conditions. Returns false when expired. */
  update(now: number, camera: THREE.Camera): boolean {
    if (this.expired) return false;

    const age = now - this.spawnTime;

    // Force-despawn
    if (age > LAUNCHED_CORPSE.maxAgeSec) {
      this.expired = true;
      return false;
    }

    // Sync mesh to body
    const t = this.body.translation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.lookAt(camera.position);

    // Settle check: after minAge, count frames where linear velocity < restingThreshold
    if (age >= LAUNCHED_CORPSE.minAgeSec) {
      const linvel = this.body.linvel();
      const speed = Math.hypot(linvel.x, linvel.y, linvel.z);
      if (speed < LAUNCHED_CORPSE.restingVelocityMps) {
        this.settleCount++;
      } else {
        this.settleCount = 0;
      }

      if (this.settleCount >= LAUNCHED_CORPSE.settleFrames) {
        // Settled: remove dynamic body, leave mesh at rest position
        this.expired = true;
        return false;
      }
    }

    return true;
  }

  /** Final position after settle — for spawning a decal. */
  getFinalPos(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Clean up Rapier body and Three.js mesh. */
  dispose(deps: LaunchedCorpseDeps): void {
    deps.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    deps.world.removeRigidBody(this.body);
  }

  isExpired(): boolean { return this.expired; }
}

// ——— Manager ————————————————————————————————

export class LaunchedCorpseManager {
  private corpses: LaunchedCorpse[] = [];

  spawn(
    pos: Vec3,
    impulse: Vec3,
    spriteTile: number,
    now: number,
    deps: LaunchedCorpseDeps,
  ): void {
    this.corpses.push(new LaunchedCorpse(pos, impulse, spriteTile, now, deps));
  }

  update(now: number, camera: THREE.Camera, deps: LaunchedCorpseDeps): void {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i]!;
      const alive = c.update(now, camera);
      if (!alive) {
        c.dispose(deps);
        this.corpses.splice(i, 1);
      }
    }
  }

  clear(deps: LaunchedCorpseDeps): void {
    for (const c of this.corpses) c.dispose(deps);
    this.corpses.length = 0;
  }

  aliveCount(): number { return this.corpses.length; }
}
