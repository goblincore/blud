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
// ── CARD SEAMS (flame-polish task 1, 2026-09-18) ────────────────────────
// The close captures read as a mosaic of hard rectangles. Three fixes landed:
// (1) the atlas fallback DataTexture is now Linear/Linear — a Nearest fallback
// makes WGSLNodeBuilder bake `textureLoad` into the shader, so the swapped-in
// atlas was ALWAYS point-sampled and each 31x25 FIRE01 texel became a ~10 px
// flat block. This was the actual cause; the filter now applies.
// (2) cardCellUv insets each frame's uv by half a texel and skips the atlas
// builder's 2 px gutter, so a boundary tap cannot read the neighbouring frame.
// (3) a soft-particle depth fade (BurnTuning.cardSoftFade) rounds the straight
// depth-test cut where a card crosses the body.
//
// ── CURL FLOW (flame-polish task 2, 2026-09-18) ─────────────────────────
// The flipbook alone gives each card its own phase, which reads as N quads
// flickering alone. A shared 64^3 curl-noise volume (curl-volume.ts) now drives
// the motion: the fragment shader samples it at `positionWorld / 6` scrolled
// upward by time and warps the atlas UV by the decoded vector, and update()
// displaces each card's whole anchor by the SAME field sampled on the CPU. The
// field is divergence-free (curl noise) and smooth, so a limb full of cards
// gets near-identical vectors and the flame mass flows as one body. flameFlow
// (BurnTuning, 0..1, default 0.35) scales both; 0 is the old flicker.
//
// The UV warp is bounded to FLAME_FLOW_UV of a cell so a warped tap can never
// leave the atlas gutter and read the neighbouring frame — the seam this file
// just fixed.
//
// The known card failure modes this design pushes against, both judged on the
// captures: cards CLIPPING INTO the body leave hard seams (so every anchor is
// biased a fraction toward the camera — the fire sits just in front of the
// flesh it burns), and sparse round BLOBS reading as particles rather than
// fire (so the procedural fallback is a domain-warped, tapered, blackbody-
// ramped flame — crisp licks, not soft balls — and the atlas path is real
// FIRE01 frames, linearly filtered at close range).
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
  attribute, clamp, float, linearDepth, mix,
  mx_fractal_noise_float, positionWorld, smoothstep, texture, uniform,
  vec2, vec3, vec4,
} from 'three/tsl';
import { mulberry32 } from './game-weapon';
import { sampleCurlVolume, CURL_SCALE } from './curl-volume';
import { curlVector, getCurlVolumeData } from './curl-volume-node';
import { softParticleFade } from './soft-fade';
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
  // Boot level: the leg anchors at the posed cluster's MEAN centre (roughly
  // mid-thigh, see limbAnchors in flame-lab-main.ts), so the lower leg needs a
  // longer reach than an arm. The floor's own depth clips whatever pokes below
  // ground on a lying body, and the flame above it hugs the corpse — the
  // reference burns top to bottom, not to the knee.
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

/**
 * The u-range of one frame in a horizontal-strip flipbook atlas, inset by half
 * a texel on each side.
 *
 * A strip packs its cells edge to edge, so the card's `0..1` across-face uv is
 * scaled into a cell. Any rounding at the boundary then samples the NEIGHBOURING
 * frame — a hard-edged rectangle of a different flame, the "card seam" the close
 * captures show. Pulling both ends in by half a texel keeps every tap inside its
 * own cell.
 *
 * `padTexels` matches the transparent gutter build-flame-atlas.mjs now puts
 * around each cell: cells are pitched at `cellWidthTexels + 2 * padTexels` and
 * the frame content starts `padTexels` in, so the gap between two cells is
 * `2 * padTexels` wide. With `padTexels = 0` this reduces to the gapless strip
 * the unit test pins.
 *
 * @param frame           0-based frame index
 * @param frames          frames in the strip
 * @param atlasWidth      atlas width in texels
 * @param padTexels       transparent gutter on each side of a cell
 * @param cellWidthTexels content width in texels (defaults to a gapless strip)
 */
