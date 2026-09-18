// src/lab/sdf-zombie/webgpu/flame-cards.ts
//
// FLAME CARDS (flame-tongues plan task 3): additive camera-facing quads riding
// the burning body, playing a flame flipbook — how Blood itself drew flame
// licks (FIRE01). This is the one tongue technique that can later swap the
// live shader for BAKED frames, and the one that does not care that the
// soldier's kit is mesh: the cards envelop whatever the silhouette is.
//
// ── STRUCTURE (the explosion-vfx.ts split) ──────────────────────────────
// Pure, testable placement — FLAME_CARD_SLOTS / placeFlameCards / cardFrame —
// lives beside the GPU half: ONE dynamic BufferGeometry the CPU refills each
// frame with WORLD-space quads and ONE MeshBasicNodeMaterial, so N burning
// bodies cost one draw call. Vertices are world-space, so `object` must be
// added to a scene whose root transform is the identity
// (characterEffects.scene is).
//
// ── THE TRANSPARENCY RULES (explosion-vfx.ts:28-57, measured on WebGPU) ──
// Alpha lives in `colorNode.w`; blending is AdditiveBlending — measured as
// (SrcAlpha, One) non-premultiplied, so `vec4(rgb, coverage)` adds rgb*coverage.
// depthWrite stays OFF (never occlude), depthTest stays ON (walls, floor and
// the march's republished body depth still occlude the fire). NO alphaHash
// (renders as solid squares on this backend) and NO alphaTest (a cutout kills
// exactly the soft glow a flame is made of).
//
// The known card failure modes this design pushes against, both judged on the
// captures: cards CLIPPING INTO the body leave hard seams (so every anchor is
// biased a fraction toward the camera — the fire sits just in front of the
// flesh it burns), and sparse round BLOBS reading as particles rather than
// fire (so the procedural fallback is a domain-warped, tapered, blackbody-
// ramped flame — crisp licks, not soft balls — and the atlas path is real
// FIRE01 frames at a pixel-art Nearest mag filter).
//
// ── DETERMINISM ─────────────────────────────────────────────────────────
// No Math.random() anywhere. All per-card randomness is drawn from a seeded
// mulberry32 (the repo's canonical copy, game-weapon.ts) in SLOT order, so a
// placement list is a pure function of (burn, seed) and each slot's params
// are stable as burn rises — cards ignite and extinguish without re-randomising.
//
// ── ATLAS ABSENCE ───────────────────────────────────────────────────────
// The FIRE01 atlas is a DEV PLACEHOLDER (public/assets/flame-placeholder/,
// gitignored; scripts/build-flame-atlas.mjs writes it). Until setAtlas()
// hands a real texture over, the material keeps a procedural card shader and
// mixes it out per-uniform once the atlas loads — no recompile, and the page
// reports the mode in the panel's status box.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute, clamp, float, mix, mx_fractal_noise_float, smoothstep,
  texture, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { mulberry32 } from './game-weapon';
import type { Vec3 } from '../types';
import type { TongueTuning } from './tongue-tuning';

// ————————————————————————————————————————————————————————————————————————
// Pure placement — no THREE, no GPU. This is what the unit tests drive.
// ————————————————————————————————————————————————————————————————————————

/**
 * The card anchors: a POSED LIMB plus a small offset from that limb's centre,
 * in body-local axes (+x right, +y up, +z the facing the yaw rotates). The
 * limb's world centre is re-derived from the posed field every frame by the
 * host (the headShape pattern), so the cards RIDE THE POSE — a collapsed
 * body's torso card comes down with the torso instead of floating at
 * standing height, which is exactly the failure the captures caught.
 */
export interface FlameCardSlot {
  readonly name: string;
  readonly limb: 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';
  /** Offset from the limb centre, body-local metres. */
  readonly off: readonly [number, number, number];
}

