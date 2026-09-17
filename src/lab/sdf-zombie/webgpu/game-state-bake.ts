// src/lab/sdf-zombie/webgpu/game-state-bake.ts
//
// BAKE slice of the GameContext decomposition — the settled-chunk bake layer:
// the `?chunkbake` / chunk-detail seams, the shared chunk material and its
// view ring, the worker job slot, the carved-gib library and the dynamite
// bundle prop pool that rides the same boot block.
//
// Shape mirrors game-state-probes.ts (and game-weapon-slots.ts before it):
// interface + factory + a binding map the codemod consumes. The fields are
// PLAIN MUTABLE values — no getters, setters, `readonly` or freezing — because
// the codemod rewrites `let x = y` into `ctx.bake.x = y` in place, and any
// accessor would change evaluation timing around the pixel gate.
//
// Computed initializers (URL reads, `parseIntParam`, `new Worker`,
// `createSharedChunkGpuMaterial`, ...) get a type-correct placeholder here; the
// in-place assignment at the binding's original line supplies the real value
// before any code reads it. The two `BakedChunk` / `LiveChunk` / `LiveBundle`
// element shapes are declared here because game-main.ts declares them INSIDE
// `main()` and does not export them, and the codemod needs the field to stay
// structurally usable after the rewrite.

import * as THREE from 'three';
import type { FlightState } from '../dynamite-flight';
import type { Chunk } from '../gib-chunks';
import type { Vec3 } from '../types';
import type { BakedChunkMaterial } from './baked-chunks';
import type { ChunkBakeData } from './chunk-bake-geometry';
import type { CarvedLibrary } from './gib-carve';
import type { StickProp } from './fpv-view';
import type { ChunkGpuView, MarchUniforms, SharedChunkGpuMaterial } from './zombie-gpu';

/** Type of the object `createChunkBakeJobs()` returns (no exported name). */
type ChunkBakeJobs = ReturnType<typeof import('./chunk-bake-jobs').createChunkBakeJobs>;

/** `game-main.ts`'s local `ChunkTemplate`: a chunk's source body uniforms. */
interface ChunkTemplate {
  uniforms: MarchUniforms;
  volumeTexture: THREE.Texture;
}

/** `game-main.ts`'s local `BakedChunk`: one settled piece in the bake ring. */
interface BakedChunk {
  id: number;
  mesh: THREE.Mesh;
  view: ChunkGpuView;
  state: Chunk;
  faceMaterial?: BakedChunkMaterial;
  centre: Vec3;
  radius: number;
  bakeMs: number;
  template: ChunkTemplate;
}

/** `game-main.ts`'s inline `liveChunks` element. */
interface LiveChunk {
  id: number;
  state: Chunk;
  view: ChunkGpuView;
  template: ChunkTemplate;
  kind: 'limb' | 'gob' | 'bone';
  boneOnly: boolean;
}

/** `game-main.ts`'s local `LiveBundle`: a dynamite stick in flight. */
interface LiveBundle {
  state: FlightState;
  prop: StickProp | null;
}

/**
 * Placeholder for a binding whose real value is a live GPU/worker object built
 * at that binding's original line. The field is non-null in game-main.ts, so
 * the placeholder value must satisfy the declared type even though no code
 * reads it before the original assignment runs.
 */
function unbuilt<T>(): T {
  return null as unknown as T;
}

