// ROCKET VIEW: how the tallow's volley shot draws (owner, 2026-11-15). The first rocket pass stretched the shared
// tracer to 2.6x its calibre and a 1.15 m streak: the owner saw "a visible seam" (the tracer sprite's hard front edge,
// blown up) and "no projectile". So a rocket gets its own view, three parts in the effects overlay:
//   body   the Blender rocket (assets-source/tallow-kit/make_rocket.py -> tallow-rocket.glb: an iron tube, a rusted
//          warhead, welded swept fins, a sooted nozzle bell; shading baked into its vertex colours, the overlay is
//          unlit), turned along the flight. The owner on the procedural first cut: "floating fins ... looks basic".
//   flame  an additive exhaust card behind it, a texture that fades out at BOTH ends (no seam), rolled to the eye
//   glow   a hot round glow at the nozzle, facing the eye, so a rocket coming straight at you still burns
// The overlay scene does not walk matrices (the tracers set theirs by hand), so each part's matrix is set here.
// One pool per game, grown on demand. The smoke trail is muzzle-smoke.ts TRAIL_SMOKE.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type GameContext } from './game-context';
import { faceEyeBasis, tracerBasis, tracerNearFade, type TracerBasis } from './tracer-sprite';
import type { Vec3 } from '../types';

export const ROCKET_VIEW = {
  /** The Blender rocket, nozzle mouth at its origin, nose along +Y. */
  url: '/assets/lab/tallow-rocket.glb',
  /** Its length, m (nozzle mouth to fuse cap): the ball's position is its middle. */
  bodyLen: 0.50,
  /** The exhaust card: length and width, m, behind the tail. */
  flameLen: 0.85,
  flameWidth: 0.26,
  /** The nozzle glow's diameter, m. */
  glowSize: 0.42,
  /** White-hot core to orange (the flame texture blends between them across and along it). */
  core: [1.0, 0.92, 0.70] as const,
  edge: [1.0, 0.45, 0.10] as const,
  /** HDR multipliers on the additive flame and glow (toneMapped off, like the muzzle flash's core): "brighter". */
  flameGain: 1.8,
  glowColour: [3.0, 1.9, 0.9] as const,
} as const;

/** The exhaust texture's alpha at (u along the card, 0 tail .. 1 nozzle; v across, 0..1). It rises to full just short
 *  of the nozzle and rounds off there, and fades out long toward the tail: zero at every edge, so the card has no
 *  seam however it is stretched. Pure. */
export function flameAlpha(u: number, v: number): number {
  const s = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const along = Math.pow(s(0.0, 0.85, u), 1.6) * (1 - s(0.88, 1.0, u));
  // Narrower toward the tail: a cone of flame, not a bar.
  const half = 0.18 + 0.30 * u;
  const d = Math.abs(v - 0.5) / half;
  // ...and a window that takes the long edges to exactly zero, so they never show as lines either.
  return along * Math.exp(-d * d * 2.2) * (1 - s(0.36, 0.5, Math.abs(v - 0.5)));
}

function flameTexture(): THREE.DataTexture {
  const W = 128, H = 32, px = new Uint8Array(W * H * 4);
  const [cr, cg, cb] = ROCKET_VIEW.core, [er, eg, eb] = ROCKET_VIEW.edge;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H, a = flameAlpha(u, v);
    // Hotter (whiter) toward the nozzle and the axis.
    const hot = Math.min(1, a * 1.3) * (0.4 + 0.6 * u);
    const i = (y * W + x) * 4;
    px[i] = 255 * (er + (cr - er) * hot); px[i + 1] = 255 * (eg + (cg - eg) * hot); px[i + 2] = 255 * (eb + (cb - eb) * hot);
    px[i + 3] = 255 * a;
  }
  const t = new THREE.DataTexture(px, W, H, THREE.RGBAFormat);
  t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  return t;
}

interface RocketMeshes { body: THREE.Group; flame: THREE.Mesh; glow: THREE.Mesh; hasModel: boolean }
interface Pool { views: RocketMeshes[]; flameTex: THREE.DataTexture; model: THREE.Object3D | null }
const pools = new WeakMap<GameContext, Pool>();

function poolOf(ctx: GameContext): Pool {
  let pool = pools.get(ctx);
  if (pool) return pool;
  const made: Pool = { views: [], flameTex: flameTexture(), model: null };
  pools.set(ctx, made);
  // The model loads once; until it arrives a rocket is its flame and glow. Unlit: its vertex colours carry the
  // baked AO, key light and tint.
  new GLTFLoader().loadAsync(ROCKET_VIEW.url).then(gltf => {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat; });
    made.model = gltf.scene;
  }).catch(err => console.warn('[sdf-game] tallow-rocket.glb failed to load; rockets draw as flame only', err));
  return made;
}