export const FLAME_CARD_SLOTS: readonly FlameCardSlot[] = Object.freeze([
  { name: 'torsoFront', limb: 'torso', off: [0, 0.15, 0.17] },
  { name: 'torsoBack', limb: 'torso', off: [0, 0.15, -0.17] },
  { name: 'torsoLeft', limb: 'torso', off: [-0.22, 0.2, 0] },
  { name: 'torsoRight', limb: 'torso', off: [0.22, 0.2, 0] },
  { name: 'head', limb: 'head', off: [0, 0.05, 0.02] },
  { name: 'shoulderL', limb: 'armL', off: [0, 0.25, 0] },
  { name: 'shoulderR', limb: 'armR', off: [0, 0.25, 0] },
  { name: 'upperArmL', limb: 'armL', off: [0, 0, 0] },
  { name: 'upperArmR', limb: 'armR', off: [0, 0, 0] },
  { name: 'lowerArmL', limb: 'armL', off: [0, -0.3, 0.04] },
  { name: 'lowerArmR', limb: 'armR', off: [0, -0.3, 0.04] },
  { name: 'pelvis', limb: 'torso', off: [0, -0.35, 0.08] },
  { name: 'thighL', limb: 'legL', off: [0, 0.25, 0.04] },
  { name: 'thighR', limb: 'legR', off: [0, 0.25, 0.04] },
  { name: 'shinL', limb: 'legL', off: [0, -0.28, 0.03] },
  { name: 'shinR', limb: 'legR', off: [0, -0.28, 0.03] },
  // Boot level: the leg cluster's centre is its fattest (thigh) mass, so the
  // lower leg needs a longer reach. The floor's own depth clips whatever
  // pokes below ground on a lying body, and the flame above it hugs the
  // corpse — the reference burns top to bottom, not to the knee.
  { name: 'bootL', limb: 'legL', off: [0, -0.58, 0.03] },
  { name: 'bootR', limb: 'legR', off: [0, -0.58, 0.03] },
] as const);

/** The posed limb centres a body feeds update() — world metres. */
export type FlameCardAnchors = Record<FlameCardSlot['limb'], Vec3>;

