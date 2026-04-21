import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec3, TrailSource, TrailHandle } from './particles';
import { ParticlePool } from './particles';
import type { DecalPool } from './decals';
import { BLOOD_TRAIL, buPerTicSquaredToMpsSquared } from './tuning';

/** A single body-chunk: Rapier dynamic body + billboard sprite + trail handle. */
interface Chunk {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  trail: TrailHandle;
  spawnTime: number;
  settledTime: number;    // -1 if not yet settled
}

/** Loaded atlas with the body-chunk textures keyed by picnum. */
export interface ChunkTextureAtlas {
  // picnum → THREE.Texture
  get(picnum: number): THREE.Texture;
}

/**
 * Rapier body-part flight system. ONLY file that changes for M3 voxel swap:
 * replace billboard PlaneGeometry with voxel meshes loaded from .vox files;
 * keep the same spawnChunks() signature.
 */
export class ChunkSystem {
  private chunks: Chunk[] = [];

  /** Picnums for axe-zombie body chunks — order: head, torso, arm, leg, spare. */
  private readonly axeZombieChunks = [1267, 1454, 1268, 1269, 1456];

  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly particles: ParticlePool,
    private readonly atlas: ChunkTextureAtlas,
    private readonly capacity = 1024,
    private readonly decals?: DecalPool,
  ) {}

  /**
   * Spawn 5 body-chunks at `origin`, launched radially + augmented by `impulse`.
   * `impulse` vector's magnitude should be in physics impulse units (kg·m/s).
   */
  spawnChunks(origin: Vec3, impulse: Vec3, now: number): void {
    for (let i = 0; i < this.axeZombieChunks.length; i++) {
      this.spawnOne(origin, impulse, this.axeZombieChunks[i]!, i, now);
    }

    // FIFO-evict if over capacity
    while (this.chunks.length > this.capacity) {
      this.despawn(this.chunks[0]!);
      this.chunks.shift();
    }
  }

  private spawnOne(
    origin: Vec3,
    impulse: Vec3,
    picnum: number,
    index: number,
    now: number,
  ): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinearDamping(0.1)
      .setAngularDamping(0.2);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(0.05, 0.08)
      .setRestitution(0.35)
      .setFriction(0.5);
    this.world.createCollider(colliderDesc, body);

    // Radial outward direction plus explosion impulse
    const count = this.axeZombieChunks.length;
    const theta = (index / count) * Math.PI * 2 + Math.random() * 0.8;
    const radial = {
      x: Math.cos(theta),
      y: 0.5 + Math.random() * 0.5,     // up-biased
      z: Math.sin(theta),
    };
    const radialSpeed = 2.5 + Math.random() * 2.0;
    body.setLinvel(
      {
        x: radial.x * radialSpeed + impulse.x * 0.01,
        y: radial.y * radialSpeed + impulse.y * 0.01,
        z: radial.z * radialSpeed + impulse.z * 0.01,
      },
      true,
    );
    body.setAngvel(
      {
        x: (Math.random() - 0.5) * 10,
        y: (Math.random() - 0.5) * 10,
        z: (Math.random() - 0.5) * 10,
      },
      true,
    );

    // Billboard sprite
    const geom = new THREE.PlaneGeometry(0.3, 0.3);
    const tex = this.atlas.get(picnum);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    this.scene.add(mesh);

    // Attach a trail whose source follows this chunk's Rapier body.
    // TrailSource reads .pos and .vel each emit tick; we use live getters.
    const source: TrailSource = {
      get pos() {
        const t = body.translation();
        return { x: t.x, y: t.y, z: t.z };
      },
      get vel() {
        const v = body.linvel();
        return { x: v.x, y: v.y, z: v.z };
      },
    };
    const trail = this.particles.emitTrail(source, {
      tile: BLOOD_TRAIL.tile,
      hz: BLOOD_TRAIL.emitHz,
      velScale: BLOOD_TRAIL.velScale,
      gravity: buPerTicSquaredToMpsSquared(BLOOD_TRAIL.gravityBlood),
      airdrag: 0.5, // hand-tuned starting value; Blood's raw 4096 doesn't map directly
      lifetimeSec: BLOOD_TRAIL.lifetimeSec,
      size: 0.08,
      onSurfaceHit: (pos: Vec3, normal: Vec3) => {
        this.decals?.spawn(pos, normal);
      },
    });

    this.chunks.push({ body, mesh, trail, spawnTime: now, settledTime: -1 });
  }

  /** Update chunk transforms + check for settle/age despawn. Called per frame. */
  update(camera: THREE.Camera | null, now: number): void {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i]!;
      const t = c.body.translation();
      c.mesh.position.set(t.x, t.y, t.z);
      if (camera) c.mesh.lookAt(camera.position);

      const v = c.body.linvel();
      const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (speed < 0.1) {
        if (c.settledTime < 0) c.settledTime = now;
        if (now - c.settledTime > 1.0) {
          this.despawn(c);
          this.chunks.splice(i, 1);
          continue;
        }
      } else {
        c.settledTime = -1;
      }

      if (now - c.spawnTime > 10.0) {
        this.despawn(c);
        this.chunks.splice(i, 1);
      }
    }
  }

  private despawn(c: Chunk): void {
    c.trail.stop();
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    (c.mesh.material as THREE.Material).dispose();
    this.world.removeRigidBody(c.body);
  }

  aliveCount(): number {
    return this.chunks.length;
  }

  reset(): void {
    for (const c of this.chunks) this.despawn(c);
    this.chunks = [];
  }
}
