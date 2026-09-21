// src/lab/sdf-zombie/webgpu/game-state-render.ts
//
// RENDER slice of the GameContext decomposition — the per-frame draw stack's
// own state: the actor cull/refine band and its lighting tail, the SDF march
// layer and its scale, the post-AA composer, the occluder hull, the bone
// instancer and the three skeleton paths (procedural / mesh / volume), the
// adaptive-resolution ladder, the upscale A/B rig and the two diagnostics
// (the texture round-trip probe and the depth-probe sprites).
//
// Pure by construction: the only non-local imports are erased `import type`s,
// so this module carries no runtime Three.js/WebGPU dependency. Fields are
// plain and mutable — no getters, setters, `readonly` or `Object.freeze` —
// because the codemod moves the original assignments onto these fields and an
// accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (`createSdfLayer`, `createPostAa`,
// `initialAdaptiveState`, `createOccluderHull`, `createBoneInstancer`,
// `resolveSkeletonMode`, the URL reads, ...) get a type-correct placeholder in
// the factory; the codemod supplies the real value at the binding's original
// line. Every call still hands out fresh containers.

import type * as THREE from 'three/webgpu';
import type { wgslFn } from 'three/tsl';
import type { AdaptiveState } from '../adaptive-scale';
import type { BuildResult } from '../build-body';
import type { ZombieActor } from './game-actor';
import type { BoneInstancer } from './bone-instancer';
import type { OccluderHull } from './occluder-hull';
import type { PostAa } from './post-aa';
import type { FieldStyle, SdfLayer } from './sdf-layer';
import type { BoneFieldSource, SkeletonMode } from './skeleton-spike/contract';
import type { SegmentMeshCache } from './skeleton-spike/mesh';
import type { SegmentMeshRenderer } from './skeleton-spike/mesh-renderer';
import type { buildSegmentAtlas, SegmentVolumeCache } from './skeleton-spike/volume';
import type { createSegmentAtlasTexture, SegmentVolumeBinding } from './skeleton-spike/volume-gpu';
import type { UpscaleConfig, UpscaleModel } from './upscale/upscale-model';
import type { RefineTail } from './zombie-gpu';

/** The lazily built texture round-trip probe rig (a diagnostic of the
 *  2026-09-04 close-up task; nothing outside `texRoundTrip` touches it). */
interface TexProbeRig {
  scene: THREE.Scene;
  quad: THREE.Mesh;
  ortho: THREE.OrthographicCamera;
  writes: {
    uniform: { m: THREE.MeshBasicNodeMaterial; u: { value: number } };
    dist: { m: THREE.MeshBasicNodeMaterial };
    'dist-small': { m: THREE.MeshBasicNodeMaterial };
  };
  fetchNode: ReturnType<typeof wgslFn>;
  targets: Record<string, [THREE.RenderTarget, THREE.RenderTarget]>;
}

/** One body's built rig plus its named bone-field sources (mesh mode). */
interface SkeletonSourceEntry {
  body: BuildResult;
  name: string;
  sources: BoneFieldSource[];
}

/** One body's volume key and its bound shared atlas (volume mode). */
interface SkeletonVolumeEntry {
  body: BuildResult;
  name: string;
  sources: BoneFieldSource[];
  key: string;
  binding: SegmentVolumeBinding;
}

/** A per-key shared volume atlas with its reference count (`game-main.ts`
 *  declares this inline at the `sharedVolumeAtlases` binding). */
type SharedVolumeAtlas = ReturnType<typeof buildSegmentAtlas> & {
  texture: ReturnType<typeof createSegmentAtlasTexture>;
  refs: number;
};

/** The upscale A/B rig: current mode, resolved config/model and the field
 *  style saved while the A/B is active. */
interface UpscaleAb {
  mode: 'native' | 'nearest' | 'model';
  config: UpscaleConfig | null;
  model: UpscaleModel | null;
  modelName: string | null;
  fieldStyle: FieldStyle;
}

