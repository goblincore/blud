import * as THREE from 'three';
import type { QavManifest, TileMetaMap } from './qav-schema';
import { pickFrameIndex } from './animator';

/**
 * Blood's reference viewport is 320×200. QAV offsets ox/oy are pixels
 * measured from the center-bottom anchor of that viewport.
 * Runtime converts to normalized camera-space coordinates.
 */
const BLOOD_VIEW_W = 320;
const BLOOD_VIEW_H = 200;

/** Loader: picnum → Three.Texture. Provided by main.ts at boot. */
export type TileTextureGetter = (picnum: number) => THREE.Texture;

/** Number of layer slots to pre-allocate. QAV supports up to 8 layers/frame. */
const MAX_LAYERS = 8;

export interface FpWeaponAnimatorOpts {
  /** Distance from camera at which weapons render. Matches Blood's FPV depth. */
  distance?: number;
  /** Scale factor: multiplier from Blood pixels → world-space at `distance`. */
  pixelsPerUnit?: number;
}

/**
 * Drives first-person weapon view animations from QAV manifests.
 *
 * Each QAV frame has up to 8 layers (hand, weapon, muzzle flash, etc.)
 * with per-frame pixel offsets. The animator converts these from Blood's
 * 320×200 reference viewport into Three.js camera-space quads.
 */
export class FpWeaponAnimator {
  private meshes: THREE.Mesh[];
  private currentAnim: QavManifest | null = null;
  private playbackStart = 0;
  private lastFrameIdx = -1;
  private readonly distance: number;
  private readonly pixelsPerUnit: number;
  /** Y anchor offset (tuned so weapon hand sits low on the screen, Blood-style). */
  private readonly anchorY: number;
  /** Running view-bob phase (radians). */
  private bobPhase = 0;
  /** Per-frame horizontal speed input for bob amplitude. Updated by setWalkSpeed(). */
  private walkSpeed = 0;
  /** Last-applied view-bob offset in camera space (x=right, y=up). Exposed via
   *  getBobOffset() so weapon spawn origins can track the swaying gun sprite. */
  private bobX = 0;
  private bobY = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private weaponAnims: Record<string, QavManifest>,
    private tileMeta: TileMetaMap,
    private getTexture: TileTextureGetter,
    opts: FpWeaponAnimatorOpts = {},
  ) {
    this.distance = opts.distance ?? 0.6;
    this.pixelsPerUnit = opts.pixelsPerUnit ?? 200;
    // anchorY sits the hand low on screen (Blood-style bottom-center FPV).
    this.anchorY = -0.55;

    this.meshes = [];
    for (let i = 0; i < MAX_LAYERS; i++) {
      const geom = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 999 - i; // higher renderOrder = drawn later (on top)
      mesh.frustumCulled = false;
      mesh.visible = false;
      camera.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Start a new animation. Idempotent if name unchanged and not restarting. */
  play(name: string, nowSec: number): void {
    const anim = this.weaponAnims[name];
    if (!anim) {
      console.warn(`FpWeaponAnimator: unknown animation "${name}"`);
      return;
    }
    if (this.currentAnim?.name === name) return; // already playing
    this.currentAnim = anim;
    this.playbackStart = nowSec;
    this.lastFrameIdx = -1;
  }

  /** Set current player horizontal speed (m/s). Drives view bob amplitude. */
  setWalkSpeed(mps: number): void { this.walkSpeed = mps; }

  /**
   * Current view-bob offset in camera space (x = screen-right, y = screen-up),
   * matching what the last update() applied to the gun sprite. Weapon spawn
   * origins add this in the same camera space so projectiles track the gun
   * while walking / strafing. Returns {0,0} before the first update().
   */
  getBobOffset(): { x: number; y: number } {
    return { x: this.bobX, y: this.bobY };
  }

  /** Force restart an animation (even if same name). Used for state re-entry. */
  restart(name: string, nowSec: number): void {
    this.currentAnim = null; // clear so play() picks it up fresh
    this.play(name, nowSec);
  }

  /** Per-frame update. Call from render loop. */
  update(nowSec: number, dt = 1 / 60): void {
    const anim = this.currentAnim;
    if (!anim) {
      for (const m of this.meshes) m.visible = false;
      return;
    }
    // View bob: advance phase at a walk-speed-proportional rate; amplitude fades
    // to zero when stationary. Y-bob is ~sin(2x) and X-bob is ~sin(x) so the
    // hand traces a figure-8 (classic FPS bob).
    const walkAmount = Math.min(this.walkSpeed / 5, 1); // full bob at 5 m/s
    this.bobPhase += dt * (6 + walkAmount * 6); // 1-2 Hz
    this.bobY = walkAmount * 0.018 * Math.sin(this.bobPhase * 2);
    this.bobX = walkAmount * 0.012 * Math.sin(this.bobPhase);
    const bobX = this.bobX;
    const bobY = this.bobY;

    const elapsedMs = (nowSec - this.playbackStart) * 1000;
    const idx = pickFrameIndex(anim.frames, elapsedMs, anim.loop);
    const frameChanged = idx !== this.lastFrameIdx;
    this.lastFrameIdx = idx;

    const frame = anim.frames[idx]!;
    const layers = 'layers' in frame ? frame.layers : [];

    // Pre-compute camera-space scaling factors at weapon distance.
    // Half-width of the visible frustum at distance d:
    //   halfW = d * aspect * tan(fov/2)
    //   halfH = d * tan(fov/2)
    const halfFovRad = (this.camera.fov * Math.PI) / 360;
    const halfH = this.distance * Math.tan(halfFovRad);
    const halfW = halfH * this.camera.aspect;

    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i]!;
      const layer = layers[i];
      if (!layer) {
        mesh.visible = false;
        continue;
      }
      const meta = this.tileMeta[String(layer.tile)];
      if (!meta) {
        mesh.visible = false;
        continue;
      }

      // Only rebuild geometry + texture when the frame actually advanced.
      if (frameChanged) {
        const wWorld = (meta.w / this.pixelsPerUnit) * layer.scale;
        const hWorld = (meta.h / this.pixelsPerUnit) * layer.scale;
        (mesh.geometry as THREE.PlaneGeometry).dispose();
        mesh.geometry = new THREE.PlaneGeometry(wWorld, hWorld);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map = this.getTexture(layer.tile);
        mat.needsUpdate = true;
        mesh.scale.x = layer.flipX ? -1 : 1;
      }

      // Position every frame (so bob applies smoothly even when frame hasn't changed).
      // QAV ox/oy are pixels from center-bottom anchor; convert to camera-space.
      const x = (layer.ox / BLOOD_VIEW_W) * halfW * 2 + bobX;
      const y = this.anchorY - (layer.oy / BLOOD_VIEW_H) * halfH * 2 + bobY;
      mesh.position.set(x, y, -this.distance);
      mesh.visible = true;
    }
  }

  /** Show/hide all weapon layers. */
  setVisible(v: boolean): void {
    for (const m of this.meshes) {
      if (v && m.material) {
        // keep current visibility (respect layer count)
      } else {
        m.visible = false;
      }
    }
    if (v && this.currentAnim) {
      // Re-trigger visibility via next update
      this.lastFrameIdx = -1;
    }
  }

  /** Clean up Three.js resources. */
  dispose(): void {
    for (const m of this.meshes) {
      this.camera.remove(m);
      m.geometry.dispose();
      (m.material as THREE.MeshBasicMaterial).dispose();
    }
  }
}
