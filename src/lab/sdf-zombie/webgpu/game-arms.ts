// src/lab/sdf-zombie/webgpu/game-arms.ts
//
// The FPV goblin arms: loads goblin-arm.glb, dresses it, and hands two arm
// groups (origin = hand centre, local +Y = toward the elbow) to game-main.
// Split out of game-main.ts (4,000+ lines) on purpose; the pure half is
// game-arms-math.ts.
//
// WHY A GLB AND NOT THE OLD SPHERE+CAPSULE. The owner's read of the capsule
// hands was "thin green tubes": one radius, one flat green, a 0.30 emissive
// that erased the normal map. The asset has ball joints, a real bracer with
// hardware matching the shotgun, and a smartwatch; the SKIN is dressed here
// from generated maps so it stays deterministic and pixel-testable.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GOBLIN_SKIN, goblinAlbedoPixels, goblinNormalPixels } from './goblin-skin';
import { ARM_NODES, armBasis, armMaterialKind, type V3 } from './game-arms-math';

export const GOBLIN_ARM_GLB = '/assets/lab/goblin-arm.glb';
export const WATCH_SCREEN_SIZE = { w: 128, h: 112 } as const;

export interface WatchScreen {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  /** Call after drawing on `canvas` so the GPU copy updates. */
  redraw(): void;
}

export interface GoblinArms {
  left: THREE.Group;
  right: THREE.Group;
  /** The one skin material both arms share. */
  skin: THREE.MeshStandardMaterial;
  screen: WatchScreen;
}

/** The goblin's skin: generated colour + normal maps, the blob's roughness,
 *  the gun's environment so it catches the same light -- and NO emissive. */
export function makeSkinMaterial(env: THREE.Texture, envMapIntensity: number): THREE.MeshStandardMaterial {
  const albedo = new THREE.DataTexture(goblinAlbedoPixels(256), 256, 256, THREE.RGBAFormat);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.needsUpdate = true;
  const normal = new THREE.DataTexture(goblinNormalPixels(256), 256, 256, THREE.RGBAFormat);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,               // the map carries the colour
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: GOBLIN_SKIN.roughness,
    metalness: 0,
    envMap: env,
    envMapIntensity,
  });
  m.emissiveIntensity = 0;
  return m;
}

/** A static smartwatch face: dark ground, a thin ring, a few glyph bars, a
 *  dot. No text -- nothing is readable at 25 mm and it must not try. The
 *  canvas is exposed so a later pass can draw shells / health / a timer. */
export function drawWatchFace(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#0b1014';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#4fd1c5';
  ctx.lineWidth = Math.max(2, w * 0.03);
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.46, w * 0.30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#4fd1c5';
  ctx.fillRect(w * 0.14, h * 0.86, w * 0.20, h * 0.06);
  ctx.fillRect(w * 0.40, h * 0.86, w * 0.12, h * 0.06);
  ctx.fillRect(w * 0.58, h * 0.86, w * 0.28, h * 0.06);
  ctx.fillRect(w * 0.47, h * 0.24, w * 0.06, h * 0.22);   // a "hand" of the ring
  ctx.fillStyle = '#ff7a59';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.46, w * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

export function makeWatchScreen(): WatchScreen {
  const canvas = document.createElement('canvas');
  canvas.width = WATCH_SCREEN_SIZE.w; canvas.height = WATCH_SCREEN_SIZE.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[sdf-game] no 2d context for the watch screen');
  drawWatchFace(ctx, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture, redraw: () => { texture.needsUpdate = true; } };
}

/** The one emissive on the arms: the screen glows faintly in the dark. */
function makeScreenMaterial(screen: WatchScreen): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: screen.texture,
    emissive: 0xffffff,
    emissiveMap: screen.texture,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0,
  });
}

const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/** Aim an arm (origin = hand) so local +Y points at `elbow` and local +Z --
 *  the back of the hand, the watch -- faces rig +Z (the camera) as far as the
 *  arm allows. The hand never moves: only the arm swings behind it. */
export function aimArm(arm: THREE.Object3D, elbow: THREE.Vector3): void {
  _dir.copy(elbow).sub(arm.position);
  const b = armBasis([_dir.x, _dir.y, _dir.z] as V3, [0, 0, 1]);
  _x.set(b.x[0], b.x[1], b.x[2]); _y.set(b.y[0], b.y[1], b.y[2]); _z.set(b.z[0], b.z[1], b.z[2]);
  _m.makeBasis(_x, _y, _z);
  arm.quaternion.setFromRotationMatrix(_m);
}

/**
 * Load and dress the arms. Throws on a missing node or an unknown material
 * name -- like the gun, a quiet fallback here would be an arm that aims at
 * nothing or a screen with no glow, found three tasks later.
 */
export async function loadGoblinArms(
  url: string,
  opts: { env: THREE.Texture; envMapIntensity: number },
): Promise<GoblinArms> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const need = (n: string): THREE.Object3D => {
    const o = gltf.scene.getObjectByName(n);
    if (!o) throw new Error(`[sdf-game] goblin-arm.glb is missing the ${n} node`);
    return o;
  };
  for (const n of ARM_NODES) need(n);
  const left = need('Arm_L') as THREE.Group;
  const right = need('Arm_R') as THREE.Group;
  const skin = makeSkinMaterial(opts.env, opts.envMapIntensity);
  const screen = makeWatchScreen();
  const screenMat = makeScreenMaterial(screen);
  const dressed = new Map<THREE.Material, THREE.Material>();
  for (const root of [left, right]) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map((mat) => {
        const kind = armMaterialKind(mat.name);
        if (kind === null) throw new Error(`[sdf-game] goblin-arm.glb: unknown material ${JSON.stringify(mat.name)} on ${mesh.name}`);
        if (kind === 'skin') return skin;
        if (kind === 'screen') return screenMat;
        let d = dressed.get(mat);
        if (!d) {
          const std = mat as THREE.MeshStandardMaterial;
          std.envMap = opts.env;
          // Metal at the gun's intensity so steel and brass match the kit it
          // sits next to; leather and the watch's plastics take less.
          std.envMapIntensity = kind === 'steel' || kind === 'brass' ? opts.envMapIntensity : 0.6;
          std.needsUpdate = true;
          d = std; dressed.set(mat, d);
        }
        return d;
      });
      mesh.material = out.length === 1 ? out[0]! : out;
    });
  }
  // Detach from the loader's scene so the caller parents them where it likes.
  left.removeFromParent(); right.removeFromParent();
  left.position.set(0, 0, 0); right.position.set(0, 0, 0);
  return { left, right, skin, screen };
}
