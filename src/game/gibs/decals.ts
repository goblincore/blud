import * as THREE from 'three';
import type { Vec3 } from './particles';

/**
 * Decal pool — textured quads stuck to arena surfaces where blood trails hit.
 *
 * No physics, no lifetime fade (M2 — M3 adds that). FIFO-evicts oldest when
 * capacity is reached so we don't accumulate forever.
 */
export class DecalPool {
  private readonly meshes: THREE.Mesh[] = [];
  private head = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly capacity: number,
    private readonly texture: THREE.Texture,
    private readonly decalSize = 0.25,
  ) {
    // Prefill hidden meshes
    const geom = new THREE.PlaneGeometry(decalSize, decalSize);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      // Tint to blood red (same as particle trail) — otherwise the raw Blood
      // droplet tile reads as pink. Bumped 0x802020 → 0xc02020 so the
      // palette-dither snap lands in BLOOD.PAL's bright-red cluster.
      color: 0xc02020,
    });
    for (let i = 0; i < capacity; i++) {
      const m = new THREE.Mesh(geom, mat);
      m.visible = false;
      scene.add(m);
      this.meshes.push(m);
    }
    // Seal array length so indexing with `head` is safe (0 ≤ head < capacity).
    Object.seal(this.meshes);
  }

  /**
   * Spawn a decal at `pos`, aligned to `normal`, offset slightly along
   * `normal` to avoid z-fighting.
   */
  spawn(pos: Vec3, normal: Vec3): void {
    const m = this.meshes[this.head]!;
    this.head = (this.head + 1) % this.capacity;

    const epsilon = 0.01;
    m.position.set(
      pos.x + normal.x * epsilon,
      pos.y + normal.y * epsilon,
      pos.z + normal.z * epsilon,
    );

    // Align the quad's +Z to `normal`
    const n = new THREE.Vector3(normal.x, normal.y, normal.z).normalize();
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(defaultNormal, n);
    m.quaternion.copy(q);

    m.visible = true;
  }

  aliveCount(): number {
    return this.meshes.filter((m) => m.visible).length;
  }

  reset(): void {
    for (const m of this.meshes) m.visible = false;
    this.head = 0;
  }
}
