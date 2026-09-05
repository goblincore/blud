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
import { GOBLIN_SKIN, goblinAlbedoPixels, goblinNormalPixels, goblinRoughnessPixels } from './goblin-skin';
import { ARM_NODES, FORE_LEN_M, UPPER_LEN_M, armBasis, armIk, armMaterialKind, type V3 } from './game-arms-math';

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
  // The grain: ridges between the pits are wet-shiny, floors matte. Three
  // multiplies `roughness` by the map's green channel, so roughness is 1 and
  // the map carries ridgeRoughness..pitRoughness.
  const rough = new THREE.DataTexture(goblinRoughnessPixels(256), 256, 256, THREE.RGBAFormat);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.needsUpdate = true;
  // Darker, rougher, less env than the first build (owner: "too pale and
  // bright versus the goblin character... better dark and rougher"): the
  // albedo already carries fpvExposure; roughness and the env share are the
  // other two levers, and the normal map is pushed so the texture reads.
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,               // the map carries the colour
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(GOBLIN_SKIN.fpvNormalScale, GOBLIN_SKIN.fpvNormalScale),
    roughness: 1,
    roughnessMap: rough,
    metalness: 0,
    envMap: env,
    envMapIntensity: envMapIntensity * GOBLIN_SKIN.fpvEnvShare,
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
const _elbow = new THREE.Vector3();
const _qWorld = new THREE.Quaternion(), _qInv = new THREE.Quaternion();

function basisQuat(out: THREE.Quaternion, dir: THREE.Vector3): THREE.Quaternion {
  const b = armBasis([dir.x, dir.y, dir.z] as V3, [0, 0, 1]);
  _x.set(b.x[0], b.x[1], b.x[2]); _y.set(b.y[0], b.y[1], b.y[2]); _z.set(b.z[0], b.z[1], b.z[2]);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** The Upper_L/Upper_R node under an arm root, cached on the root. */
function upperOf(arm: THREE.Object3D): THREE.Object3D | null {
  const cached = arm.userData['upperNode'] as THREE.Object3D | undefined;
  if (cached) return cached;
  let found: THREE.Object3D | null = null;
  arm.traverse((o) => { if (!found && /^Upper_[LR]/.test(o.name)) found = o; });
  if (found) arm.userData['upperNode'] = found;
  return found;
}

/**
 * Pose a two-bone arm. The arm root's origin is the hand and never moves;
 * armIk() puts the elbow between it and `shoulder` (a fixed rig-space point
 * behind the camera), bending toward `bendHint`. The root is aimed so its
 * local +Y runs hand -> elbow with local +Z (the watch) toward the camera;
 * the Upper node, whose origin is the elbow, is aimed elbow -> shoulder in
 * the root's local frame. The shoulder ball at the far end of the upper arm
 * always ends behind the camera, straight or bent -- which is what removes
 * the detached-arm end the one-piece stick showed at extreme view pitch.
 */
/** The bend floor, radians (~34 deg): the forearm always leaves the hand at
 *  least this far off the hand-shoulder line, toward the hint. */
export const ARM_MIN_BEND_RAD = 0.6;

export function aimArm(arm: THREE.Object3D, shoulder: THREE.Vector3, bendHint: THREE.Vector3): void {
  const e = armIk(
    [arm.position.x, arm.position.y, arm.position.z],
    [shoulder.x, shoulder.y, shoulder.z],
    FORE_LEN_M, UPPER_LEN_M,
    [bendHint.x, bendHint.y, bendHint.z],
    ARM_MIN_BEND_RAD,
  );
  _elbow.set(e[0], e[1], e[2]);
  _dir.copy(_elbow).sub(arm.position);
  basisQuat(arm.quaternion, _dir);
  const upper = upperOf(arm);
  if (!upper) return;
  _dir.copy(shoulder).sub(_elbow);
  basisQuat(_qWorld, _dir);
  _qInv.copy(arm.quaternion).invert();
  upper.quaternion.copy(_qInv).multiply(_qWorld);
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
