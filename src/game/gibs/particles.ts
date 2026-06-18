import * as THREE from 'three';
import { chance, type Rng } from '../rng';

export interface Vec3 { x: number; y: number; z: number; }

export type ParticleKind = 'smoke' | 'default';

export interface Particle {
  alive: boolean;
  pos: Vec3;
  vel: Vec3;
  gravity: number;       // m/s² (positive = downward pull)
  airdrag: number;       // per-second drag coefficient (0..1 range typical)
  lifetimeSec: number;
  age: number;
  size: number;          // world-space size (meters)
  tile: number;          // picnum for diagnostic / atlas lookup
  kind: ParticleKind;    // discriminator for type-specific rendering/update
  /** Blood particle: on settle/death it leaves a floor blood splat (NotBlood
   *  fxBloodBits cascade — see ParticlePool.setBloodSettleHandler). */
  leavesSplat: boolean;
}

export interface BurstParams {
  tile: number;
  count: number;
  speedMin: number;
  speedMax: number;
  gravity: number;     // m/s² (converted from Blood's buPerTicSquared)
  airdrag: number;
  lifetimeSec: number;
  size: number;
  /** When true, each burst particle leaves a floor splat on death (cascade). */
  leavesSplat?: boolean;
}

/** A moving source whose velocity is sampled on each trail-emit tick. */
export interface TrailSource {
  pos: Vec3;
  vel: Vec3;
}

export interface TrailParams {
  tile: number;
  hz: number;
  velScale: number;
  gravity: number;
  airdrag: number;
  lifetimeSec: number;
  size: number;
  /** When true, each emitted droplet leaves a floor splat on death (cascade). */
  leavesSplat?: boolean;
}

export interface TrailHandle { stop(): void; }

interface TrailState {
  source: TrailSource;
  params: TrailParams;
  timeSinceEmit: number;
  stopped: boolean;
}

/** Axis-aligned static surface definition (arena walls/floor/ceiling). */
export interface StaticSurface {
  /** World-space AABB min / max. */
  min: Vec3;
  max: Vec3;
  /** Outward normal (points away from interior of the surface). */
  normal: Vec3;
}

/** Arena-wide registry — set once by arena.ts on init. */
let arenaSurfaces: StaticSurface[] = [];

export function setArenaSurfaces(surfaces: StaticSurface[]): void {
  arenaSurfaces = surfaces;
}

/** Cheap point-inside-AABB test with small epsilon. */
function pointInAABB(p: Vec3, min: Vec3, max: Vec3, eps = 0.05): boolean {
  return p.x >= min.x - eps && p.x <= max.x + eps
      && p.y >= min.y - eps && p.y <= max.y + eps
      && p.z >= min.z - eps && p.z <= max.z + eps;
}

/** Pure kinematic update — no allocations, no rendering. */
export function updateParticle(p: Particle, dt: number): void {
  if (!p.alive) return;

  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  p.pos.z += p.vel.z * dt;

  // Gravity pulls -y
  p.vel.y -= p.gravity * dt;

  // Airdrag — simple linear multiplicative damping; clamp to ≥ 0
  const dragFactor = Math.max(0, 1 - p.airdrag * dt);
  p.vel.x *= dragFactor;
  p.vel.y *= dragFactor;
  p.vel.z *= dragFactor;

  p.age += dt;
  if (p.age >= p.lifetimeSec) {
    p.alive = false;
  }
}

/**
 * NotBlood blood-splat cascade (fxBloodBits, callback.cpp:435). When a blood
 * particle (gib-burst chunk FX_13 or trail droplet FX_27) settles, it drops to
 * the floor and stamps a splat decal at a random nearby offset, with a
 * `secondChanceFixed16` chance (Blood Chance(0x5000) ≈ 31%) of a second pool.
 *
 * Pure: returns the splat position(s); the caller spawns the decals. Offsets
 * are in the surface plane — XZ for a floor splat (normal ≈ up), where the y is
 * also dropped to the floor (the particle may have expired in mid-air). For a
 * wall hit (non-floor normal) the hit point is kept as-is (no offset).
 */
export function bloodSplatPositions(
  rng: Rng,
  pos: Vec3,
  normal: Vec3,
  spreadM: number,
  secondChanceFixed16: number,
): Vec3[] {
  const onFloor = normal.y > 0.5;
  const sample = (): Vec3 => {
    if (!onFloor) return { x: pos.x, y: pos.y, z: pos.z };
    const angle = rng() * Math.PI * 2;
    const dist = rng() * spreadM;
    return { x: pos.x + Math.cos(angle) * dist, y: 0, z: pos.z + Math.sin(angle) * dist };
  };
  const out: Vec3[] = [sample()];
  if (chance(rng, secondChanceFixed16)) out.push(sample());
  return out;
}

/**
 * Pool of particles rendered as a single InstancedMesh (billboarded to camera).
 * Fixed capacity; FIFO-evicts oldest when full.
 *
 * Three.js integration is minimal here — the pool owns an InstancedMesh, but
 * allocation/update is data-only so it's trivially testable.
 */
export class ParticlePool {
  private readonly particles: Particle[] = [];
  private head = 0;          // next slot to fill (wraps on eviction)
  private trails: TrailState[] = [];

  private mesh: THREE.InstancedMesh | null = null;
  private dummy = new THREE.Object3D();

  /** Invoked when a `leavesSplat` particle dies (lifetime end OR surface hit).
   *  Wired in main.ts to stamp the NotBlood fxBloodBits floor-splat cascade. */
  private bloodSettleHandler?: (pos: Vec3, normal: Vec3) => void;

  setBloodSettleHandler(fn: (pos: Vec3, normal: Vec3) => void): void {
    this.bloodSettleHandler = fn;
  }

