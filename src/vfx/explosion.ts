import * as THREE from 'three';

/**
 * Single-shot explosion fireball — sequence of frames played once, then removed.
 *
 * Atlas is indexed by frame number. Frames animate at `frameDurationMs` (~50 ms).
 */
export interface ExplosionAtlas {
  frameCount: number;
  get(frame: number): THREE.Texture;
  frameDurationMs: number;
}

export class ExplosionVfx {
  private active: {
    mesh: THREE.Mesh;
    frame: number;
    elapsedMs: number;
    size: number;
    atlas: ExplosionAtlas;
  }[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /**
   * Spawn a fireball at `pos`. `sizeM` is the rendered quad half-size in meters
   * (dynamite bundle ≈ 1.5 m; small stick ≈ 0.8 m).
   */
  spawn(pos: { x: number; y: number; z: number }, sizeM: number, atlas: ExplosionAtlas): void {
    const geom = new THREE.PlaneGeometry(sizeM * 2, sizeM * 2);
    const mat = new THREE.MeshBasicMaterial({
      map: atlas.get(0),
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(mesh);
    this.active.push({ mesh, frame: 0, elapsedMs: 0, size: sizeM, atlas });
  }

  update(dtMs: number, camera: THREE.Camera): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i]!;
      e.elapsedMs += dtMs;
      const nextFrame = Math.floor(e.elapsedMs / e.atlas.frameDurationMs);
      if (nextFrame >= e.atlas.frameCount) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        (e.mesh.material as THREE.Material).dispose();
        this.active.splice(i, 1);
        continue;
      }
      if (nextFrame !== e.frame) {
        e.frame = nextFrame;
        (e.mesh.material as THREE.MeshBasicMaterial).map = e.atlas.get(nextFrame);
        (e.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
      }
      e.mesh.lookAt(camera.position);
    }
  }

  aliveCount(): number { return this.active.length; }
}