export interface BakeState {
  /** `?chunkbake=0` (or the compiled-off seam) disables future settles. */
  enabled: boolean;
  /** Settled pieces currently in the bake ring. */
  chunks: BakedChunk[];
  /** Diagnostic: draw the retained same-pose reference instead of the bake. */
  reference: boolean;
  /** ONE shared material for every baked chunk, or null before it is built. */
  mat: BakedChunkMaterial | null;
  /** Per-material seeder run when a baked material is created. */
  seed: ((m: BakedChunkMaterial) => void) | null;
  /** Completed bakes this session, for the diagnostics panel. */
  totalBakes: number;
  /** Wall time of the last completed bake, in milliseconds. */
  lastBakeMs: number;
  /** Bake timing breakdown of the last completed bake, or null. */
  lastBakeInfo: Record<string, number> | null;
  /** Upper bound on the bake ring; `?maxchunks` or the shipped 64. */
  maxChunks: number;
  /** `?chunkdetail` live override, or null to follow the actor's own level. */
  detailOverride: number | null;
  /** Live twin of CHUNK_DETAIL_FREQ (grain coarseness). */
  detailFreq: number;
  /** Live twin of CHUNK_DETAIL_ALBEDO (colour vs relief share). */
  detailAlbedo: number;
  /** The one shared chunk GPU material every view draws through. */
  material: SharedChunkGpuMaterial;
  /** Bounded ring of reusable chunk views. */
  views: ChunkGpuView[];
  /** Views not currently attached to a baked chunk. */
  spareViews: ChunkGpuView[];
  /** The live pieces plus their spawn descriptors (bone census reads `kind`). */
  liveChunks: LiveChunk[];
  /** The single-slot chunk bake worker job owner. */
  jobs: ChunkBakeJobs;
  /** Carved-gib library, or null before anything has been carved. */
  carvedLibrary: CarvedLibrary | null;
  /** Material for the carved library's pieces, or null. */
  carvedMaterial: BakedChunkMaterial | null;
  /** Time spent building the current carved library, in milliseconds. */
  carvedBuildMs: number;
  /** True once the carve-warning has been logged, so it is logged once. */
  carvedWarned: boolean;
  /** Field inputs queued for the next settle bake, or null when idle. */
  input: ChunkBakeData | null;
  /** Wall time of the last chunk swap, in milliseconds. */
  lastSwapMs: number;
  /** Wall time of the last bake request, in milliseconds. */
  lastRequestMs: number;
  /** Frame the current bake was submitted on, or -1 when none is pending. */
  submitFrame: number;
  /** Frame the last completed swap landed on, or -1 before the first. */
  lastSwapFrame: number;
  /** True while the debug key hides every chunk. */
  hidden: boolean;
  /** Monotonic chunk id allocator. */
  nextId: number;
  /** Dynamite prop pool; the held one is parented to `bundleRig`. */
  bundleProps: StickProp[];
  /** Rig the held bundle rides (inside aimRig, so it takes the free-aim lean). */
  bundleRig: THREE.Group;
  /** Set once the bundle pool actually produced a prop. */
  bundleReady: boolean;
  /** Bundles not in hand and not in flight. */
  spareBundles: StickProp[];
  /** Bundles currently in the air. */
  liveBundles: LiveBundle[];
}

/** Every call returns a fresh object, arrays and rig included. */
export function makeBakeState(): BakeState {
  return {
    enabled: false,
    chunks: [],
    reference: false,
    mat: null,
    seed: null,
    totalBakes: 0,
    lastBakeMs: 0,
    lastBakeInfo: null,
    maxChunks: 0,
    detailOverride: null,
    detailFreq: 0,
    detailAlbedo: 0,
    material: unbuilt<SharedChunkGpuMaterial>(),
    views: [],
    spareViews: [],
    liveChunks: [],
    jobs: unbuilt<ChunkBakeJobs>(),
    carvedLibrary: null,
    carvedMaterial: null,
    carvedBuildMs: 0,
    carvedWarned: false,
    input: null,
    lastSwapMs: 0,
    lastRequestMs: 0,
    submitFrame: -1,
    lastSwapFrame: -1,
    hidden: false,
    nextId: 1,
    bundleProps: [],
    bundleRig: new THREE.Group(),
    bundleReady: false,
    spareBundles: [],
    liveBundles: [],
  };
}

/** Old `game-main.ts` binding name → path on the `bake` slice. */
export const BAKE_BINDINGS = {
  chunkBakeEnabled: 'bake.enabled',
  bakedChunks: 'bake.chunks',
  bakedChunkReference: 'bake.reference',
  bakedChunkMat: 'bake.mat',
  bakedChunkSeed: 'bake.seed',
  totalBakes: 'bake.totalBakes',
  lastBakeMs: 'bake.lastBakeMs',
  lastBakeInfo: 'bake.lastBakeInfo',
  maxChunks: 'bake.maxChunks',
  chunkDetailOverride: 'bake.detailOverride',
  chunkDetailFreq: 'bake.detailFreq',
  chunkDetailAlbedo: 'bake.detailAlbedo',
  chunkMaterial: 'bake.material',
  chunkViews: 'bake.views',
  spareChunkViews: 'bake.spareViews',
  liveChunks: 'bake.liveChunks',
  chunkBakeJobs: 'bake.jobs',
  carvedLibrary: 'bake.carvedLibrary',
  carvedMaterial: 'bake.carvedMaterial',
  carvedBuildMs: 'bake.carvedBuildMs',
  carvedWarned: 'bake.carvedWarned',
  chunkBakeInput: 'bake.input',
  lastBakeSwapMs: 'bake.lastSwapMs',
  lastBakeRequestMs: 'bake.lastRequestMs',
  bakeSubmitFrame: 'bake.submitFrame',
  lastBakeSwapFrame: 'bake.lastSwapFrame',
  chunksHidden: 'bake.hidden',
  nextChunkId: 'bake.nextId',
  bundleProps: 'bake.bundleProps',
  bundleRig: 'bake.bundleRig',
  bundleReady: 'bake.bundleReady',
  spareBundles: 'bake.spareBundles',
  liveBundles: 'bake.liveBundles',
} as const;
