// src/lab/sdf-zombie/webgpu/game-state-gibs.ts
//
// GIBS slice of the GameContext decomposition. State and handles for the whole
// gore path only: the piece-set / render-mode / bone-release boot seams
// (?gib / ?gibrender / ?gibcarvecells / ?gibcarvecell / ?gibspritelive /
// ?gibspriterest / ?gibspritesize / ?gibbones / ?gibstagger / ?giblaunch /
// ?gibwounds / ?gibtear / ?gibparts / ?gibbonemesh), the flying-gib shutter
// layer and its occluder switch, the sprite atlas, the offline-asset runtime
// and the two pending-release queues.
//
// Pure by construction: the only non-local imports are erased `import type`s,
// so this module carries no runtime Three.js/WebGPU dependency. Fields are
// plain and mutable — no getters, setters, `readonly` or `Object.freeze` —
// because the codemod moves the original assignments onto these fields and an
// accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (URL reads, `parseIntParam`, `new Set`,
// `createGibAssetRuntime`, the face-material factory, ...) get a type-correct
// placeholder in the factory; the codemod supplies the real value at the
// binding's original line. Every call still returns fresh containers.

import type { GibBoneRelease, GibPlan } from '../gib-parts';
import type { Vec3 } from '../types';
import type { BakedChunkMaterial } from './baked-chunks';
import type { ZombieActor } from './game-actor';
import type { GibAssetHeadFactory } from './gib-asset-head';
import type { GibAssetRuntime } from './gib-asset-runtime';
import type { GibShutterLayer } from './gib-shutter-layer';
import type { GibSpriteAtlas } from './gib-sprites';

/**
 * Placeholder for a binding whose real value is a live handle built at that
 * binding's original line. The field is non-null in game-main.ts, so the
 * placeholder must satisfy the declared type even though no code reads it
 * before the original assignment runs.
 */
function unbuilt<T>(): T {
  return null as unknown as T;
}

export interface GibsState {
  /** Flying-gib shutter/blur layer, or null before it is created. */
  shutter: GibShutterLayer | null;
  /** When true (default) the blood resolve also tests the blurred-gib depth. */
  occluderEnabled: boolean;
  /** Presentation identity across frames, keyed by owning list and id. */
  blurPrevKeys: Set<string>;
  /** `?gibbonemesh=0` opts out of drawing released bone chunks as tubes. */
  boneMesh: boolean;
  /** Blast-velocity scale (`?gibvel`, shipped 0.35). */
  velScale: number;
  /** Raw `?gib` value; drives `mode`. */
  param: string | null;
  /** Which piece set leaves a body: `parts` (default), `clusters` or `pieces`. */
  mode: 'pieces' | 'clusters' | 'parts';
  /** Raw `?gibrender` value; drives `renderMode`. */
  renderParam: string | null;
  /** How a piece is drawn: `assets` (default), `march`, `sprite` or `carve`. */
  renderMode: 'march' | 'sprite' | 'carve' | 'assets';
  /** `?gibcarvecells` subdivisions per anatomical part, or the shipped 1. */
  carveCells: number;
  /** `?gibcarvecell` carved slab size, or the shipped 0.01. */
  carveCellSize: number;
  /** `?gibspritelive` live sprite cap, or `GIB_SPRITE_TUNING.liveCap`. */
  spriteLiveCap: number;
  /** `?gibspriterest` resting sprite cap, or `GIB_SPRITE_TUNING.restCap`. */
  spriteRestCap: number;
  /** `?gibspritesize` sprite size scale, or `GIB_SPRITE_TUNING.sizeScale`. */
  spriteSizeScale: number;
  /** Raw `?gibbones` value; drives `bones`. */
  bonesParam: string | null;
  /** Which bone groups a gib releases: `core` (default), `all` or `off`. */
  bones: GibBoneRelease;
  /** Frames the staged release takes (`?gibstagger`, shipped 3). */
  staggerFrames: number;
  /** `?giblaunch` distribution: `notblood` (default) or `radial`. */
  launchMode: 'radial' | 'notblood';
  /** `?gibwounds=1` restores stamping the 16 wounds on a body about to gib. */
  wounds: boolean;
  /** Rupture window in seconds (`?gibtear`, shipped 0.2). */
  tearSec: number;
  /** The loaded sprite atlas, or null before `ensureGibAtlas` resolves. */
  atlas: GibSpriteAtlas | null;
  /** Which atlas the bench shows: `placeholder` (default) or the shipped `sheet`. */
  atlasSource: 'placeholder' | 'sheet';
  /** True once the missing-atlas warning has been logged, so it logs once. */
  spriteAtlasWarned: boolean;
  /** The one baked material for the face-carrying asset path, or null. */
  assetMaterial: BakedChunkMaterial | null;
  /** Builds ONE NEW per-instance face material per asset head. */
  assetHeadFactory: GibAssetHeadFactory;
  /** The offline gib-asset loader/pool runtime. */
  assetRuntime: GibAssetRuntime;
  /** Staggered launch impulses awaiting their delay, counted in drains. */
  pendingGibImpulses: { id: number; vel: Vec3; delay: number }[];
  /** Bodies in their rupture window, waiting to become pieces. */
  pendingGibs: {
    actor: ZombieActor; at: Vec3; falloff: number; plan: GibPlan;
    /** The tier chosen at SCHEDULE time; the release is locked to it. */
    tier: string;
    /** Chunk views this plan needs, held out of `gibBudget()` until release. */
    reserve: number;
  }[];
  /** Raw `?gibparts` value; `sprite`/`sheet` lay the sprite bench instead. */
  partsMode: string | null;
}