function attachModel(v: RocketMeshes, pool: Pool): void {
  if (v.hasModel || !pool.model) return;
  const m = pool.model.clone(true);
  m.traverse(o => { o.frustumCulled = false; });
  v.body.add(m);
  v.hasModel = true;
}

function newRocket(ctx: GameContext, pool: Pool): RocketMeshes {
  const body = new THREE.Group();
  body.matrixAutoUpdate = false;
  body.frustumCulled = false;
  const additive = (map: THREE.Texture) => new THREE.MeshBasicMaterial({
    map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(pool.flameTex));
  (flame.material as THREE.MeshBasicMaterial).color.setScalar(ROCKET_VIEW.flameGain);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(ctx.vfx.emberTex));
  (glow.material as THREE.MeshBasicMaterial).color.setRGB(...ROCKET_VIEW.glowColour);
  for (const m of [flame, glow]) { m.matrixAutoUpdate = false; m.frustumCulled = false; }
  ctx.vfx.characterEffects.scene.add(body, flame, glow);
  const v: RocketMeshes = { body, flame, glow, hasModel: false };
  attachModel(v, pool);
  return v;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function setQuad(m: THREE.Mesh, b: TracerBasis, sx: number, sy: number, c: Vec3): void {
  const { x, y, z } = b;
  m.matrix.set(
    x[0] * sx, y[0] * sy, z[0], c[0],
    x[1] * sx, y[1] * sy, z[1], c[1],
    x[2] * sx, y[2] * sy, z[2], c[2],
    0, 0, 0, 1,
  );
  m.matrixWorld.copy(m.matrix);
}

/** Draw rocket `k` of this step at `pos`, flying along `vel`, seen from `eye`. */
export function placeRocket(ctx: GameContext, k: number, pos: Vec3, vel: Vec3, eye: Vec3): void {
  if (!ctx.vfx.characterEffects) return;
  const pool = poolOf(ctx);
  while (pool.views.length <= k) pool.views.push(newRocket(ctx, pool));
  const v = pool.views[k]!;
  attachModel(v, pool);
  const R = ROCKET_VIEW;
  const sp = Math.hypot(vel[0], vel[1], vel[2]);
  if (!(sp > 1e-6)) { hideRocket(ctx, k); return; }
  const dir: Vec3 = [vel[0] / sp, vel[1] / sp, vel[2] / sp];
  // The shell: its tail at `pos` minus half its length, so the ball's position is its middle.
  const tail: Vec3 = [pos[0] - dir[0] * R.bodyLen * 0.5, pos[1] - dir[1] * R.bodyLen * 0.5, pos[2] - dir[2] * R.bodyLen * 0.5];
  tmpQ.setFromUnitVectors(UP, tmpDir.set(dir[0], dir[1], dir[2]));
  v.body.matrix.compose(new THREE.Vector3(tail[0], tail[1], tail[2]), tmpQ, new THREE.Vector3(1, 1, 1));
  v.body.matrixWorldNeedsUpdate = true;
  v.body.updateMatrixWorld(true);
  v.body.visible = true;
  const toEye: Vec3 = [eye[0] - tail[0], eye[1] - tail[1], eye[2] - tail[2]];
  const fade = tracerNearFade(Math.hypot(toEye[0], toEye[1], toEye[2]));
  // The flame: a card from the nozzle back along the flight, rolled to face the eye. Its u runs tail -> nozzle,
  // and the card's +X is the flight direction, so its centre sits half a flame length behind the nozzle.
  const fb = tracerBasis(dir, toEye);
  if (fb) {
    const c: Vec3 = [tail[0] - dir[0] * R.flameLen * 0.5, tail[1] - dir[1] * R.flameLen * 0.5, tail[2] - dir[2] * R.flameLen * 0.5];
    setQuad(v.flame, fb, R.flameLen, R.flameWidth, c);
    (v.flame.material as THREE.MeshBasicMaterial).opacity = fade;
    v.flame.visible = true;
  } else v.flame.visible = false;
  const gb = faceEyeBasis(toEye);
  if (gb) {
    setQuad(v.glow, gb, R.glowSize, R.glowSize, tail);
    (v.glow.material as THREE.MeshBasicMaterial).opacity = fade;
    v.glow.visible = true;
  } else v.glow.visible = false;
}

export function hideRocket(ctx: GameContext, k: number): void {
  const v = pools.get(ctx)?.views[k];
  if (!v) return;
  v.body.visible = false; v.flame.visible = false; v.glow.visible = false;
}

/** Hide every rocket from index `from` on (the pool is longer than this step's rockets). */
export function hideRocketsFrom(ctx: GameContext, from: number): void {
  const n = pools.get(ctx)?.views.length ?? 0;
  for (let k = from; k < n; k++) hideRocket(ctx, k);
}
