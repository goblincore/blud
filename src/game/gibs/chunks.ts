import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec3, TrailSource, TrailHandle } from './particles';
import { ParticlePool } from './particles';
import type { DecalPool } from './decals';
import { BLOOD_TRAIL, buPerTicSquaredToMpsSquared, pickChunkPicnum, rollChunkCount, type GibProfile } from './tuning';
import type { Sfx } from '../../audio/sfx';
import { SfxEvent } from '../../audio/events';

/** A single body-chunk: Rapier dynamic body + billboard sprite + trail handle. */
interface Chunk {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  trail: TrailHandle;
  spawnTime: number;
  settledTime: number;    // -1 if not yet settled
  /** The iconic bouncing zombie head — longer lifetime, no settle-despawn so it can be kicked. */
  isHead?: boolean;
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
  private sfx: Sfx | null = null;

  /** Picnum for the iconic bouncing zombie head (kickable — Blood signature). */
  private readonly zombieHeadPicnum = 3405;

  /** Wire the SFX engine for gib splat sounds. */
  setSfx(sfx: Sfx): void { this.sfx = sfx; }

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
  spawnChunks(origin: Vec3, impulse: Vec3, profile: GibProfile, now: number, rng: () => number = Math.random): void {
    const count = rollChunkCount(profile.bodyPartCount, rng);
    for (let i = 0; i < count; i++) {
      const picnum = pickChunkPicnum(profile, rng);
      this.spawnOne(origin, impulse, picnum, i, count, now);
    }
    // Bouncing head — the one you can kick around. Larger sphere collider, higher
    // restitution, no settle-despawn (age-despawn only, longer lifetime).
    this.spawnHead(origin, impulse, now);

    // FIFO-evict if over capacity
    while (this.chunks.length > this.capacity) {
      this.despawn(this.chunks[0]!);
      this.chunks.shift();
    }
  }

  private spawnHead(origin: Vec3, impulse: Vec3, now: number): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y + 0.3, origin.z)
      .setLinearDamping(0.4) // more drag so it settles into rolling, not sliding forever
      .setAngularDamping(0.3);
    const body = this.world.createRigidBody(bodyDesc);

    // Ball collider — rolls when kicked, pronouncedly bouncy
    const colliderDesc = RAPIER.ColliderDesc.ball(0.18)
      .setRestitution(0.65)
      .setFriction(0.7)
      .setDensity(0.4);
    this.world.createCollider(colliderDesc, body);

    // Launch up + slightly back from explosion
    const up = 4.0 + Math.random() * 2.0;
    body.setLinvel(
      {
        x: impulse.x * 0.008 + (Math.random() - 0.5) * 2,
        y: up,
        z: impulse.z * 0.008 + (Math.random() - 0.5) * 2,
      },
      true,
    );
    body.setAngvel(
      { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 },
      true,
    );

    // Larger billboard than regular chunks
    const geom = new THREE.PlaneGeometry(0.45, 0.45);
    const tex = this.atlas.get(this.zombieHeadPicnum);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    this.scene.add(mesh);

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
      gravity: 6.0,
      airdrag: 0.5,
      lifetimeSec: 2.5,
      size: 0.18,
      onSurfaceHit: (pos: Vec3, normal: Vec3) => { this.decals?.spawn(pos, normal); },
    });

    // Mark this chunk as the kickable head: no settle-despawn, longer max age.
    this.chunks.push({
      body,
      mesh,
      trail,
      spawnTime: now,
      settledTime: -1,
      isHead: true,
    });
  }

  private spawnOne(
    origin: Vec3,
    impulse: Vec3,
    picnum: number,
    index: number,
    totalCount: number,
    now: number,
  ): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinearDamping(0.04)  // less drag — Blood chunks keep flying
      .setAngularDamping(0.1);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(0.05, 0.08)
      .setRestitution(0.55)    // bouncier — Blood chunks skip off floors
      .setFriction(0.35);
    this.world.createCollider(colliderDesc, body);

    // Radial outward direction plus explosion impulse
    const count = totalCount;
    const theta = (index / count) * Math.PI * 2 + Math.random() * 0.8;
    const radial = {
      x: Math.cos(theta),
      y: 0.8 + Math.random() * 0.8,   // stronger up-bias — chunks arc high
      z: Math.sin(theta),
    };
    const radialSpeed = 5.0 + Math.random() * 4.0;   // 5-9 m/s (was 2.5-4.5)
    body.setLinvel(
      {
        x: radial.x * radialSpeed + impulse.x * 0.025, // 2.5× impulse influence
        y: radial.y * radialSpeed + impulse.y * 0.025,
        z: radial.z * radialSpeed + impulse.z * 0.025,
      },
      true,
    );
    body.setAngvel(
      {
        x: (Math.random() - 0.5) * 18, // faster tumble
        y: (Math.random() - 0.5) * 18,
        z: (Math.random() - 0.5) * 18,
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
      // NOTE: buPerTicSquaredToMpsSquared(27962) = 1.5M m/s² — particles vanish in one frame.
      // The Blood rawvalue is in Build's fixed-point format that doesn't translate cleanly;
      // use real gravity slightly damped for "hang time" feel.
      gravity: 6.0,
      airdrag: 0.5, // hand-tuned starting value
      lifetimeSec: 2.5, // lowered from 4s — sooner cleanup, denser-looking trails
      size: 0.18, // bumped from 0.08 — 8cm was barely visible at game distance
      onSurfaceHit: (pos: Vec3, normal: Vec3) => {
        this.decals?.spawn(pos, normal);
      },
    });

    this.chunks.push({ body, mesh, trail, spawnTime: now, settledTime: -1 });
    this.sfx?.play(SfxEvent.GIB_SPLAT, origin);
  }

  /** Update chunk transforms + check for settle/age despawn. Called per frame. */
  update(camera: THREE.Camera | null, now: number): void {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i]!;
      const t = c.body.translation();
      c.mesh.position.set(t.x, t.y, t.z);
      if (camera) c.mesh.lookAt(camera.position);

      // No time-based despawn — chunks stay until FIFO eviction at capacity
      // (1024). This lets the arena accumulate gore across a play session,
      // matching Blood's "gib piles stay" feel. Spawning the 1025th chunk
      // quietly drops the oldest (see spawnChunks FIFO loop).
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