/** One active card: its slot, and the seeded params it will animate with. */
export interface FlameCardPlacement {
  /** Index into FLAME_CARD_SLOTS. */
  slot: number;
  /** Height multiplier on the technique's `length`, ~0.65..1.4. */
  scale: number;
  /** Phase offset through the clip as a 0..1 fraction. */
  phase: number;
  /** Starting frame (the flipbook does not have to open at 0). */
  frame: number;
  /** Per-card brightness jitter, ~0.75..1.15. */
  heat: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The active cards for a burn level: each slot owns an IGNITION THRESHOLD
 * drawn once from the seeded stream, so raising burn lights more slots and
 * lowering it puts them out — never reshuffles them. burn 0 is nothing (the
 * thresholds sit above 0) and burn 1 is every slot (they sit below 0.8).
 */
export function placeFlameCards(burn: number, seed: number): FlameCardPlacement[] {
  const b = clamp01(burn);
  if (b <= 0) return [];
  const rng = mulberry32(seed);
  const out: FlameCardPlacement[] = [];
  for (let i = 0; i < FLAME_CARD_SLOTS.length; i++) {
    const threshold = 0.08 + rng() * 0.72;
    const scale = 0.65 + rng() * 0.75;
    const phase = rng();
    const frame = Math.floor(rng() * 8) % 8;
    const heat = 0.75 + rng() * 0.4;
    if (b >= threshold) out.push({ slot: i, scale, phase, frame, heat });
  }
  return out;
}

/**
 * The flipbook frame at `time` for a card offset `phase` (seconds), at `fps`
 * over `frames`, wrapping — the atlas is a loop, not a one-shot.
 */
export function cardFrame(time: number, phase: number, frames: number, fps: number): number {
  const f = Math.floor((time + phase) * fps);
  return ((f % frames) + frames) % frames;
}

// ————————————————————————————————————————————————————————————————————————
// The GPU half — one material, one refilled quad buffer.
// ————————————————————————————————————————————————————————————————————————

/** TSL's published typings reject chained arithmetic; cast at the call site,
 *  the repo's convention (explosion-vfx.ts). */
interface Tsl {
  x: Tsl; y: Tsl; z: Tsl; w: Tsl; r: Tsl; g: Tsl; b: Tsl; a: Tsl; rgb: Tsl;
  add(v: Tsl | number): Tsl; sub(v: Tsl | number): Tsl;
  mul(v: Tsl | number): Tsl; div(v: Tsl | number): Tsl;
  abs(): Tsl; pow(v: Tsl | number): Tsl; oneMinus(): Tsl; sin(): Tsl;
  clamp(lo: Tsl | number, hi: Tsl | number): Tsl;
  smoothstep(e0: Tsl | number, e1: Tsl | number): Tsl;
  max(v: Tsl | number): Tsl;
}
type N = never;

/** Flipbook playback rate. Blood's FIRE01 reads at about this speed. */
export const FLAME_CARD_FPS = 15;

/** The camera-toward bias, in metres, that keeps a card's face just in front
 *  of the flesh it burns — the anti-seam half of the clipping defence. */
export const FLAME_CARD_TOWARD_CAM = 0.09;

/** How much of the body's velocity (m/s) becomes a horizontal flame trail at
 *  lean = 1, in seconds — flames lag the walk. */
const LEAN_TRAIL_SEC = 0.16;

/** Vertical stretch on the atlas cell — FIRE01's cells are wider than tall,
 *  but a rising lick must be taller than wide. */
const CARD_STRETCH = 1.5;

const VERTS_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

/** The 4 corners of a unit quad, CCW, with their 0..1 uv (y up the flame). */
const QUAD_CORNERS: readonly (readonly [number, number, number, number])[] = [
  [-0.5, 0, 0, 0], [0.5, 0, 1, 0], [0.5, 1, 1, 1], [-0.5, 1, 0, 1],
];

/** The blackbody-ish ramp, walked base-hot to tip-cool (explosion-vfx's). */
function fireRamp(t: Tsl): Tsl {
  const a = mix(vec3(0.42, 0.015, 0) as N, vec3(1.0, 0.11, 0.01) as N,
    smoothstep(0.0, 0.22, t as N) as N) as unknown as Tsl;
  const b = mix(a as N, vec3(1.0, 0.42, 0.04) as N,
    smoothstep(0.22, 0.5, t as N) as N) as unknown as Tsl;
  const c = mix(b as N, vec3(1.0, 0.8, 0.22) as N,
    smoothstep(0.5, 0.78, t as N) as N) as unknown as Tsl;
  return mix(c as N, vec3(1.0, 0.97, 0.88) as N,
    smoothstep(0.78, 1.0, t as N) as N) as unknown as Tsl;
}

/** Uniforms the look graph reads. */
export function makeFlameCardUniforms() {
  return {
    time: uniform(0),
    gain: uniform(1.8),
    rise: uniform(2.2),
    ragged: uniform(0.6),
    atlasOn: uniform(0),
  };
}
export type FlameCardUniforms = ReturnType<typeof makeFlameCardUniforms>;

/** One burning body's per-frame input to update(). */
export interface FlameCardFrame {
  /** Body yaw, radians — rotates the body-local slot offsets. */
  yaw: number;
  /** The POSED limb centres, world metres — see FlameCardAnchors. */
  anchors: FlameCardAnchors;
  /** 0..1 burn level; 0 draws nothing for this body. */
  burn: number;
  /** World velocity m/s, for the lean trail. Optional; defaults to still. */
  vel?: Vec3;
}

export interface FlameCards {
  /** Add to the EFFECTS scene (identity root transform) — see the header. */
  readonly object: THREE.Group;
  /** Refill the quads for this frame. `time` is wall-clock seconds. */
  update(bodies: readonly FlameCardFrame[], camera: THREE.Camera, time: number): void;
  /** The shared tongue tuning seam (length/gain/rise/ragged/lean). */
  setTuning(t: TongueTuning): void;
  /** Swap the procedural fallback for the FIRE01 atlas (no recompile). */
  setAtlas(tex: THREE.Texture, frames: number, cellW: number, cellH: number): void;
  /** Whether the atlas is live (false = procedural fallback). */
  readonly atlasMode: boolean;
  /** The atlas cell aspect, once known. */
  readonly atlasAspect: number;
  /** Quads written last update (telemetry). */
  readonly liveCards: number;
  dispose(): void;
}

export function createFlameCards(opts: { maxBodies?: number } = {}): FlameCards {
  const maxBodies = Math.max(1, opts.maxBodies ?? 2);
  const capacity = maxBodies * FLAME_CARD_SLOTS.length;

  const u = makeFlameCardUniforms();
  // The TSL-typed aliases of the same uniform objects the setters write.
  const uTime = u.time as unknown as Tsl;
  const uGain = u.gain as unknown as Tsl;
  const uRise = u.rise as unknown as Tsl;
  const uRagged = u.ragged as unknown as Tsl;
  const uAtlasOn = u.atlasOn as unknown as Tsl;

  // Atlas texture NODE, built over a 1x1 transparent fallback and repointed
  // by setAtlas — the post-aa swap pattern (a texture binding is baked per
  // material; the node identity must never change, only its .value).
  const atlasFallback = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat,
  );
  atlasFallback.needsUpdate = true;

