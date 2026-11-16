// ROCKET VIEW: how the tallow's volley shot draws (owner, 2026-11-15). The first rocket pass stretched the shared
// tracer to 2.6x its calibre and a 1.15 m streak: the owner saw "a visible seam" (the tracer sprite's hard front edge,
// blown up) and "no projectile". So a rocket gets its own view, three parts in the effects overlay:
//   body   a dark iron shell with a nose cone and four fins, turned along the flight (the projectile you can see)
//   flame  an additive exhaust card behind it, a texture that fades out at BOTH ends (no seam), rolled to the eye
//   glow   a hot round glow at the nozzle, facing the eye, so a rocket coming straight at you still burns
// The overlay scene does not walk matrices (the tracers set theirs by hand), so each part's matrix is set here.
// One pool per game, grown on demand. The smoke trail is muzzle-smoke.ts TRAIL_SMOKE.
import * as THREE from 'three';
import { type GameContext } from './game-context';
import { faceEyeBasis, tracerBasis, tracerNearFade, type TracerBasis } from './tracer-sprite';
import type { Vec3 } from '../types';

export const ROCKET_VIEW = {
  /** The shell: radius, body length and nose length, m. */
  radius: 0.055,
  bodyLen: 0.30,
  noseLen: 0.12,
  /** The exhaust card: length and width, m, behind the tail. */
  flameLen: 0.85,
  flameWidth: 0.26,
  /** The nozzle glow's diameter, m. */
  glowSize: 0.42,
  /** White-hot core to orange (the flame texture blends between them across and along it). */
  core: [1.0, 0.92, 0.70] as const,
  edge: [1.0, 0.45, 0.10] as const,
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

interface RocketMeshes { body: THREE.Group; flame: THREE.Mesh; glow: THREE.Mesh }
interface Pool { views: RocketMeshes[]; flameTex: THREE.DataTexture }
const pools = new WeakMap<GameContext, Pool>();

function poolOf(ctx: GameContext): Pool {
  let pool = pools.get(ctx);
  if (!pool) { pool = { views: [], flameTex: flameTexture() }; pools.set(ctx, pool); }
  return pool;
}

function newRocket(ctx: GameContext, pool: Pool): RocketMeshes {
  const R = ROCKET_VIEW;
  const body = new THREE.Group();
  const iron = new THREE.MeshBasicMaterial({ color: 0x2c2a28 });
  const steel = new THREE.MeshBasicMaterial({ color: 0x6a6560 });
  const rust = new THREE.MeshBasicMaterial({ color: 0x5a2a18 });
  // +Y is the flight direction; the tail (nozzle) at y 0.
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R.radius, R.radius * 0.9, R.bodyLen, 10), iron);
  shell.position.y = R.bodyLen / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(R.radius, R.noseLen, 10), steel);
  nose.position.y = R.bodyLen + R.noseLen / 2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R.radius * 1.08, R.radius * 1.08, 0.035, 10), rust);
  band.position.y = R.bodyLen * 0.72;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(R.radius * 0.7, R.radius * 0.95, 0.05, 10), steel);
  nozzle.position.y = -0.02;
  body.add(shell, nose, band, nozzle);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.11, 0.07), iron);
    const a = k * Math.PI / 2;
    fin.position.set(Math.cos(a) * (R.radius + 0.03), 0.06, Math.sin(a) * (R.radius + 0.03));
    fin.rotation.y = -a;
    body.add(fin);
  }
  body.matrixAutoUpdate = false;
  body.frustumCulled = false;
  body.traverse(o => { o.frustumCulled = false; });
  const additive = (map: THREE.Texture) => new THREE.MeshBasicMaterial({
    map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(pool.flameTex));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(ctx.vfx.emberTex));
  (glow.material as THREE.MeshBasicMaterial).color.setRGB(1.0, 0.7, 0.35);
  for (const m of [flame, glow]) { m.matrixAutoUpdate = false; m.frustumCulled = false; }
  const scene = ctx.vfx.characterEffects.scene;
  scene.add(body, flame, glow);
  return { body, flame, glow };
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