export function cardCellUv(
  frame: number,
  frames: number,
  atlasWidth: number,
  padTexels = 0,
  cellWidthTexels = atlasWidth / frames - 2 * padTexels,
): { u0: number; u1: number } {
  const pitch = cellWidthTexels + 2 * padTexels;
  const left = frame * pitch + padTexels;
  const inset = 0.5 / atlasWidth;
  return {
    u0: left / atlasWidth + inset,
    u1: (left + cellWidthTexels) / atlasWidth - inset,
  };
}

/** The smallest distance a card's plane sits from its anchor, metres, before
 *  any covering geometry is accounted for — the old toward-camera bias floor. */
export const FLAME_CARD_MIN_STANDOFF = 0.02;

/** Leg slots need a hair more: their anchor is the limb cluster's MEAN centre
 *  rather than the limb surface, so a leg card can graze the limb's own
 *  surface even with no kit. */
export const FLAME_CARD_LEG_MIN_STANDOFF = 0.03;

/** The gap kept between a covering shell's outer radius and the card plane, so
 *  the card's depth clears the armour rather than z-fighting it. */
export const FLAME_CARD_KIT_CLEARANCE = 0.045;

/** Which slots a per-character kit radius applies to — the greaves are the
 *  covering mesh the captures show occluding. */
const LEG_SLOT = /shin|boot|thigh|leg/i;

/** The boot is not just the shin with more radius: the armoured boot's toe
 *  reaches ~0.31 m forward of the ankle axis (measured on soldier-kit.gltf),
 *  further than the greave around the shin, so a boot card needs a
 *  proportionally larger standoff to clear it. */
const BOOT_SLOT = /boot/i;
export const FLAME_CARD_BOOT_GAIN = 2.1;

/** Metres the boot card's anchor is lowered toward the foot when a greave
 *  covers the limb. The soldier's boot slot anchors at y≈0.14 (measured from
 *  the posed leg cluster: mean 0.72 − 0.58), which is the boot's TOP; without
 *  this the flame's base stops above the boot and the boot stays green no
 *  matter how far the card is pushed forward. */
export const FLAME_CARD_BOOT_DROP = 0.12;

/**
 * The soldier greave's outer radius from the shin axis, metres.
 *
 * MEASURED from the shipped kit mesh (`public/assets/lab/soldier-kit.gltf`),
 * not guessed: bind-pose vertices in the shin band (y 0.28..0.80) reach 0.14 m
 * from the shin bone's vertical axis (bulk 0.08..0.14, z within ±0.108). The
 * card's fixed 0.09 m toward-camera bias therefore sat INSIDE that shell and
 * the greave's depth test erased the shin and boot cards.
 *
 * The kit is a skinned mesh with no per-limb bounds reachable from this module
 * (character-view only exposes the posed `KitOverlay`), so this is the plan's
 * sanctioned per-character constant, not runtime per-limb bounds. Re-measure
 * with the accessor walk in the task notes if the kit art changes.
 */
export const SOLDIER_LEG_KIT_RADIUS = 0.14;

/**
 * How far a card's plane must sit from its anchor along its outward normal
 * (the horizontal direction to the camera — the camera-facing quad's own
 * normal) so covering geometry cannot occlude it.
 *
 * `slot` picks the floor (legs vs everything else); `kitRadius` is the covering
 * shell's outer radius around the limb, 0 when bare. A bare limb keeps the
 * floor; a clad one is pushed to `kitRadius + FLAME_CARD_KIT_CLEARANCE`. This
 * is the fix the plan calls for: move the card outside what actually covers
 * the limb, never touch `depthTest`.
 */