  const aUv = attribute('aUv', 'vec2') as unknown as Tsl;
  // Per-vertex card params: (seed, heat, frameU0, frameDu).
  const aCard = attribute('aCard', 'vec4') as unknown as Tsl;
  const seed = aCard.x;
  const heat = aCard.y;
  const frameU0 = aCard.z;
  const frameDu = aCard.w;

  // — PROCEDURAL FIRE (the atlas-absent fallback) ————————————————
  // A flame lick, not a blob: a tapering silhouette, a domain-warped noise
  // field advected upward, and the blackbody ramp with a hard extinction at
  // the cold end. The warp and the tip cut carry `ragged`; the advection
  // carries `rise`; per-card `seed` decorrelates the whole field.
  const warp = mx_fractal_noise_float(
    vec3(
      aUv.x.mul(3.1).add(seed.mul(19.7)) as N,
      aUv.y.mul(2.4).sub(uTime.mul(uRise).mul(0.55)) .add(seed.mul(7.3)) as N,
      uTime.mul(0.4).add(seed.mul(3.1)) as N,
    ) as N, 3, 2.0, 0.5) as unknown as Tsl;
  const taper = (float(0.95) as unknown as Tsl)
    .sub(aUv.y.mul(0.85)).max(0.12) as unknown as Tsl;
  const cx = aUv.x.sub(0.5)
    .add(warp.sub(0.5).mul(uRagged.mul(1.5))) as unknown as Tsl;
  const across = cx.div(taper as N).abs() as unknown as Tsl;
  const tip = aUv.y.add(warp.sub(0.5).mul(uRagged.mul(0.7))) as unknown as Tsl;
  const core = clamp((float(1) as unknown as Tsl).sub(across) as N, 0.0, 1.0)
    .mul(clamp((float(1.12) as unknown as Tsl).sub(tip) as N, 0.0, 1.0) as N) as unknown as Tsl;
  const tProc = clamp(core.mul(1.35).sub(0.04) as N, 0.0, 1.0) as unknown as Tsl;
  const procRgb = fireRamp(tProc);
  const procA = clamp(
    smoothstep(0.02, 0.2, tProc as N).mul(core as N) as N, 0.0, 1.0,
  ) as unknown as Tsl;