export interface RenderState {
  /** Master switch for the actor distance cull. */
  actorCullEnabled: boolean;
  /** Distance band the refine twins are drawn in (with edge hysteresis). */
  refineBand: { near: number; far: number; hysteresis: number };
  /** Lighting tail every refine twin should use. */
  refineTailWanted: RefineTail;
  /** Bodies whose refine twin was drawn this frame (reset each cull pass). */
  refinedBodies: number;
  /** Actors that survived the last cull pass. */
  visibleActors: ZombieActor[];
  /** Actors that need PER-ACTOR VISUAL upkeep this tick (visual-actor-cull
   *  plan): skeleton segment meshes, both hulls, wound exclusions, view
   *  time / head shape. Recomputed once per tick in `tick` — EMPTY only
   *  before the first tick, never as a "cull everything" signal. Simulation
   *  is never gated on this. */
  visualActors: Set<ZombieActor>;
  /** Master switch for the visual-actor cull (`?visualcull=0` or
   *  `setVisualCull(false)` restores the pre-cull behaviour exactly). */
  visualCullEnabled: boolean;
  /** Post-AA composer for the presented frame. */
  postAa: PostAa;
  /** True when the run-5b refine head is on (`?refine` / `?graphics=high`). */
  refineWanted: boolean;
  /** The SDF march layer, and the post-AA sink for its composite. */
  sdfLayer: SdfLayer;
  /** SDF pass scale relative to the capped buffer; 1.0 = 1:1 (default). */
  sdfScale: number;
  /** Texture round-trip probe rig, or null until `texRoundTrip` builds it. */
  texProbe: TexProbeRig | null;
  /** Adaptive-resolution ladder armed (`setAdaptive(true)` re-arms it). */
  adaptiveEnabled: boolean;
  /** Frame budget (ms) the adaptive ladder aims at. */
  adaptiveBudgetMs: number;
  /** Adaptive ladder's current rung and probe bookkeeping. */
  adaptiveState: AdaptiveState;
  /** Rolling window of recent frame times the ladder judges. */
  adaptiveFrames: number[];
  /** True once the mesh-sync warning has been logged (log-once flag). */
  meshSyncMarked: boolean;
  /** The inflated hull for the occluder shadow twin. */
  occluderHull: OccluderHull;
  /** Instanced bone-tube renderer shared by every skeleton. */
  boneInstancer: BoneInstancer;
  /** Whether the gib bone pieces are drawn as mesh tubes. */
  boneMesh: boolean;
  /** Skeleton representation for forward bodies (`?skeleton=`). */
  skeletonMode: SkeletonMode;
  /** Mesh segment cache, or null outside mesh mode. */
  segMeshCache: SegmentMeshCache | null;
  /** Mesh skeleton renderer, or null outside mesh mode. */
  segMeshRenderer: SegmentMeshRenderer | null;
  /** Per-actor built body and named bone sources (mesh mode). */
  skeletonSources: Map<ZombieActor, SkeletonSourceEntry>;
  /** Volume segment cache, or null outside volume mode. */
  segVolumeCache: SegmentVolumeCache | null;
  /** Shared per-key volume atlases with reference counts (volume mode). */
  sharedVolumeAtlases: Map<string, SharedVolumeAtlas>;
  /** Per-actor volume key/binding (volume mode). */
  skeletonVolumes: Map<ZombieActor, SkeletonVolumeEntry>;
  /** True while bone culling is on (off vs any cull). */
  boneCull: boolean;
  /** Three-way bone cull state (bone-segment spheres). */
  boneCullMode: 'off' | 'cluster' | 'segment';
  /** Upscale A/B rig: mode, config/model, model name and saved field style. */
  upscaleAb: UpscaleAb;
  /** The bottom-left A/B label element, or null until created. */
  upscaleAbLabel: HTMLDivElement | null;
  /** Headless seam: hull-hole exclusions on/off (ships ON). */
  hullExclusionsEnabled: boolean;
  /** Headless seam: occluder hull desired (ships ON). */
  occluderDesired: boolean;
  /** Panel-set bone ratio override, or null to keep the authored ratio. */
  boneRatioOverride: number | null;
  /** Whether BONE pieces are drawn — see `setBonePiecesVisible`. */
  bonesVisible: boolean;
  /** Whether the hulls have been built for the CURRENT frozen stretch. */
  frozenHullBuilt: boolean;
  /** Sprites that composite depth-tested over the presented frame. */
  depthProbes: THREE.Sprite[];
}

