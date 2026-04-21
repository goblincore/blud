import * as THREE from 'three';

export interface Vec3 { x: number; y: number; z: number; }

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
  /** Called when a trail particle hits a static surface (decals wiring). */
  onSurfaceHit?: (pos: Vec3, normal: Vec3) => void;
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
      });
    }

    if (scene && texture) {
      const geom = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        // Tint the sprite multiplicatively toward deep blood red. The raw
        // Blood blood-drop tile (picnum 733) reads pink when rendered with
        // a default white material color. 0x802020 pushes it back to crimson.
        color: 0x802020,
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
      }
    }

    // 2. Kinematic particle update + surface-hit detection
    for (const p of this.particles) {
      if (!p.alive) continue;
      const prev = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      updateParticle(p, dt);
      if (!p.alive) continue;

      // Check trail-emitted particles for surface hit.
      // We don't track per-particle trail-ownership cheaply, so we check ALL
      // alive particles against arena surfaces each frame. This is O(particles
      // × surfaces) — arena has ~6 surfaces, pool ≤ 1024, fine.
      for (const s of arenaSurfaces) {
        const hitNow  = pointInAABB(p.pos, s.min, s.max);
        const hitPrev = pointInAABB(prev,  s.min, s.max);
        if (hitNow && !hitPrev) {
          // Find which trail (if any) spawned this particle.
          // For M2 simplicity: invoke the FIRST alive trail's onSurfaceHit.
          // A fully correct implementation tags each particle with its trail;
          // skipping that for now — all trails share the same decal callback.
          const trail = this.trails.find((t) => !t.stopped && t.params.onSurfaceHit);
          if (trail) trail.params.onSurfaceHit!(p.pos, s.normal);
          p.alive = false; // particle absorbs into decal
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
