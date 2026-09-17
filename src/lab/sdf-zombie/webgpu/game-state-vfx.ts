// src/lab/sdf-zombie/webgpu/game-state-vfx.ts
//
// VFX slice of the GameContext decomposition. State and handles for the
// visual-effects systems only: the post-composite character overlay, the
// zombie face atlas/cache, the wound-cull flag and wound tuning, the
// tear/rupture shape, the explosion smoke/burst/tracer/ember sprites, the
// explosion light pool and live light list, the blast shader knobs
// (size/smoke/life/gain/plume/spread/mode and the optical distort strength),
// the DEV gore showcase and its baked-part materials, the sprite bench, the
// dynamite cook clock, and the whole bleed subsystem (sim, registry, view,
// gut ropes, clocks and per-actor splash ids).
//
// Pure by construction: the only non-local imports are erased `import type`s,
// so this module carries no runtime Three.js/WebGPU dependency. Fields are
// plain and mutable — no getters, setters, `readonly` or `Object.freeze` —
// because the codemod moves the original assignments onto these fields and an
// accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (URL reads, `parseFloatParam`, `new THREE.DataTexture`,
// `createBloodSim`, ...) get a type-correct placeholder in the factory; the
// codemod supplies the real value at the binding's original line. Containers
// are always freshly constructed so no two calls share one.

import type * as THREE from 'three/webgpu';
import type { BleedRegistry } from '../bleed-registry';
import type { BloodSim, Droplet } from '../blood-sim';
import type { Wound } from '../damage';
import type { GutChain } from '../entrails';
import type { FaceParams } from '../face';
import type { CookState } from '../fpv';
import type { FleshMaterial } from '../material';
import type { Vec3 } from '../types';
import type { BakedChunkMaterial } from './baked-chunks';
import type { BloodView } from './blood-view-gpu';
import type { ExplosionVfx } from './explosion-vfx';
import type { BurstLayer } from './fpv-view';
import type { ZombieActor } from './game-actor';
import type { SpritePieceSet } from './gib-sprite-pieces';
import type { WoundTuningValues } from './wound-panel';

/** Type of the object `createCharacterEffects()` returns (no exported name). */
type CharacterEffects = ReturnType<typeof import('./character-effects').createCharacterEffects>;

/** The page-level rupture-window shape pushed to every actor. gib-tear.ts's
 *  `TearTuning` is a different, actor-local set; this shape is not exported. */
interface TearShape {
  amplitudeM: number;
  jiggleAmp: number;
  seamM: number;
  boneLag: number;
  headDamp: number;
  sloughOutM: number;
  sloughSagM: number;
  sloughStretchM: number;
  headFollow: number;
  neckGapM: number;
  recoilM: number;
}

