// src/lab/sdf-zombie/webgpu/gib-asset-runtime.ts
//
// THE RUNTIME HALF OF THE OFFLINE GIB ASSETS (2026-09-16 offline-gib-assets
// task 2): load once per archetype, share the immutable rest geometry and
// material, and hand out per-instance DEFORMED geometries from a pool.
//
// WHY A POOL AND NOT A SHARED MESH. Two pieces of the same body part can be in
// flight at once (two zombies gibbed by the same bundle), and each must follow
// ITS OWN pose/slough. A shared mutated geometry would make the second instance
// overwrite the first — the exact "two simultaneous instances do not mutate
// shared assets" contract. So the REST geometry and the decoded typed arrays are
// immutable and shared; the positions/normals are per-instance and returned to
// a per-part free list when a piece is recycled (the sprite-piece path's
// `onDetach` is how a dropped piece gives its buffers back).
//
// NO EXTRACTION, NO REBUILD. Building a library here wraps decoded arrays in
// BufferAttributes — there is no `bakeChunkGeometry`, no worker, no surface
// nets. That is what "offline meshes remove runtime extraction" means.
import * as THREE from 'three/webgpu';
import type { DecodedGibPiece, GibAssetPiece } from './gib-asset';
import {
  deformGibAssetPiece, gibAssetPosedRows, type GibAssetPosedRow,
} from './gib-asset-deform';
import {
  GibAssetLoadError, loadGibAssetSet,
  type GibAssetFallbackReason, type GibAssetLoadedSet, type LoadGibAssetOptions,
} from './gib-asset-loader';
import {
  GibAssetHeadRegistry,
  type GibAssetHeadCounters, type GibAssetHeadFactory, type GibAssetHeadLocal,
  type GibAssetHeadResource,
} from './gib-asset-head';
import type { Primitive, Vec3 } from '../types';

/** The three albedo branches Task 1 records. `goreKind` is synthesised from
 *  this so the shared procedural-detail material can branch without the asset
 *  carrying a channel the off-line baker never wrote. */
const GORE_KIND: Record<'flesh' | 'bone' | 'organ', number> = { flesh: 0, bone: 1, organ: 2 };

export interface GibAssetLibraryPiece {
  part: string;
  limb: string;
  kind: 'limb' | 'gob' | 'bone';
  material: 'flesh' | 'bone' | 'organ';
  doc: GibAssetPiece;
  decoded: DecodedGibPiece;
  /** SHARED, immutable rest geometry (never written after build). */
  rest: THREE.BufferGeometry;
  face?: GibAssetPiece['face'];
}

export interface GibAssetMaterialFactory {
  /** One shared material for every piece; the procedural detail layer branches
   *  on the per-vertex `goreKind` the runtime adds. */
  create(): THREE.Material;
}

export interface GibAssetLibrary {
  archetype: string;
  fingerprint: string;
  pieces: GibAssetLibraryPiece[];
  byPart: Map<string, GibAssetLibraryPiece>;
  material: THREE.Material;
  bytes: { json: number; bin: number };
  verts: number;
  tris: number;
  builtMs: number;
  dispose(): void;
}

/** Build the shared per-archetype library from a loaded set. No extraction. */
export function buildGibAssetLibrary(
  set: GibAssetLoadedSet, material: THREE.Material,
): GibAssetLibrary {
  const t0 = performance.now();
  const pieces: GibAssetLibraryPiece[] = [];
  const byPart = new Map<string, GibAssetLibraryPiece>();
  let verts = 0, tris = 0;
  for (const { doc, decoded } of set.pieces) {
    const rest = new THREE.BufferGeometry();
    // The REST geometry references the decoded arrays directly and is never
    // mutated; instance geometries allocate their own position/normal.
    rest.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3));
    rest.setAttribute('normal', new THREE.BufferAttribute(decoded.normals, 3));
    rest.setAttribute('bakeColor', new THREE.BufferAttribute(decoded.bakeColor, 4));
    rest.setAttribute('bakeResponse', new THREE.BufferAttribute(decoded.bakeResponse, 4));
    rest.setAttribute('bakeFresnel', new THREE.BufferAttribute(decoded.bakeFresnel, 1));
    rest.setAttribute('bakeAnchor', new THREE.BufferAttribute(decoded.bakeAnchor, 4));
    rest.setAttribute('bakeAo', new THREE.BufferAttribute(decoded.bakeAo, 1));
    const kind = new Float32Array(doc.verts).fill(GORE_KIND[doc.material]);
    rest.setAttribute('goreKind', new THREE.BufferAttribute(kind, 1));
    rest.setIndex(new THREE.BufferAttribute(decoded.indices, 1));
    rest.computeBoundingSphere();
    rest.computeBoundingBox();

    const piece: GibAssetLibraryPiece = {
      part: doc.part, limb: doc.limb, kind: doc.kind, material: doc.material,
      doc, decoded, rest, face: doc.face,
    };
    pieces.push(piece);
    byPart.set(doc.part, piece);
    verts += doc.verts;
    tris += doc.tris;
  }
  return {
    archetype: set.archetype,
    fingerprint: set.fingerprint,
    pieces, byPart, material,
    bytes: { ...set.bytes }, verts, tris,
    builtMs: performance.now() - t0,
    dispose() {
      for (const p of pieces) p.rest.dispose();
      pieces.length = 0;
      byPart.clear();
    },
  };
}