  // — ATLAS FIRE (the FIRE01 flipbook) ————————————————————————————
  const atlasUv = vec2(
    frameU0.add(aUv.x.mul(frameDu)) as N,
    aUv.y as N,
  );
  const atlasTexNode = texture(atlasFallback, atlasUv as N) as unknown as Tsl & {
    value: THREE.Texture;
  };
  const atlasRgb = atlasTexNode.rgb as unknown as Tsl;
  const atlasA = atlasTexNode.a as unknown as Tsl;

  // — Combined: the atlas uniform mixes the two paths with no recompile. —
  // A two-rate breathe per card, the fire-light's own wobble shape
  // (burn-light.ts), so cards never pulse in step.
  const breathe = uTime.mul(7.3).add(seed.mul(31.0)).sin().mul(0.1)
    .add(uTime.mul(17.1).add(seed.mul(11.0)).sin().mul(0.05).add(0.85)) as unknown as Tsl;
  const rgb = mix(procRgb as N, atlasRgb as N, uAtlasOn as N)
    .mul(uGain as N).mul(heat as N).mul(breathe as N) as unknown as Tsl;
  const cov = mix(procA as N, atlasA as N, uAtlasOn as N)
    .mul(heat as N).mul(breathe as N) as unknown as Tsl;

  const material = new MeshBasicNodeMaterial();
  material.name = 'flame-cards';
  material.colorNode = vec4(rgb as N, clamp(cov as N, 0.0, 1.0) as N) as never;
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;   // (SrcAlpha, One) on this backend
  material.depthWrite = false;                  // never occlude
  material.depthTest = true;                    // walls and bodies still occlude
  material.side = THREE.DoubleSide;
  material.toneMapped = false;                  // added over a composited frame
  material.fog = false;