export interface VfxState {
  /** DEV-only `?bounded-wounds` gate for the bounded-wound preview. */
  boundedWoundPreview: boolean;
  /** Pool of blast point lights, kept permanently visible (perf contract). */
  explosionLightPool: THREE.PointLight[];
  /** Carried-lamp beam tuning: peak gain, shoulder and key floor. */
  beamTuning: { gain: number; shoulder: number; keyFloor: number };
  /** Post-composite character overlay (muzzle flashes); codemod supplies it. */
  characterEffects: CharacterEffects | null;
  /** The zombie's compiled face params. */
  face: FaceParams | null;
  /** The zombie's flesh material (compiled palette, else preset fallback). */
  flesh: FleshMaterial | null;
  /** The zombie's flat face texture. */
  faceTex: THREE.Texture | null;
  /** Face-atlas sub-rect (u0, v0, u1, v1) for the zombie sheet. */
  faceAtlas: THREE.Vector4 | null;
  /** Face textures BY CHARACTER, loaded once and shared by every body. */
  faceCache: Map<string, { tex: THREE.Texture; atlas: THREE.Vector4; mean: number }>;
  /** Requested state of the wound union-reach cull (ships ON). */
  woundCullRequested: boolean;
  /** The wound panel's live tuning values. */
  woundTuning: WoundTuningValues | null;
  /** Reusable smoke puff meshes with their ages, velocities and roll. */
  smokePuffs: { mesh: THREE.Mesh; age: number; vel: THREE.Vector3; roll: number }[];
  /** Tracer streak sprite texture. */
  tracerTex: THREE.DataTexture | null;
  /** Head-on ember sprite texture. */
  emberTex: THREE.DataTexture | null;
  /** Scale applied to the tear/slough lengths (`?tearslough`). */
  sloughScale: number;
  /** The rupture window's page-level shape. */
  tearShape: TearShape | null;
  /** Optical blast-distort strength (`?bdstrength`). */
  blastDistortStrength: number;
  /** Explosion visual-size multiplier (`?fxsize`). */
  size: number;
  /** Blast area-of-effect radius scale (`?aoesize`). */
  aoeRadiusScale: number;
  /** Launch floor at the AOE edge (`?edgekick`). */
  aoeLaunchFloor: number;
  /** Smoke-density multiplier (`?fxsmoke`). */
  smoke: number;
  /** Explosion lifetime multiplier (`?fxlife`). */
  life: number;
  /** Explosion colour/gain multiplier (`?fxgain`). */
  gain: number;
  /** Plume shape A/B: 1 = mushroom, 0 = round fireball (`?fxplume`). */
  plume: number;
  /** DEV gore showcase group; null until `?goreparts=1` builds it. */
  goreShowcase: THREE.Group | null;
  /** The showcase's baked chunk material. */
  gorePartMat: BakedChunkMaterial | null;
  /** (detailAmp, bumpAmp, bloodAmp, noiseScale) for the parts' detail layer. */
  gorePartDetail: THREE.Vector4 | null;
  /** `look` for the gore materials. */
  goreLookCfg: THREE.Vector4 | null;
  /** (burnAmp, wetGain, bloodDark, stainScale) — the stain half. */
  gorePartStain: THREE.Vector4 | null;
  /** `?goreparts=1` gate for the DEV gore showcase. */
  goreShowcaseOn: boolean;
  /** The sprite bench's scene group. */
  spriteBenchGroup: THREE.Group | null;
  /** The sprite bench's sprites. */
  spriteBenchSprites: THREE.Mesh[];
  /** Sprite-piece set; empty and unused unless `?gibrender=sprite` fills it. */
  spritePieces: SpritePieceSet | null;
  /** Cook clock and phase for the held dynamite. */
  cook: CookState;
  /** Blast light reach, the soft room-fill component (`?fxspread`). */
  spread: number;
  /** Live explosions lighting something, newest last. Bounded by the pool. */
  explosionLights: { pos: Vec3; age: number }[];
  /** Procedural flash-sprite texture for the burst. */
  burstTex: THREE.DataTexture | null;
  /** Procedural smoke-sprite texture for the burst. */
  smokeBurstTex: THREE.DataTexture | null;
  /** `?explosionfx` mode: 'procedural' (default), 'atlas' or 'standin'. */
  mode: string | null;
  /** Procedural explosion vfx handle, or null in atlas/standin mode. */
  explosionVfx: ExplosionVfx | null;
  /** Atlas burst layer handle, or null outside `?explosionfx=atlas`. */
  burstLayer: BurstLayer | null;
  /** The bleed particle simulation. */
  bloodSim: BloodSim | null;
  /** The bleed registry (per-wound emitters and trails). */
  bleed: BleedRegistry | null;
  /** Stable per-wound emitter-stream ids for blood-connections provenance. */
  woundStreamIds: WeakMap<Wound, number>;
  /** The bleed render view (droplets, ribbons, mist). */
  bloodView: BloodView | null;
  /** `setBleed(false)` freezes the whole bleed subsystem. */
  bleedEnabled: boolean;
  /** Gut ropes, at most one per body. */
  gutRopes: Map<number, { chain: GutChain; wound: Wound; droplets: Droplet[] }>;
  /** Bleed's own sim clock — an accumulator, never wall time. */
  bleedClock: number;
  /** Sim-frame of each actor's last impact splash, for rate limiting. */
  lastSplashShot: WeakMap<ZombieActor, number>;
}

