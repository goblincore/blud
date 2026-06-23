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

/** Explicit spawn origin + velocity for the head gib — NotBlood launches the
 *  head from the sprite TOP at half the body's velocity plus an up-kick
 *  (actor.cpp:3196: GetSpriteExtents top, vel (xvel/2, yvel/2, -0xccccc)). */
export interface HeadLaunch {
  origin: Vec3;
  /** Launch velocity in m/s — set directly on the Rapier body via setLinvel. */
  vel: Vec3;
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

  /** When set, head spawns route to the deterministic sim instead of a cosmetic
   *  Rapier body — the sim owns the kickable head (plan 3.5). The billboard is
   *  driven from sim.headRenders() in main.ts. Both head sources (the 25% normal
   *  popHead and the explosion-launched head) funnel through spawnHeadChunk, so
   *  this single hook captures both. */
  spawnHeadHook: ((origin: Vec3, vel: Vec3) => void) | null = null;

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
   * Spawn body-chunks at `origin`, launched radially + augmented by `launchVel`
   * (the explosion's concussion velocity for this dude, in m/s).
   * @param headLaunch Optional explicit origin+velocity for the kickable head. When omitted, a default is derived from launchVel (half-inherit + up-kick).
   */
  spawnChunks(
    origin: Vec3,
    launchVel: Vec3,
    profile: GibProfile,
    now: number,
    rng: () => number = Math.random,
    headLaunch?: HeadLaunch,
  ): void {
    const count = rollChunkCount(profile.bodyPartCount, rng);
    for (let i = 0; i < count; i++) {
      const picnum = pickChunkPicnum(profile, rng);
      this.spawnOne(origin, launchVel, picnum, i, count, now);
    }
    // Bouncing head — the one you can kick around. Larger sphere collider, higher
    // restitution, no settle-despawn (age-despawn only, longer lifetime).
    // Gated on profile.spawnsKickableHead — only zombies drop the iconic head.
    if (profile.spawnsKickableHead) {
      const h = headLaunch ?? {
        origin: { x: origin.x, y: origin.y + 0.3, z: origin.z },
        vel: {
          x: launchVel.x * 0.5 + (rng() - 0.5) * 2,
          y: 4.0 + rng() * 2.0,
          z: launchVel.z * 0.5 + (rng() - 0.5) * 2,
        },
      };
      this.spawnHeadChunk(h.origin, h.vel, now);
    }

    // FIFO-evict if over capacity
    while (this.chunks.length > this.capacity) {
      this.despawn(this.chunks[0]!);
      this.chunks.shift();
    }
  }

  /** Spawn body chunks from source-faithful NotBlood gib table entries.
   *  Each entry carries its own tile (picnum) and per-chunk velocity in Three.js
   *  m/s — the caller (GibSystem) has already axis-remapped Build→Three
   *  (vz → +y, Build -z = up) and applied the GIB_CHUNK_VELOCITY_SCALE feel
   *  knob. Mirrors GibThing's one-sprite-per-thing spawn with independent random
   *  spread per chunk (gib.cpp:409-414). Tile mapping passes the gib picnum
   *  straight to the atlas: the human gib tiles (1454/1267/1268/1269/1456) are
   *  the same picnums the atlas already serves for HUMANOID_FLESH_PICNUMS, and
   *  atlas.get falls back to the first texture on an unknown picnum (no throw).
   *  @param headLaunch Optional kickable head — caller-gated (zombie only). */
  spawnChunksFromGibs(
    origin: Vec3,
    gibs: { picnum: number; vel: Vec3 }[],
    now: number,
    headLaunch?: HeadLaunch,
  ): void {
    for (const g of gibs) {
      this.spawnChunkBody(origin, g.vel, g.picnum, now);
    }
    // Kickable head — gated on headLaunch presence, mirroring spawnChunks'
    // spawnsKickableHead gate (caller decides; zombies only).
    if (headLaunch) {
      this.spawnHeadChunk(headLaunch.origin, headLaunch.vel, now);
    }
    // FIFO-evict if over capacity (identical to spawnChunks)
    while (this.chunks.length > this.capacity) {
      this.despawn(this.chunks[0]!);
      this.chunks.shift();
    }
  }

  /** Spawn the iconic kickable zombie head at an explicit origin + velocity.
   *  Public: also used for the 25% normal-death head-pop (GibSystem.popHead). */
  spawnHeadChunk(origin: Vec3, vel: Vec3, now: number): void {
    if (this.spawnHeadHook) { this.spawnHeadHook(origin, vel); return; }
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinearDamping(0.4) // more drag so it settles into rolling, not sliding forever
      .setAngularDamping(0.3);
    const body = this.world.createRigidBody(bodyDesc);

    // Ball collider — rolls when kicked, pronouncedly bouncy
    const colliderDesc = RAPIER.ColliderDesc.ball(0.18)
      .setRestitution(0.65)
      .setFriction(0.7)
      .setDensity(0.4);
    this.world.createCollider(colliderDesc, body);

    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
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
      gravity: BLOOD_TRAIL.gravity,
      airdrag: BLOOD_TRAIL.airdrag,
      lifetimeSec: BLOOD_TRAIL.lifetimeSec,
      size: BLOOD_TRAIL.size,
      leavesSplat: true, // droplets stamp floor splats on settle (cascade)
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
    launchVel: Vec3,
    picnum: number,
    index: number,
    totalCount: number,
    now: number,
  ): void {
    // Radial outward direction plus explosion impulse (the hand-tuned Blud feel
    // burst — the non-explosion gib path; explosion gibs use spawnChunksFromGibs).
    const count = totalCount;
    const theta = (index / count) * Math.PI * 2 + Math.random() * 0.8;
    const radial = {
      x: Math.cos(theta),
      y: 0.8 + Math.random() * 0.8,   // stronger up-bias — chunks arc high
      z: Math.sin(theta),
    };
    const radialSpeed = 5.0 + Math.random() * 4.0;   // 5-9 m/s (was 2.5-4.5)
    // chunks inherit 60% of the dude's concussion velocity atop the radial burst
    const vel: Vec3 = {
      x: radial.x * radialSpeed + launchVel.x * 0.6,
      y: radial.y * radialSpeed + launchVel.y * 0.6,
      z: radial.z * radialSpeed + launchVel.z * 0.6,
    };
    this.spawnChunkBody(origin, vel, picnum, now);
  }

  /**
   * Shared body-chunk factory: Rapier dynamic body + capsule collider + billboard
   * sprite + blood trail. Used by BOTH the hand-tuned radial burst (spawnOne) and
   * the source-faithful gib-table path (spawnChunksFromGibs) so there is zero
   * visual/physics drift between them. The only argument that differs is the
   * explicit launch velocity in m/s (already in Three.js space, y-up).
   */
  private spawnChunkBody(origin: Vec3, vel: Vec3, picnum: number, now: number): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinearDamping(0.04)  // less drag — Blood chunks keep flying
      .setAngularDamping(0.1);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(0.05, 0.08)
      .setRestitution(0.55)    // bouncier — Blood chunks skip off floors
      .setFriction(0.35);
    this.world.createCollider(colliderDesc, body);

    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
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
    // Trail params single-sourced from BLOOD_TRAIL (tuning.ts). NOTE: the raw
    // Blood gravity/airdrag are fixed-point and don't convert cleanly, so
    // BLOOD_TRAIL.gravity/airdrag are hand-tuned hang-time values, not derived.
    const trail = this.particles.emitTrail(source, {
      tile: BLOOD_TRAIL.tile,
      hz: BLOOD_TRAIL.emitHz,
      velScale: BLOOD_TRAIL.velScale,
      gravity: BLOOD_TRAIL.gravity,
      airdrag: BLOOD_TRAIL.airdrag,
      lifetimeSec: BLOOD_TRAIL.lifetimeSec,
      size: BLOOD_TRAIL.size,
      leavesSplat: true, // droplets stamp floor splats on settle (cascade)
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