/** One in-flight deformed piece: its own geometry and buffers. */
export interface GibAssetInstance {
  part: string;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  normals: Float32Array;
  /** `piece.doc.verts` — the pooled buffer size. */
  verts: number;
}

interface PoolEntry {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  normals: Float32Array;
}

/**
 * PER-PART geometry pool. A released instance's buffers go back on the part's
 * free list, so a firefight with many gibs reuses a bounded number of
 * geometries rather than allocating one per blast.
 */
export class GibAssetInstancePool {
  private readonly free = new Map<string, PoolEntry[]>();
  private live = 0;
  private created = 0;

  constructor(private readonly library: GibAssetLibrary) {}

  /** Create (or reuse) a per-instance geometry for `part`. The geometry's
   *  immutable channels wrap the SHARED decoded arrays; only positions/normals
   *  are private. Throws when the part is not in this library. */
  acquire(part: string): GibAssetInstance {
    const piece = this.library.byPart.get(part);
    if (!piece) throw new Error(`gib asset ${this.library.archetype}: no piece '${part}'`);
    const key = `${part}#${piece.doc.verts}`;
    const entry = this.free.get(key)?.pop() ?? this.makeEntry(piece);
    entry.geometry.getAttribute('position').needsUpdate = true;
    entry.geometry.getAttribute('normal').needsUpdate = true;
    this.live++;
    return {
      part,
      geometry: entry.geometry,
      positions: entry.positions,
      normals: entry.normals,
      verts: piece.doc.verts,
    };
  }