  constructor(
    private readonly scene: THREE.Scene | null,
    private readonly capacity: number,
    private readonly texture: THREE.Texture | null,
  ) {
    // Prefill with dead particles so `allocate()` has slots
    for (let i = 0; i < capacity; i++) {
      this.particles.push({
        alive: false,
        pos: { x: 0, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        gravity: 0,
        airdrag: 0,
        lifetimeSec: 0,
        age: 0,
        size: 1,
        tile: 0,
        kind: 'default',
        leavesSplat: false,
      });
    }

    if (scene && texture) {
      const geom = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        // Tint the sprite multiplicatively toward blood red. The raw Blood
        // blood-drop tile (picnum 733) reads pink at full white, so tint it
        // down. Bumped 0x802020 → 0xc02020 so the palette-dither snap lands
        // in BLOOD.PAL's bright-red cluster rather than a brown/maroon.
        color: 0xc02020,
      });
      this.mesh = new THREE.InstancedMesh(geom, mat, capacity);
      this.mesh.frustumCulled = false;
      scene.add(this.mesh);
    }
  }

  /** Returns a reusable Particle slot, killing the oldest if full. */
  allocate(): Particle {
    const p = this.particles[this.head]!;
    if (p.alive) {
      // capacity reached — FIFO-evict
      p.alive = false;
    }
    p.alive = true;
    p.age = 0;
    p.vel = { x: 0, y: 0, z: 0 };
    p.kind = 'default';
    p.leavesSplat = false;
    this.head = (this.head + 1) % this.capacity;
    return p;
  }

  emitBurst(origin: Vec3, params: BurstParams): void {
    for (let i = 0; i < params.count; i++) {
      const p = this.allocate();
      p.pos.x = origin.x; p.pos.y = origin.y; p.pos.z = origin.z;

      // Random direction on unit sphere
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const sinPhi = Math.sin(phi);
      const dx = sinPhi * Math.cos(theta);
      const dy = Math.cos(phi);
      const dz = sinPhi * Math.sin(theta);

      const speed = params.speedMin + Math.random() * (params.speedMax - params.speedMin);
      p.vel.x = dx * speed; p.vel.y = dy * speed; p.vel.z = dz * speed;

      p.gravity     = params.gravity;
      p.airdrag     = params.airdrag;
      p.lifetimeSec = params.lifetimeSec;
      p.size        = params.size;
      p.tile        = params.tile;
      p.leavesSplat = params.leavesSplat ?? false;
    }
  }

  emitTrail(source: TrailSource, params: TrailParams): TrailHandle {
    const state: TrailState = { source, params, timeSinceEmit: 0, stopped: false };
    this.trails.push(state);
    return {
      stop: () => { state.stopped = true; },
    };
  }

  /** Advance simulation + refresh InstancedMesh matrices. Call per frame. */
  update(dt: number, camera: THREE.Camera | null = null): void {
    // 1. Advance trail timers and emit droplets
    const interval = (hz: number) => 1 / hz;
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i]!;
      if (t.stopped) {
        this.trails.splice(i, 1);
        continue;
      }
      t.timeSinceEmit += dt;
      while (t.timeSinceEmit >= interval(t.params.hz)) {
        t.timeSinceEmit -= interval(t.params.hz);
        const p = this.allocate();
        p.pos.x = t.source.pos.x; p.pos.y = t.source.pos.y; p.pos.z = t.source.pos.z;
        p.vel.x = t.source.vel.x * t.params.velScale;
        p.vel.y = t.source.vel.y * t.params.velScale;
        p.vel.z = t.source.vel.z * t.params.velScale;
        p.gravity     = t.params.gravity;
        p.airdrag     = t.params.airdrag;
        p.lifetimeSec = t.params.lifetimeSec;
        p.size        = t.params.size;
        p.tile        = t.params.tile;
        p.leavesSplat = t.params.leavesSplat ?? false;
      }
    }

    // 2. Kinematic particle update + surface-hit / settle detection.
    // A blood particle (leavesSplat) that DIES this frame — by surface contact
    // OR by lifetime expiry — stamps the floor-splat cascade (NotBlood
    // fxBloodBits) via bloodSettleHandler. Surface hits pass the surface normal
    // (oriented splat); lifetime deaths use the up normal (floor pool).
    const UP: Vec3 = { x: 0, y: 1, z: 0 };
    for (const p of this.particles) {
      if (!p.alive) continue;
      const prev = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      updateParticle(p, dt);

      // Lifetime expiry this frame.
      if (!p.alive) {
        if (p.leavesSplat) this.bloodSettleHandler?.(p.pos, UP);
        continue;
      }

      // Surface contact: check ALL alive particles against arena surfaces each
      // frame. O(particles × surfaces) — arena has ~6 surfaces, pool ≤ 1024.
      for (const s of arenaSurfaces) {
        const hitNow  = pointInAABB(p.pos, s.min, s.max);
        const hitPrev = pointInAABB(prev,  s.min, s.max);
        if (hitNow && !hitPrev) {
          if (p.leavesSplat) this.bloodSettleHandler?.(p.pos, s.normal);
          p.alive = false; // particle absorbs into the splat
          break;
        }
      }
    }

    // 3. Refresh InstancedMesh matrices
    if (!this.mesh) return;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i]!;
      if (!p.alive) {
        this.dummy.scale.set(0, 0, 0);
      } else {
        this.dummy.position.set(p.pos.x, p.pos.y, p.pos.z);
        if (camera) this.dummy.lookAt(camera.position);
        this.dummy.scale.set(p.size, p.size, p.size);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Total alive count — diagnostic / HUD. */
  aliveCount(): number {
    return this.particles.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
  }
}
