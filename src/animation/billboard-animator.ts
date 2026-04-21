import * as THREE from 'three';
import type { SeqManifest, TileMetaMap } from './qav-schema';
import type { TileTextureGetter } from './fp-weapon-animator';
import { pickFrameIndex } from './animator';
import { pickAngleVariant } from './billboard-angle';

export class BillboardAnimator {
  private mesh: THREE.Mesh;
  private currentAnim: SeqManifest | null = null;
  private playbackStart = 0;

  constructor(
    private characterAnims: Record<string, SeqManifest>,
    private tileMeta: TileMetaMap,
    private getTexture: TileTextureGetter,
    scale = 1.8,
  ) {
    const geom = new THREE.PlaneGeometry(scale * 0.75, scale);
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
    const tex = this.getTexture(picnum);
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }

    this.mesh.scale.x = Math.abs(this.mesh.scale.x) * (flipX ? -1 : 1);
    // Billboard: face the camera on the Y axis.
    this.mesh.position.set(spritePos.x, spritePos.y, spritePos.z);
    this.mesh.lookAt(cameraPos.x, spritePos.y, cameraPos.z);
    this.mesh.visible = true;
  }

  /** Clean up Three.js resources. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
