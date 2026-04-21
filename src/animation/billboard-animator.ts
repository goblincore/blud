import * as THREE from 'three';
import type { SeqManifest, TileMetaMap } from './qav-schema';
import type { TileTextureGetter } from './fp-weapon-animator';
import { pickFrameIndex } from './animator';
import { pickAngleVariant } from './billboard-angle';

export class BillboardAnimator {
  private mesh: THREE.Mesh;
  private currentAnim: SeqManifest | null = null;
  private playbackStart = 0;
  private lastPicnum = -1;
  /** Blood pixels per world-meter. 64 → a 125-px-tall zombie tile ≈ 1.95m tall. */
  private readonly pixelsPerUnit: number;

  constructor(
    private characterAnims: Record<string, SeqManifest>,
    private tileMeta: TileMetaMap,
    private getTexture: TileTextureGetter,
    pixelsPerUnit = 64,
  ) {
    this.pixelsPerUnit = pixelsPerUnit;
    // Placeholder geometry — resized on first update() to match the live tile.
    const geom = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.1 });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.frustumCulled = false;
  }

  /** The mesh to add to the scene (attach to a parent Object3D that follows
   * the dude's Rapier body position). */
  get object(): THREE.Mesh { return this.mesh; }

  play(name: string, nowSec: number): void {
    const anim = this.characterAnims[name];
    if (!anim) {
      console.warn(`BillboardAnimator: unknown animation "${name}"`);
      return;
    }
    if (this.currentAnim?.name === name) return;
    this.currentAnim = anim;
    this.playbackStart = nowSec;
  }

  /** Update. Call per render frame.
   *  @param spritePos world position of the sprite (xz plane)
   *  @param spriteFacing unit vector in xz for the sprite's current facing
   *  @param cameraPos world position of the camera (xz)
   */
  update(
    nowSec: number,
    spritePos: { x: number; y: number; z: number },
    spriteFacing: { x: number; z: number },
    cameraPos: { x: number; y: number; z: number },
  ): void {
    const anim = this.currentAnim;
    if (!anim) { this.mesh.visible = false; return; }

    const elapsedMs = (nowSec - this.playbackStart) * 1000;
    const idx = pickFrameIndex(anim.frames, elapsedMs, anim.loop);
    const frame = anim.frames[idx]!;
    const tileOffset = (frame as { tileOffset: number }).tileOffset;

    const { variant, flipX } = pickAngleVariant(
      { x: cameraPos.x, y: cameraPos.z },
      { x: spritePos.x, y: spritePos.z },
      { x: spriteFacing.x, y: spriteFacing.z },
      anim.angleStride,
    );

    const picnum = anim.baseTile + tileOffset * anim.angleStride + variant;
    if (picnum !== this.lastPicnum) {
      const tex = this.getTexture(picnum);
      const mat = this.mesh.material as THREE.MeshBasicMaterial;
      mat.map = tex; mat.needsUpdate = true;
      // Resize plane to the tile's real pixel dimensions so zombies preserve
      // their aspect ratio (tall billboards stay tall).
      const meta = this.tileMeta[String(picnum)];
      if (meta) {
        const wWorld = meta.w / this.pixelsPerUnit;
        const hWorld = meta.h / this.pixelsPerUnit;
        (this.mesh.geometry as THREE.PlaneGeometry).dispose();
        this.mesh.geometry = new THREE.PlaneGeometry(wWorld, hWorld);
      }
      this.lastPicnum = picnum;
    }

    this.mesh.scale.x = Math.abs(this.mesh.scale.x) * (flipX ? -1 : 1);
    // Billboard: feet at spritePos; raise by half-height so the rigid body
    // center aligns with the sprite's vertical center (not its feet).
    const geomH = (this.mesh.geometry as THREE.PlaneGeometry).parameters.height;
    this.mesh.position.set(spritePos.x, spritePos.y + geomH / 2 - 0.5, spritePos.z);
    this.mesh.lookAt(cameraPos.x, this.mesh.position.y, cameraPos.z);
    this.mesh.visible = true;
  }

  /** Clean up Three.js resources. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
