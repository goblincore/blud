import * as THREE from 'three';

/**
 * Single-shot explosion fireball — sequence of frames played once, then removed.
 *
 * Atlas is indexed by frame number.
 *
 * Timing (authentic Blood): the kExplosionStandard entry in explodeInfo[] has
 * `ticks = 60`, which decrements by `kTicsPerFrame = 4` per game step at
 * `kTicsPerSec = 30` (see common_game.h:84-86, actor.cpp:2300, :6650), giving
 * `60 / 4 / 30 = 0.5 s` total sprite lifetime. For 5 frames that's 100 ms/frame.
 *
 * Aspect: Blood renders explosion sprites via `xrepeat = yrepeat = explodeInfo.repeat`
 * (actor.cpp:6090) — uniform scaling preserves the tile's native pixel aspect
 * ratio. The mushroom-cloud tiles (2384-2388) are taller than wide (~4:5), so
 * rendering them on a square quad stretches them horizontally. We scale the
 * mesh per frame to match the texture's natural W/H.
 */
export interface ExplosionAtlas {
  frameCount: number;
  get(frame: number): THREE.Texture;
  /** Pixel width/height of frame `i` — used to preserve native aspect. */
  aspect(frame: number): number;
  frameDurationMs: number;
}

export class ExplosionVfx {
  private active: {
    mesh: THREE.Mesh;
    frame: number;
    elapsedMs: number;
    halfHeight: number;
    atlas: ExplosionAtlas;
  }[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /**
   * Spawn a fireball at `pos`. `sizeM` is the rendered quad half-**height** in
   * meters (vertical half-size of the mushroom cloud; width follows the tile
   * aspect). Standard dynamite ≈ 1.5 m half-height; small stick ≈ 0.8 m.
   *
   * `anchor` controls where `pos` sits on the sprite:
   *  - `'bottom'` (ground bursts): `pos` is the sprite's bottom. Blood's ground
   *    SEQ (dome→mushroom) blooms *up* from the floor, so bottom-anchoring keeps
   *    the base pinned at the blast point and the column rising above it.
   *  - `'center'` (air bursts): `pos` is the sprite's center. The air SEQ is a
   *    compact, roughly round fireball with no rising stem, so it should sit
   *    centered on the mid-air detonation point rather than blooming upward
   *    (which would read as floating above the hit).
   */
  spawn(
    pos: { x: number; y: number; z: number },
    sizeM: number,
    atlas: ExplosionAtlas,
    anchor: 'bottom' | 'center' = 'bottom',
  ): void {
    // Unit quad — actual dimensions applied via mesh.scale so we can track the
    // texture aspect as it varies across animation frames (Blood's tiles
    // breathe from 95×122 → 102×128 over the 5-frame mushroom cycle).
    const geom = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: atlas.get(0),
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    const anchorOffsetY = anchor === 'center' ? 0 : sizeM;
    mesh.position.set(pos.x, pos.y + anchorOffsetY, pos.z);
    const aspect0 = atlas.aspect(0);
    mesh.scale.set(sizeM * 2 * aspect0, sizeM * 2, 1);
    this.scene.add(mesh);
    this.active.push({ mesh, frame: 0, elapsedMs: 0, halfHeight: sizeM, atlas });
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
        const mat = e.mesh.material as THREE.MeshBasicMaterial;
        mat.map = e.atlas.get(nextFrame);
        mat.needsUpdate = true;
        const aspect = e.atlas.aspect(nextFrame);
        e.mesh.scale.set(e.halfHeight * 2 * aspect, e.halfHeight * 2, 1);
      }
      e.mesh.lookAt(camera.position);
    }
  }

  aliveCount(): number { return this.active.length; }
}