  // The refilled quad buffer — explosion-vfx's makeLayer shape.
  const verts = capacity * VERTS_PER_QUAD;
  const pos = new Float32Array(verts * 3);
  const uvArr = new Float32Array(verts * 2);
  const card = new Float32Array(verts * 4);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const uvAttr = new THREE.BufferAttribute(uvArr, 2);
  const cardAttr = new THREE.BufferAttribute(card, 4);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  uvAttr.setUsage(THREE.DynamicDrawUsage);
  cardAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aUv', uvAttr);
  geo.setAttribute('aCard', cardAttr);
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  const idx = new Uint32Array(capacity * INDICES_PER_QUAD);
  for (let q = 0; q < capacity; q++) {
    const v = q * VERTS_PER_QUAD;
    const i = q * INDICES_PER_QUAD;
    idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
    idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'FlameCards';
  mesh.frustumCulled = false;   // world-space verts, geometry at the origin
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 1;

  const object = new THREE.Group();
  object.name = 'FlameCardsGroup';
  object.matrixAutoUpdate = false;
  object.add(mesh);

  // Live state.
  let atlasFrames = 8;
  let aspect = 31 / 25;   // the FIRE01 cell aspect the atlas ships with
  let atlasLive = false;
  let liveCards = 0;
  let tuning: TongueTuning | null = null;
  // Preallocated scratch — update() allocates nothing.
  const camPos = new THREE.Vector3();

  return {
    object,
    update(bodies, camera, time) {
      const len = tuning?.length ?? 0.45;
      const lean = tuning?.lean ?? 0.4;
      u.time.value = time;
      const clipSec = atlasFrames / FLAME_CARD_FPS;
      camera.getWorldPosition(camPos);
      let quad = 0;
      for (let bi = 0; bi < bodies.length; bi++) {
        const f = bodies[bi]!;
        const b = clamp01(f.burn);
        if (b <= 0.01) continue;
        // Per-BODY seed: stable for a body across frames, distinct between
        // bodies — the pair must not flicker in step.
        const placements = placeFlameCards(b, (0x51c0ff + bi * 977) >>> 0);
        const cy = Math.cos(f.yaw);
        const sy = Math.sin(f.yaw);
        const vel = f.vel;
        const tx = vel ? -vel[0]! * LEAN_TRAIL_SEC * lean : 0;
        const tz = vel ? -vel[2]! * LEAN_TRAIL_SEC * lean : 0;
        for (const p of placements) {
          if (quad >= capacity) break;
          const slot = FLAME_CARD_SLOTS[p.slot]!;
          // Limb-centred anchor: the posed limb's world centre plus the
          // body-local offset rotated by the body yaw. The pose is in the
          // anchor, so a collapsed body's flames come down with it.
          const base = f.anchors[slot.limb];
          const lx = slot.off[0]!;
          const ly = slot.off[1]!;
          const lz = slot.off[2]!;
          const wx = base[0]! + lx * cy + lz * sy;
          const wz = base[2]! - lx * sy + lz * cy;
          const wy = base[1]! + ly;
          // Camera-facing basis with the up axis pinned to world vertical
          // (a flame must not lean with the camera pitch): the horizontal
          // direction to the camera gives right = (dz, 0, -dx) normalised.
          const toCx = camPos.x - wx;
          const toCz = camPos.z - wz;
          const hx = Math.hypot(toCx, toCz) || 1;
          const ndx = toCx / hx;
          const ndz = toCz / hx;
          const rx = ndz;
          const rz = -ndx;
          // Toward-camera bias: sit the card's plane just in front of the
          // flesh it burns, so the body's own republished depth cannot slice
          // it (the seam failure mode). The vertical is left alone.
          const bias = FLAME_CARD_TOWARD_CAM * (0.6 + 0.4 * p.scale);
          const ax = wx + ndx * bias + tx;
          const ay = wy;
          const az = wz + ndz * bias + tz;
          // Size: length x per-card scale, atlas aspect, stretched tall.
          const h = len * p.scale;
          const w = (h * aspect) / CARD_STRETCH;
          // Flipbook frame — the phase fraction spans the whole clip.
          const frame = cardFrame(time, p.phase * clipSec, atlasFrames, FLAME_CARD_FPS);
          const u0 = frame / atlasFrames;
          const du = 1 / atlasFrames;
          const vBase = quad * VERTS_PER_QUAD;
          for (let k = 0; k < 4; k++) {
            const c = QUAD_CORNERS[k]!;
            const ox = c[0]! * w;
            const oy = c[1]! * h;
            const o = (vBase + k) * 3;
            pos[o] = ax + rx * ox;
            pos[o + 1] = ay + oy;
            pos[o + 2] = az + rz * ox;
            const po = (vBase + k) * 2;
            uvArr[po] = c[2]!;
            uvArr[po + 1] = c[3]!;
            const bo = (vBase + k) * 4;
            card[bo] = p.slot * 2.399 + 1;
            card[bo + 1] = p.heat * b;
            card[bo + 2] = u0;
            card[bo + 3] = du;
          }
          quad++;
        }
      }
      liveCards = quad;
      geo.setDrawRange(0, quad * INDICES_PER_QUAD);
      posAttr.needsUpdate = true;
      uvAttr.needsUpdate = true;
      cardAttr.needsUpdate = true;
    },
    setTuning(t) {
      tuning = t;
      u.gain.value = t.gain;
      u.rise.value = t.rise;
      u.ragged.value = t.ragged;
    },
    setAtlas(tex, frames, cellW, cellH) {
      atlasFrames = Math.max(1, frames);
      aspect = cellW / cellH;
      atlasTexNode.value = tex;
      u.atlasOn.value = 1;
      atlasLive = true;
    },
    get atlasMode() { return atlasLive; },
    get atlasAspect() { return aspect; },
    get liveCards() { return liveCards; },
    dispose() {
      geo.dispose();
      material.dispose();
      atlasFallback.dispose();
      object.removeFromParent();
    },
  };
}