export function cardStandoff(slot: string, opts: { kitRadius?: number } = {}): number {
  const floor = LEG_SLOT.test(slot) ? FLAME_CARD_LEG_MIN_STANDOFF : FLAME_CARD_MIN_STANDOFF;
  const kit = Math.max(0, opts.kitRadius ?? 0);
  const need = BOOT_SLOT.test(slot) ? kit * FLAME_CARD_BOOT_GAIN : kit;
  return kit > 0 ? Math.max(floor, need + FLAME_CARD_KIT_CLEARANCE) : floor;
}

/**
 * How far a card's anchor drops toward the foot, metres. Only a boot slot on a
 * kit-covered limb: the greave reaches down to the boot, and the boot slot's
 * fixed offset from the leg cluster's mean centre lands at the boot's top, so
 * the flame base must be lowered to sit over the boot. Everything else is 0,
 * which keeps the zombie (no kit) and the whole upper body exactly as tuned.
 */
export function cardAnchorDrop(slot: string, opts: { kitRadius?: number } = {}): number {
  const kit = Math.max(0, opts.kitRadius ?? 0);
  return BOOT_SLOT.test(slot) && kit > 0 ? FLAME_CARD_BOOT_DROP : 0;
}

/** Metres the base of a corpse's flame pile sits above the ground, so the heap
 *  reads as ON the floor rather than half-sunk into it (flame-polish task 5). */
export const FLAME_PILE_LIFT = 0.06;

/** Fraction of the way from a card's live anchor to the body's ground centre
 *  that a fully-settled (settle = 1) pile pulls it. 0.75 keeps a little of each
 *  limb's spread so the heap still has a shape; 1 would collapse every card
 *  onto one point and read as a single quad. */
export const FLAME_PILE_PULL = 0.75;

/** Fraction a settled pile card's HEIGHT is shortened by, so the column that
 *  stood over the body comes down into a low heap of licks rather than a
 *  full-height wall of flame lying on its side (flame-polish task 5). */
export const FLAME_PILE_SHRINK = 0.5;

/**
 * Where a dying body's card anchor moves as the corpse settles into a ground
 * pile (flame-polish task 5). `anchor` is the live posed anchor (metres),
 * `centre` the body's ground-plan centre (its torso anchor), `groundY` the
 * floor height and `settle` the burn-down progress 0..1.
 *
 * At settle 0 this is the identity — a body that is merely alight keeps exactly
 * the look tasks 1-4 tuned. As `settle` rises the anchor is pulled toward the
 * centre of the body's footprint and lowered to `groundY + FLAME_PILE_LIFT`, so
 * a killed body's fire collapses into a heap at its feet instead of standing
 * over a corpse. Pure and exported for the unit test; the GPU half just calls
 * it per card.
 */
export function cardSettleAnchor(
  anchor: Vec3, centre: Vec3, groundY: number, settle: number,
): Vec3 {
  const t = clamp01(settle);
  if (t <= 0) return [anchor[0], anchor[1], anchor[2]];
  const pull = t * FLAME_PILE_PULL;
  return [
    anchor[0] + (centre[0] - anchor[0]) * pull,
    anchor[1] + (groundY + FLAME_PILE_LIFT - anchor[1]) * t,
    anchor[2] + (centre[2] - anchor[2]) * pull,
  ];
}

/**
 * The world-space displacement a card ANCHOR takes from the shared curl field
 * (flame-polish task 2) — the CPU half of the flow. `flow` is 0..1
 * (BurnTuning.flameFlow) and `time` is the same wall clock the shader's UV warp
 * uses, so a card both moves and flows from one field.
 *
 * Kept pure and exported so the contract that matters — neighbours get
 * near-identical offsets, so a limb's cards move together — is testable
 * without a GPU.
 */