/** Every call returns a fresh object, the set and arrays included. */
export function makeGibsState(): GibsState {
  return {
    shutter: null,
    occluderEnabled: true,
    blurPrevKeys: new Set<string>(),
    boneMesh: false,
    velScale: 0,
    param: null,
    mode: 'parts',
    renderParam: null,
    renderMode: 'assets',
    carveCells: 0,
    carveCellSize: 0,
    spriteLiveCap: 0,
    spriteRestCap: 0,
    spriteSizeScale: 0,
    bonesParam: null,
    bones: 'core',
    staggerFrames: 0,
    launchMode: 'notblood',
    wounds: false,
    tearSec: 0,
    atlas: null,
    atlasSource: 'placeholder',
    spriteAtlasWarned: false,
    assetMaterial: null,
    assetHeadFactory: unbuilt<GibAssetHeadFactory>(),
    assetRuntime: unbuilt<GibAssetRuntime>(),
    pendingGibImpulses: [],
    pendingGibs: [],
    partsMode: null,
  };
}

/** Old `game-main.ts` binding name → path on the `gibs` slice. The codemod
 *  that rewrites game-main.ts routes every binding through this map. */
export const GIBS_BINDINGS = {
  gibShutter: 'gibs.shutter',
  gibOccluderEnabled: 'gibs.occluderEnabled',
  gibBlurPrevKeys: 'gibs.blurPrevKeys',
  gibBoneMesh: 'gibs.boneMesh',
  gibVelScale: 'gibs.velScale',
  gibParam: 'gibs.param',
  gibMode: 'gibs.mode',
  gibRenderParam: 'gibs.renderParam',
  gibRenderMode: 'gibs.renderMode',
  gibCarveCells: 'gibs.carveCells',
  gibCarveCellSize: 'gibs.carveCellSize',
  gibSpriteLiveCap: 'gibs.spriteLiveCap',
  gibSpriteRestCap: 'gibs.spriteRestCap',
  gibSpriteSizeScale: 'gibs.spriteSizeScale',
  gibBonesParam: 'gibs.bonesParam',
  gibBones: 'gibs.bones',
  gibStaggerFrames: 'gibs.staggerFrames',
  gibLaunchMode: 'gibs.launchMode',
  gibWounds: 'gibs.wounds',
  gibTearSec: 'gibs.tearSec',
  gibAtlas: 'gibs.atlas',
  gibAtlasSource: 'gibs.atlasSource',
  gibSpriteAtlasWarned: 'gibs.spriteAtlasWarned',
  gibAssetMaterial: 'gibs.assetMaterial',
  gibAssetHeadFactory: 'gibs.assetHeadFactory',
  gibAssetRuntime: 'gibs.assetRuntime',
  pendingGibImpulses: 'gibs.pendingGibImpulses',
  pendingGibs: 'gibs.pendingGibs',
  gibPartsMode: 'gibs.partsMode',
} as const;