/** Every call returns a fresh object, nested arrays, maps and weak maps included. */
export function makeVfxState(): VfxState {
  return {
    boundedWoundPreview: false,
    explosionLightPool: [],
    beamTuning: { gain: 4, shoulder: 0.35, keyFloor: 0 },
    characterEffects: null,
    face: null,
    flesh: null,
    faceTex: null,
    faceAtlas: null,
    faceCache: new Map<string, { tex: THREE.Texture; atlas: THREE.Vector4; mean: number }>(),
    woundCullRequested: true,
    woundTuning: null,
    smokePuffs: [],
    tracerTex: null,
    emberTex: null,
    sloughScale: 0,
    tearShape: null,
    blastDistortStrength: 0,
    size: 0,
    aoeRadiusScale: 0,
    aoeLaunchFloor: 0,
    smoke: 0,
    life: 0,
    gain: 0,
    plume: 0,
    goreShowcase: null,
    gorePartMat: null,
    gorePartDetail: null,
    goreLookCfg: null,
    gorePartStain: null,
    goreShowcaseOn: false,
    spriteBenchGroup: null,
    spriteBenchSprites: [],
    spritePieces: null,
    cook: { phase: 'idle', phaseAt: 0, cookStart: 0 },
    spread: 0,
    explosionLights: [],
    burstTex: null,
    smokeBurstTex: null,
    mode: null,
    explosionVfx: null,
    burstLayer: null,
    bloodSim: null,
    bleed: null,
    woundStreamIds: new WeakMap<Wound, number>(),
    bloodView: null,
    bleedEnabled: true,
    gutRopes: new Map<number, { chain: GutChain; wound: Wound; droplets: Droplet[] }>(),
    bleedClock: 0,
    lastSplashShot: new WeakMap<ZombieActor, number>(),
  };
}

/** Old `game-main.ts` binding name → path on the `vfx` slice. */
export const VFX_BINDINGS = {
  boundedWoundPreview: 'vfx.boundedWoundPreview',
  explosionLightPool: 'vfx.explosionLightPool',
  beamTuning: 'vfx.beamTuning',
  characterEffects: 'vfx.characterEffects',
  face: 'vfx.face',
  flesh: 'vfx.flesh',
  faceTex: 'vfx.faceTex',
  faceAtlas: 'vfx.faceAtlas',
  faceCache: 'vfx.faceCache',
  woundCullRequested: 'vfx.woundCullRequested',
  woundTuning: 'vfx.woundTuning',
  smokePuffs: 'vfx.smokePuffs',
  tracerTex: 'vfx.tracerTex',
  emberTex: 'vfx.emberTex',
  sloughScale: 'vfx.sloughScale',
  tearShape: 'vfx.tearShape',
  blastDistortStrength: 'vfx.blastDistortStrength',
  fxSize: 'vfx.size',
  aoeRadiusScale: 'vfx.aoeRadiusScale',
  aoeLaunchFloor: 'vfx.aoeLaunchFloor',
  fxSmoke: 'vfx.smoke',
  fxLife: 'vfx.life',
  fxGain: 'vfx.gain',
  fxPlume: 'vfx.plume',
  goreShowcase: 'vfx.goreShowcase',
  gorePartMat: 'vfx.gorePartMat',
  gorePartDetail: 'vfx.gorePartDetail',
  goreLookCfg: 'vfx.goreLookCfg',
  gorePartStain: 'vfx.gorePartStain',
  goreShowcaseOn: 'vfx.goreShowcaseOn',
  spriteBenchGroup: 'vfx.spriteBenchGroup',
  spriteBenchSprites: 'vfx.spriteBenchSprites',
  spritePieces: 'vfx.spritePieces',
  cook: 'vfx.cook',
  fxSpread: 'vfx.spread',
  explosionLights: 'vfx.explosionLights',
  burstTex: 'vfx.burstTex',
  smokeBurstTex: 'vfx.smokeBurstTex',
  fxMode: 'vfx.mode',
  explosionVfx: 'vfx.explosionVfx',
  burstLayer: 'vfx.burstLayer',
  bloodSim: 'vfx.bloodSim',
  bleed: 'vfx.bleed',
  woundStreamIds: 'vfx.woundStreamIds',
  bloodView: 'vfx.bloodView',
  bleedEnabled: 'vfx.bleedEnabled',
  gutRopes: 'vfx.gutRopes',
  bleedClock: 'vfx.bleedClock',
  lastSplashShot: 'vfx.lastSplashShot',
} as const;