export function cardCurlOffset(
  data: Uint8Array, anchor: Vec3, time: number, flow: number,
): Vec3 {
  if (!(flow > 0)) return [0, 0, 0];
  const amp = FLAME_FLOW_WORLD * Math.min(1, flow);
  const c = sampleCurlVolume(
    data,
    anchor[0] / CURL_SCALE,
    anchor[1] / CURL_SCALE - time * FLAME_CURL_RISE,
    anchor[2] / CURL_SCALE,
  );
  return [c[0] * amp, c[1] * amp, c[2] * amp];
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

/** Volume units per second the curl field scrolls upward: the flow rises. The
 *  shimmer has to be slower than the flipbook (15 fps) or it reads as noise. */
const FLAME_CURL_RISE = 0.45;

/** Peak card WORLD displacement in metres at flameFlow = 1. Cards are ~0.45 m
 *  long, so this is a visible sway at the default without unhooking them. */
const FLAME_FLOW_WORLD = 0.5;

/** Atlas-cell fraction the per-fragment UV warp reaches at flameFlow = 1.
 *  The atlas gutter is 2 px per cell side (31x25 cells), so 0.06 of a cell is
 *  ~1.9 px and stays inside the gutter; beyond that a warped tap would sample
 *  the neighbouring frame — the very seam task 1 fixed. */
const FLAME_FLOW_UV = 0.055;

/** Procedural-path warp amplitude (in the mx_fractal_noise_float domain) at
 *  flameFlow = 1. The atlas needs the tight bound above; this path has no
 *  neighbouring cell to bleed into, so the flow can push harder. */
const FLAME_FLOW_PROC = 0.9;

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
    /** The v range of the cell CONTENT inside the (gutter-padded) atlas; with no
     *  gutter this is exactly 0..1, so the padding never shrinks the flame. */
    atlasV0: uniform(0),
    atlasV1: uniform(1),
    /** Soft-particle fade distance in METRES; 0 disables it (inert). */
    softFade: uniform(0.08),
    /** Curl-flow strength 0..1 (BurnTuning.flameFlow); 0 is the old flicker. */
    flow: uniform(0.35),
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
  /** Covering-mesh outer radius around the LEGS, metres (0 = bare). The soldier
   *  greaves are the case the captures show occluding the shin/boot cards; the
   *  lab feeds SOLDIER_LEG_KIT_RADIUS for him and 0 for the zombie. Only leg
   *  slots consume it, so the approved upper-body engulfment is untouched. */
  kitRadius?: number;
  /** Burn-down progress 0..1 for a KILLED body (flame-polish task 5). At 0 a
   *  live burning body is untouched; as it rises the cards collapse into a
   *  ground pile (cardSettleAnchor). Omit for the living. */
  settle?: number;
  /** Floor height the settled pile's base sits above, metres. Omit for 0. */
  groundY?: number;
}

export interface FlameCards {
  /** Add to the EFFECTS scene (identity root transform) — see the header. */
  readonly object: THREE.Group;
  /** Refill the quads for this frame. `time` is wall-clock seconds. */
  update(bodies: readonly FlameCardFrame[], camera: THREE.Camera, time: number): void;
  /** The shared tongue tuning seam (length/gain/rise/ragged/lean). */
  setTuning(t: TongueTuning): void;
  /** Soft-particle fade distance in metres; 0 disables it (BurnTuning.cardSoftFade). */
  setSoftFade(metres: number): void;
  /** Curl-flow strength 0..1 (BurnTuning.flameFlow); 0 is the old flicker. */
  setFlow(flow: number): void;
  /** Swap the procedural fallback for the FIRE01 atlas (no recompile).
   *  `padTexels` is the atlas builder's transparent gutter per cell side. */
  setAtlas(tex: THREE.Texture, frames: number, cellW: number, cellH: number, padTexels?: number): void;
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
  const uAtlasV0 = u.atlasV0 as unknown as Tsl;
  const uAtlasV1 = u.atlasV1 as unknown as Tsl;
  const uSoftFade = u.softFade as unknown as Tsl;
  const uFlow = u.flow as unknown as Tsl;