/** Placeholder for a binding whose real value is a live handle built at that
 *  binding's original line. The field is non-null in `game-main.ts`, so the
 *  placeholder must satisfy the declared type even though no code reads it
 *  before the original assignment runs. */
function unbuilt<T>(): T {
  return null as unknown as T;
}

/** Every call returns a fresh object, nested arrays/objects/maps included. */
export function makeRenderState(): RenderState {
  return {
    actorCullEnabled: true,
    refineBand: { near: 1.5, far: 3.5, hysteresis: 0.25 },
    refineTailWanted: 'slim',
    refinedBodies: 0,
    visibleActors: [],
    visualActors: new Set<ZombieActor>(),
    visualCullEnabled: true,
    postAa: unbuilt<PostAa>(),
    refineWanted: false,
    sdfLayer: unbuilt<SdfLayer>(),
    sdfScale: 1.0,
    texProbe: null,
    adaptiveEnabled: false,
    adaptiveBudgetMs: 1000 / 30,
    adaptiveState: unbuilt<AdaptiveState>(),
    adaptiveFrames: [],
    meshSyncMarked: false,
    occluderHull: unbuilt<OccluderHull>(),
    boneInstancer: unbuilt<BoneInstancer>(),
    boneMesh: false,
    skeletonMode: 'procedural',
    segMeshCache: null,
    segMeshRenderer: null,
    skeletonSources: new Map<ZombieActor, SkeletonSourceEntry>(),
    segVolumeCache: null,
    sharedVolumeAtlases: new Map<string, SharedVolumeAtlas>(),
    skeletonVolumes: new Map<ZombieActor, SkeletonVolumeEntry>(),
    boneCull: false,
    boneCullMode: 'off',
    upscaleAb: { mode: 'model', config: null, model: null, modelName: null, fieldStyle: 'off' },
    upscaleAbLabel: null,
    hullExclusionsEnabled: true,
    occluderDesired: true,
    boneRatioOverride: null,
    bonesVisible: true,
    frozenHullBuilt: false,
    depthProbes: [],
  };
}

/** Old `game-main.ts` binding name → path on the `render` slice. */
export const RENDER_BINDINGS = {
  actorCullEnabled: 'render.actorCullEnabled',
  refineBand: 'render.refineBand',
  refineTailWanted: 'render.refineTailWanted',
  refinedBodies: 'render.refinedBodies',
  visibleActors: 'render.visibleActors',
  postAa: 'render.postAa',
  refineWanted: 'render.refineWanted',
  sdfLayer: 'render.sdfLayer',
  sdfScale: 'render.sdfScale',
  texProbe: 'render.texProbe',
  adaptiveEnabled: 'render.adaptiveEnabled',
  adaptiveBudgetMs: 'render.adaptiveBudgetMs',
  adaptiveState: 'render.adaptiveState',
  adaptiveFrames: 'render.adaptiveFrames',
  meshSyncMarked: 'render.meshSyncMarked',
  occluderHull: 'render.occluderHull',
  boneInstancer: 'render.boneInstancer',
  boneMesh: 'render.boneMesh',
  skeletonMode: 'render.skeletonMode',
  segMeshCache: 'render.segMeshCache',
  segMeshRenderer: 'render.segMeshRenderer',
  skeletonSources: 'render.skeletonSources',
  segVolumeCache: 'render.segVolumeCache',
  sharedVolumeAtlases: 'render.sharedVolumeAtlases',
  skeletonVolumes: 'render.skeletonVolumes',
  boneCull: 'render.boneCull',
  boneCullMode: 'render.boneCullMode',
  upscaleAb: 'render.upscaleAb',
  upscaleAbLabel: 'render.upscaleAbLabel',
  hullExclusionsEnabled: 'render.hullExclusionsEnabled',
  occluderDesired: 'render.occluderDesired',
  boneRatioOverride: 'render.boneRatioOverride',
  bonesVisible: 'render.bonesVisible',
  frozenHullBuilt: 'render.frozenHullBuilt',
  depthProbes: 'render.depthProbes',
} as const;
