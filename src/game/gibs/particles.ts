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

  /** Advance simulation + refresh InstancedMesh matrices. Call per frame. */
  update(dt: number, camera: THREE.Camera | null = null): void {
    for (const p of this.particles) updateParticle(p, dt);
    if (!this.mesh) return;

    // Billboard each alive instance to face the camera.
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