  // The SHARED curl volume (module singleton, curl-volume-node.ts): one
  // Data3DTexture for every effect, plus the CPU array update() displaces
  // anchors with. This module neither builds nor disposes it — the old
  // per-effect texture is gone, so cards and explosions swirl through one field.
  const curlData = getCurlVolumeData();

  // Atlas texture NODE, built over a 1x1 transparent fallback and repointed
  // by setAtlas — the post-aa swap pattern (a texture binding is baked per
  // material; the node identity must never change, only its .value).
  //
  // THE FALLBACK'S FILTERS ARE LOAD-BEARING, and this is the card-seam root
  // cause (flame-polish task 1). A THREE.DataTexture defaults to Nearest on
  // BOTH filters, and WGSLNodeBuilder.isUnfilterable() then bakes
  // `textureLoad` (integer texel fetch, no filtering) into the compiled
  // shader. The atlas is swapped in later by writing `.value`, which never
  // recompiles the shader — so the loaded PNG's own magFilter was silently
  // ignored and the 31x25 FIRE01 cells were ALWAYS point-sampled. At the
  // close framing each texel becomes a ~10 px flat rectangle. Forcing the
  // fallback to Linear makes the builder emit a real filtering sampler, so
  // the bound atlas's filter finally decides the look.
  const atlasFallback = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat,
  );
  atlasFallback.magFilter = THREE.LinearFilter;
  atlasFallback.minFilter = THREE.LinearFilter;
  atlasFallback.needsUpdate = true;

  const aUv = attribute('aUv', 'vec2') as unknown as Tsl;
  // Per-vertex card params: (seed, heat, frameU0, frameDu).
  const aCard = attribute('aCard', 'vec4') as unknown as Tsl;
  const seed = aCard.x;
  const heat = aCard.y;
  const frameU0 = aCard.z;
  const frameDu = aCard.w;

  // — THE SHARED CURL FLOW (flame-polish task 2) ————————————————————————
  // One divergence-free 3D field, sampled per fragment at world/scale scrolled
  // upward in time. `positionWorld` is the world-space vertex (the geometry is
  // world-space under an identity root), so a card's fragments sample a small
  // neighbourhood and neighbouring cards sample neighbouring cells — that is
  // what ties the flame into one flowing body. The CPU half (update()) samples
  // the identical field to displace each whole anchor.
  //
  // The sampling itself is the SHARED helper (curl-volume-node.ts): one
  // texture for every effect. The decoded vector is `rgb * 2 - 1`.
  const curl = curlVector(
    positionWorld as unknown as Tsl, uTime, CURL_SCALE, FLAME_CURL_RISE,
  ) as unknown as Tsl;
  // Atlas-cell-fraction shifts (bounded so a warped tap stays in the gutter).
  const flowUv = curl.x.mul(uFlow).mul(FLAME_FLOW_UV) as unknown as Tsl;
  const flowV = curl.y.mul(uFlow).mul(FLAME_FLOW_UV) as unknown as Tsl;
  // The procedural path has no neighbouring cell to bleed into, so it may push
  // harder in its own domain.
  const flowProc = uFlow.mul(FLAME_FLOW_PROC) as unknown as Tsl;

  // — PROCEDURAL FIRE (the atlas-absent fallback) ————————————————
  // A flame lick, not a blob: a tapering silhouette, a domain-warped noise
  // field advected upward, and the blackbody ramp with a hard extinction at
  // the cold end. The warp and the tip cut carry `ragged`; the advection
  // carries `rise`; per-card `seed` decorrelates the whole field. The curl
  // field warps the domain too, so the fallback flows like the atlas path.
  const warp = mx_fractal_noise_float(
    vec3(
      aUv.x.mul(3.1).add(seed.mul(19.7)).add(curl.x.mul(flowProc)) as N,
      aUv.y.mul(2.4).sub(uTime.mul(uRise).mul(0.55)).add(seed.mul(7.3))
        .add(curl.y.mul(flowProc)) as N,
      uTime.mul(0.4).add(seed.mul(3.1)).add(curl.z.mul(flowProc)) as N,
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
  // u comes per-card (the flipbook frame); v spans the cell content, which the
  // gutter-padded atlas records in atlasV0/atlasV1 (0..1 when there is no
  // gutter, so the padding never scales the flame down). The curl's xy warps
  // both axes by a bounded fraction of the cell; that slides the flame inside
  // its own frame without reading a neighbour (see FLAME_FLOW_UV).
  const vSpan = (uAtlasV1.sub(uAtlasV0)) as unknown as Tsl;
  const atlasUv = vec2(
    frameU0.add(aUv.x.mul(frameDu)).add(flowUv.mul(frameDu)) as N,
    uAtlasV0.add(aUv.y.mul(vSpan as N)).add(flowV.mul(vSpan as N)) as N,
  );
  const atlasTexNode = texture(atlasFallback, atlasUv as N) as unknown as Tsl & {
    value: THREE.Texture;
  };
  const atlasRgb = atlasTexNode.rgb as unknown as Tsl;
  const atlasA = atlasTexNode.a as unknown as Tsl;

  // — SOFT-PARTICLE DEPTH FADE (flame-polish task 1) ————————————————————
  // A card that INTERSECTS the body (or a wall, or the other body) is cut by
  // the depth test along a straight line, which reads as a rectangular edge.
  // Fade its alpha as the fragment approaches the scene surface behind it, so
  // the cut becomes a gradient instead of a seam.
  //
  // The fade itself is the SHARED helper (soft-fade.ts), which reads the SCENE
  // side from `viewportLinearDepth` — the depth TEXTURE — for every caller. We
  // pass only the CURRENT fragment's `linearDepth()`; the trap the wildfire
  // teardown documents (feeding the fragment depth to both sides, so
  // `(d - d) / fade = 0` renders the whole effect transparent black with no
  // error) is impossible to reach through the helper's API, and soft-fade's
  // own test guards the helper's source.
  const depthFade = softParticleFade(
    linearDepth() as never, uSoftFade as never,
  ) as unknown as Tsl;

  // — Combined: the atlas uniform mixes the two paths with no recompile. —
  // A two-rate breathe per card, the fire-light's own wobble shape
  // (burn-light.ts), so cards never pulse in step.
  const breathe = uTime.mul(7.3).add(seed.mul(31.0)).sin().mul(0.1)
    .add(uTime.mul(17.1).add(seed.mul(11.0)).sin().mul(0.05).add(0.85)) as unknown as Tsl;
  const rgb = mix(procRgb as N, atlasRgb as N, uAtlasOn as N)
    .mul(uGain as N).mul(heat as N).mul(breathe as N) as unknown as Tsl;
  const cov = mix(procA as N, atlasA as N, uAtlasOn as N)
    .mul(heat as N).mul(breathe as N).mul(depthFade as N) as unknown as Tsl;

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
  let atlasCellW = 31;    // FIRE01 content width, the gapless default
  let atlasPad = 0;       // transparent gutter per cell side (JSON `pad`)
  let atlasWidthPx = 31 * 8;
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
      // The curl flow, read once: the CPU displacement below and the shader's
      // UV warp share the field, so the whole card both moves and flows.
      const flow = u.flow.value as number;
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
        // The ground pile a corpse's fire collapses into (flame-polish task 5).
        // settle 0 leaves a live body exactly as tasks 1-4 tuned it; as it
        // rises the card anchors are pulled over the body's ground footprint and
        // down to the floor. Inlined (not cardSettleAnchor) to keep update()
        // allocation-free; cardSettleAnchor is the tested pure twin of this.
        const settle = clamp01(f.settle ?? 0);
        const groundY = f.groundY ?? 0;
        const pileCentre = f.anchors.torso;
        const pilePull = settle * FLAME_PILE_PULL;
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
          let wx = base[0]! + lx * cy + lz * sy;
          let wz = base[2]! - lx * sy + lz * cy;
          let wy = base[1]! + ly;
          // Boot reach (flame-polish task 3): on a kit-covered limb the boot
          // card's fixed offset lands at the boot's TOP, so lower the anchor
          // until the flame base covers the boot. 0 everywhere else.
          wy -= cardAnchorDrop(slot.name, { kitRadius: f.kitRadius ?? 0 });
          if (settle > 0) {
            wx += (pileCentre[0]! - wx) * pilePull;
            wz += (pileCentre[2]! - wz) * pilePull;
            wy += (groundY + FLAME_PILE_LIFT - wy) * settle;
          }
          // Shared curl displacement: the anchor moves with the divergence-free
          // field, so a limb's cards move together rather than independently.
          // Sampled exactly where the fragment shader samples it.
          if (flow > 0) {
            const cv = cardCurlOffset(
              curlData, [wx, wy, wz], time, flow,
            );
            wx += cv[0];
            wy += cv[1];
            wz += cv[2];
          }
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
          //
          // THE KIT STANDOFF (flame-polish task 3): the soldier's greaves are
          // a mesh shell ~0.14 m outside the SDF shin, so the fixed 0.09 m
          // bias sat INSIDE the armour and the shin/boot cards were depth-
          // tested away. Leg slots now take the per-character kit radius from
          // the frame (0 for the zombie), raising the bias to clear the shell.
          // Only leg slots — the upper body's engulfment is approved as-is.
          const kitRadius = slot.limb === 'legL' || slot.limb === 'legR'
            ? (f.kitRadius ?? 0) : 0;
          const bias = Math.max(
            FLAME_CARD_TOWARD_CAM * (0.6 + 0.4 * p.scale),
            cardStandoff(slot.name, { kitRadius }),
          );
          const ax = wx + ndx * bias + tx;
          const ay = wy;
          const az = wz + ndz * bias + tz;
          // Size: length x per-card scale, atlas aspect, stretched tall. A
          // settled pile card keeps its WIDTH but loses height, so the standing
          // column comes down into a low heap rather than a wall on its side.
          const h = len * p.scale * (1 - FLAME_PILE_SHRINK * settle);
          const w = (len * p.scale * aspect) / CARD_STRETCH;
          // Flipbook frame — the phase fraction spans the whole clip. The
          // cell's uv range is INSET by half a texel (and skips the atlas
          // builder's transparent gutter) so a boundary tap cannot land on the
          // neighbouring frame: that is the "card seam" rectangle.
          const frame = cardFrame(time, p.phase * clipSec, atlasFrames, FLAME_CARD_FPS);
          const cell = cardCellUv(frame, atlasFrames, atlasWidthPx, atlasPad, atlasCellW);
          const u0 = cell.u0;
          const du = cell.u1 - cell.u0;
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
    setSoftFade(metres) {
      u.softFade.value = Math.max(0, metres);
    },
    setFlow(flow) {
      u.flow.value = flow < 0 ? 0 : flow > 1 ? 1 : flow;
    },
    setAtlas(tex, frames, cellW, cellH, padTexels = 0) {
      atlasFrames = Math.max(1, frames);
      atlasCellW = cellW;
      atlasPad = Math.max(0, Math.round(padTexels));
      atlasWidthPx = (cellW + 2 * atlasPad) * atlasFrames;
      // The cell content sits inside the gutter: sample exactly that band so
      // the transparent padding neither shrinks nor lifts the flame.
      const atlasH = cellH + 2 * atlasPad;
      u.atlasV0.value = atlasPad / atlasH;
      u.atlasV1.value = (atlasPad + cellH) / atlasH;
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
      // The curl texture is the SHARED module singleton (curl-volume-node.ts);
      // this instance does not own it and must not dispose it.
      object.removeFromParent();
    },
  };
}