  private makeEntry(piece: GibAssetLibraryPiece): PoolEntry {
    const v = piece.doc.verts;
    const positions = new Float32Array(v * 3);
    const normals = new Float32Array(v * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    // Immutable channels: wrap the shared decoded arrays in fresh attributes so
    // each geometry owns its GPU buffer but the CPU arrays stay shared.
    const d = piece.decoded;
    g.setAttribute('bakeColor', new THREE.BufferAttribute(d.bakeColor, 4));
    g.setAttribute('bakeResponse', new THREE.BufferAttribute(d.bakeResponse, 4));
    g.setAttribute('bakeFresnel', new THREE.BufferAttribute(d.bakeFresnel, 1));
    g.setAttribute('bakeAnchor', new THREE.BufferAttribute(d.bakeAnchor, 4));
    g.setAttribute('bakeAo', new THREE.BufferAttribute(d.bakeAo, 1));
    const goreKind = piece.rest.getAttribute('goreKind') as THREE.BufferAttribute;
    g.setAttribute('goreKind', new THREE.BufferAttribute(new Float32Array(goreKind.array), 1));
    g.setIndex(new THREE.BufferAttribute(d.indices, 1));
    this.created++;
    return { geometry: g, positions, normals };
  }

  /**
   * Deform one instance to the current pose/slough. `flesh`/`bones` are the
   * runtime arrays (`frame.deformedPrims`/`deformedBones`); `pivot` is the
   * chunk's world pivot. PURE with respect to the library.
   */
  deform(inst: GibAssetInstance, flesh: readonly Primitive[], bones: readonly Primitive[], pivot: Vec3): void {
    const piece = this.library.byPart.get(inst.part);
    if (!piece) return;
    this.deformRows(inst, gibAssetPosedRows(piece.doc, flesh, bones), pivot);
  }

  /** Deform with pre-built frames — the immediate-gib path supplies the piece's
   *  own (already sealed) prims row-aligned via `gibAssetRowsFromPrims`. */
  deformRows(inst: GibAssetInstance, rows: readonly GibAssetPosedRow[], pivot: Vec3): void {
    const piece = this.library.byPart.get(inst.part);
    if (!piece) return;
    deformGibAssetPiece(piece.doc, piece.decoded, rows, pivot, inst, true);
    const pos = inst.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nrm = inst.geometry.getAttribute('normal') as THREE.BufferAttribute;
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    inst.geometry.computeBoundingSphere();
    (inst.geometry as THREE.BufferGeometry & { computeBoundingBox?: () => void }).computeBoundingBox?.();
  }

  release(inst: GibAssetInstance): void {
    const key = `${inst.part}#${inst.verts}`;
    const list = this.free.get(key) ?? [];
    list.push({ geometry: inst.geometry, positions: inst.positions, normals: inst.normals });
    this.free.set(key, list);
    this.live = Math.max(0, this.live - 1);
  }

  /** Live (checked out) instance count — the "live moving mesh" counter. */
  liveCount(): number { return this.live; }
  /** Buffers built over the pool's life (NOT live); a bounded number is the
   *  proof the pool is a pool. */
  createdCount(): number { return this.created; }
  pooledCount(): number {
    let n = 0;
    for (const list of this.free.values()) n += list.length;
    return n;
  }

  dispose(): void {
    for (const list of this.free.values()) for (const e of list) e.geometry.dispose();
    this.free.clear();
    this.live = 0;
  }
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export type GibAssetIneligibleReason = 'no-asset' | 'source-mismatch' | 'head-face';

/**
 * EXPLICIT asset eligibility. The asset was baked from the REST body's planner
 * split, so it is only valid for a runtime piece carrying the SAME source
 * primitives/bones. A body with a severed limb produces a piece with a
 * different `srcPrims`/`srcBones` set; that piece falls back rather than
 * silently losing the damage. Testable by construction.
 */
export function gibAssetEligible(
  doc: GibAssetPiece,
  gib: { part?: string; srcPrims?: readonly number[]; srcBones?: readonly number[] },
): GibAssetIneligibleReason | null {
  if (!doc) return 'no-asset';
  if (gib.part !== undefined && gib.part !== doc.part) return 'source-mismatch';
  const eq = (a: readonly number[] | undefined, b: readonly number[]): boolean => {
    if (!a) return b.length === 0;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  if (!eq(gib.srcPrims, doc.srcPrims)) return 'source-mismatch';
  if (!eq(gib.srcBones, doc.srcBones)) return 'source-mismatch';
  return null;
}

/**
 * ROW-FOR-ROW semantic check between the baked bind table and the runtime
 * piece (2026-09-17). `gibAssetEligible` proves the SOURCE INDEX SETS match;
 * this also proves each table row is the runtime row it will be deformed
 * against, in order — flesh rows against `gib.prims` (minus the `sub` caps that
 * are not bind targets) and bone rows against `gib.bones`. A plan that
 * retained the same sources but reordered or grew a row would slip past a
 * count-only check and deform against the wrong frame; this refuses it.
 */
export function gibAssetRowsMatch(
  doc: GibAssetPiece,
  gib: {
    prims?: readonly { op?: string }[];
    bones?: readonly { op?: string }[];
    srcPrims?: readonly number[];
    srcBones?: readonly number[];
  },
): GibAssetIneligibleReason | null {
  if (!doc) return 'no-asset';
  // Without the runtime rows there is nothing to align against; the source-set
  // check in `gibAssetEligible` is the whole contract in that case.
  if (gib.prims === undefined && gib.bones === undefined) return null;
  const flesh = gib.prims ? gib.prims.filter(p => p.op !== 'sub') : null;
  const bones = gib.bones ? gib.bones.filter(p => p.op !== 'sub') : null;
  const srcPrims = gib.srcPrims ?? [];
  const srcBones = gib.srcBones ?? [];
  const fleshCount = flesh ? flesh.length : doc.srcPrims.length;
  const boneCount = bones ? bones.length : doc.srcBones.length;
  if (doc.bind.prims.length !== fleshCount + boneCount) return 'source-mismatch';
  for (let i = 0; i < fleshCount; i++) {
    const p = doc.bind.prims[i]!;
    if (p.source !== 'flesh' || p.index !== (srcPrims[i] ?? -1)) return 'source-mismatch';
  }
  for (let j = 0; j < boneCount; j++) {
    const p = doc.bind.prims[fleshCount + j]!;
    if (p.source !== 'bone' || p.index !== (srcBones[j] ?? -1)) return 'source-mismatch';
  }
  return null;
}

/**
 * The MESH-path eligibility the renderer uses. It is `gibAssetEligible` plus the
 * face rule:
 *
 *   `head-face` — a piece carrying a FACE FRAME keeps the marched path UNLESS
 *   the caller can supply a per-instance face material (`faceSupported`). The
 *   face layer projects from `headCentre`/`headQuat`/`headAxes`, so a
 *   shared-material asset head cannot draw a face; `GibAssetHeadRegistry` gives
 *   each head its own frame and uniforms, and only then is the head eligible.
 *   A face-carrying piece on a renderer (or an actor) with no face source still
 *   falls back, and the fallback is counted, never silent.
 */
export function gibAssetMeshEligible(
  doc: GibAssetPiece,
  gib: {
    part?: string;
    prims?: readonly { op?: string }[];
    bones?: readonly { op?: string }[];
    srcPrims?: readonly number[];
    srcBones?: readonly number[];
  },
  faceSupported = false,
): GibAssetIneligibleReason | null {
  if (doc?.face && !faceSupported) return 'head-face';
  return gibAssetEligible(doc, gib) ?? gibAssetRowsMatch(doc, gib);
}

// ---------------------------------------------------------------------------
// The runtime: load once per archetype, counters, fallback bookkeeping
// ---------------------------------------------------------------------------

export type GibAssetArchetypeState = 'idle' | 'loading' | 'ready' | 'failed';

export interface GibAssetRuntimeCounters {
  /** Pieces drawn from an asset mesh. */
  assetPieces: number;
  /** Pieces that could not use an asset, by reason. */
  fallbacks: Record<string, number>;
  /** Bytes fetched by completed successful loads. */
  loadBytes: number;
  /** Loads in flight. */
  loading: number;
  /** Live deformed meshes checked out of the pools. */
  liveMeshes: number;
  /** Geometries built by the pools (bounded by concurrency, not by blasts). */
  poolCreated: number;
  /** Geometries currently pooled (free). */
  poolFree: number;
  /** Runtime extraction / bake jobs spawned by this path — always 0: the whole
   *  point is that assets remove extraction. Reported so the claim is checkable. */
  runtimeExtractionJobs: number;
  /** Live per-instance head FACE materials, and their lifetime counts. Bounded
   *  by concurrent heads, not by blasts; zero when no face factory is wired. */
  headMaterials: GibAssetHeadCounters;
  /** Whether a per-instance face material can be built at all. When false the
   *  head keeps the marched `'head-face'` fallback. */
  headFaceAvailable: boolean;
}

export interface GibAssetRuntimeOptions extends LoadGibAssetOptions {
  materialFactory: GibAssetMaterialFactory;
  /** Optional: builds ONE NEW per-instance face material per head spawn. Absent
   *  = the head cannot use the mesh path and keeps the marched face. */
  headMaterialFactory?: GibAssetHeadFactory;
  /** Optional hook for tests/telemetry: called once per successful load. */
  onLoad?: (library: GibAssetLibrary) => void;
}

/**
 * Owns the per-archetype libraries, the instance pools and the counters. The
 * renderer asks `library(archetype)` synchronously at spawn (never awaits) and
 * falls back when it is null.
 */
export class GibAssetRuntime {
  private readonly libraries = new Map<string, GibAssetLibrary>();
  private readonly pools = new Map<string, GibAssetInstancePool>();
  private readonly state = new Map<string, GibAssetArchetypeState>();
  private readonly fallbackReason = new Map<string, GibAssetFallbackReason>();
  private readonly loadPromises = new Map<string, Promise<boolean>>();
  private readonly heads: GibAssetHeadRegistry;
  private readonly counters: GibAssetRuntimeCounters = {
    assetPieces: 0, fallbacks: {}, loadBytes: 0, loading: 0,
    liveMeshes: 0, poolCreated: 0, poolFree: 0, runtimeExtractionJobs: 0,
    headMaterials: { live: 0, created: 0, disposed: 0 }, headFaceAvailable: false,
  };
  private material: THREE.Material | null = null;
  private disposed = false;

  constructor(private readonly opts: GibAssetRuntimeOptions) {
    this.heads = new GibAssetHeadRegistry(opts.headMaterialFactory ?? null);
    this.counters.headFaceAvailable = this.heads.available;
  }

  /** Begin (or join) a load. Resolves true when the archetype is ready. */
  ensure(archetype: string): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.libraries.has(archetype)) return Promise.resolve(true);
    const inFlight = this.loadPromises.get(archetype);
    if (inFlight) return inFlight;
    this.state.set(archetype, 'loading');
    this.counters.loading++;
    const p = (async (): Promise<boolean> => {
      try {
        const set = await loadGibAssetSet(archetype, this.opts);
        if (this.disposed) return false;
        if (!this.material) this.material = this.opts.materialFactory.create();
        const library = buildGibAssetLibrary(set, this.material);
        this.libraries.set(archetype, library);
        this.pools.set(archetype, new GibAssetInstancePool(library));
        this.counters.loadBytes += set.bytes.json + set.bytes.bin;
        this.state.set(archetype, 'ready');
        this.opts.onLoad?.(library);
        return true;
      } catch (err) {
        if (this.disposed) return false;
        const reason = err instanceof GibAssetLoadError ? err.reason : 'fetch-failed';
        this.fallbackReason.set(archetype, reason);
        this.counters.fallbacks[reason] = (this.counters.fallbacks[reason] ?? 0) + 1;
        this.state.set(archetype, 'failed');
        console.warn(`[gib-assets] ${archetype}: ${reason} — falling back to marched pieces: ${String(err)}`);
        return false;
      } finally {
        this.counters.loading = Math.max(0, this.counters.loading - 1);
        this.loadPromises.delete(archetype);
        this.refreshPoolCounters();
      }
    })();
    this.loadPromises.set(archetype, p);
    return p;
  }

  library(archetype: string): GibAssetLibrary | null {
    return this.libraries.get(archetype) ?? null;
  }
  pool(archetype: string): GibAssetInstancePool | null {
    return this.pools.get(archetype) ?? null;
  }
  archetypeState(archetype: string): GibAssetArchetypeState {
    return this.state.get(archetype) ?? (this.libraries.has(archetype) ? 'ready' : 'idle');
  }
  failureReason(archetype: string): GibAssetFallbackReason | null {
    return this.fallbackReason.get(archetype) ?? null;
  }
  /** Pools are keyed by archetype; a piece is only valid for its own library. */
  poolFor(library: GibAssetLibrary): GibAssetInstancePool | null {
    return this.pools.get(library.archetype) ?? null;
  }

  /** Count a piece that used an asset. */
  countAssetPiece(): void { this.counters.assetPieces++; }
  /** Count a piece that could not, with its reason. */
  countFallback(reason: string): void {
    this.counters.fallbacks[reason] = (this.counters.fallbacks[reason] ?? 0) + 1;
  }
  /** Whether the mesh path can carry a face (see `gibAssetMeshEligible`). */
  headFaceAvailable(): boolean { return this.heads.available; }
  /** Build a per-instance head face material. Null when no factory is wired; the
   *  caller then keeps the marched head. */
  acquireHead(part: string, local: GibAssetHeadLocal, source?: unknown): GibAssetHeadResource | null {
    return this.heads.acquire(part, local, source);
  }
  /** Called by the renderer when an instance is checked out / returned so the
   *  live count reflects ALL pools. */
  countDeform(liveDelta: number): void {
    this.counters.liveMeshes = Math.max(0, this.counters.liveMeshes + liveDelta);
  }

  countersSnapshot(): GibAssetRuntimeCounters {
    this.refreshPoolCounters();
    return {
      ...this.counters,
      fallbacks: { ...this.counters.fallbacks },
      headMaterials: this.heads.counters(),
    };
  }

  private refreshPoolCounters(): void {
    let created = 0, free = 0, live = 0;
    for (const p of this.pools.values()) {
      created += p.createdCount();
      free += p.pooledCount();
      live += p.liveCount();
    }
    this.counters.poolCreated = created;
    this.counters.poolFree = free;
    this.counters.liveMeshes = live;
  }

  /** Stop honoring in-flight loads and give back every GPU resource. */
  dispose(): void {
    this.disposed = true;
    this.heads.dispose();
    for (const p of this.pools.values()) p.dispose();
    for (const l of this.libraries.values()) l.dispose();
    this.pools.clear();
    this.libraries.clear();
    this.state.clear();
    this.material?.dispose();
    this.material = null;
  }
}

/** Allocation-free convenience for the renderer: acquire + deform in one call. */
export function acquireDeformedInstance(
  runtime: GibAssetRuntime, library: GibAssetLibrary, part: string,
  flesh: readonly Primitive[], bones: readonly Primitive[], pivot: Vec3,
): GibAssetInstance | null {
  const pool = runtime.poolFor(library);
  if (!pool) return null;
  const inst = pool.acquire(part);
  pool.deform(inst, flesh, bones, pivot);
  return inst;
}
