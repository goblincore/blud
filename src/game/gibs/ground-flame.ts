import * as THREE from 'three';
import type { Vec3 } from './particles';
import { BURN } from './tuning';

/**
 * A small persistent flame billboard at a fixed world position.
 *
 * This is a Blud-original embellishment — NotBlood's burn-death sequence
 * does NOT spawn a persistent ground flame. We add it as a gameplay-visible
 * death marker so the player can see where burn-killed enemies died.
 *
 * Visual: small billboard (0.6m), fades over the last fadeSec seconds.
 * No physics, no damage — purely visual.
 */

export class GroundFlame {
  readonly spawnTime: number;
  readonly pos: Vec3;
  readonly lifetimeSec: number;
  private expired = false;

  mesh: THREE.Mesh;

  constructor(
    pos: Vec3,
    now: number,
    texture: THREE.Texture,
    scene: THREE.Scene,
  ) {
    this.pos = { ...pos };
    this.spawnTime = now;
    this.lifetimeSec = BURN.groundFlameLifetimeSec;

    const geom = new THREE.PlaneGeometry(BURN.groundFlameSizeM, BURN.groundFlameSizeM);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.05,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.frustumCulled = false;
    this.mesh.position.set(pos.x, pos.y + 0.05, pos.z); // slight Y offset to sit on ground
    scene.add(this.mesh);
  }

  /** Update alpha and check expiry. Returns false when expired. */
  update(now: number, camera: THREE.Camera): boolean {
    if (this.expired) return false;

    const age = now - this.spawnTime;
    const fadeStart = this.lifetimeSec - BURN.groundFlameFadeSec;

    if (age >= fadeStart) {
      const fadeFrac = Math.max(0, Math.min(1, (this.lifetimeSec - age) / BURN.groundFlameFadeSec));
      (this.mesh.material as THREE.MeshBasicMaterial).opacity = fadeFrac;
    }

    // Billboard-face camera
    this.mesh.lookAt(camera.position);

    if (age >= this.lifetimeSec) {
      this.expired = true;
      return false;
    }
    return true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  isExpired(): boolean { return this.expired; }
}

/** Simple manager for multiple ground flames. */
export class GroundFlameManager {
  private flames: GroundFlame[] = [];

  spawn(pos: Vec3, now: number, texture: THREE.Texture, scene: THREE.Scene): void {
    this.flames.push(new GroundFlame(pos, now, texture, scene));
  }

  update(now: number, camera: THREE.Camera): void {
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const f = this.flames[i]!;
      const alive = f.update(now, camera);
      if (!alive) {
        if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
        f.dispose();
        this.flames.splice(i, 1);
      }
    }
  }

  clear(scene: THREE.Scene): void {
    for (const f of this.flames) {
      if (f.mesh.parent) scene.remove(f.mesh);
      f.dispose();
    }
    this.flames.length = 0;
  }

  aliveCount(): number { return this.flames.length; }
}
