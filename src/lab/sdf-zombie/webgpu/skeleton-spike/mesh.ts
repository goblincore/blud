// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh.ts
//
// SKELETON REPRESENTATION COMPARISON — Task 2: cached segment-local bone
// meshes. One indexed, welded surface-nets mesh per BoneFieldSource,
// extracted from the source's own segment-local distance() inside its
// contract bounds — NOT tubes, NOT capsules: the same extraction
// (surface-nets-cpu, band 0 = the true surface + Newton pull) the settled
// chunk bake uses (chunk-bake-geometry.ts), so the mesh IS the authored
// field's surface up to extraction-cell error. Organs never reach this
// module (excluded by the contract); smooth-union cases do not exist on
// the bone path (hard min only), so no procedural fallback is needed for
// field composition — the fallbacks that remain are whole-actor (chunks
// stay procedural; deferred mode unsupported) and are counted by the
// renderer, not hidden.
//
// Caching (fixture-contract.md invalidation rules): the cache key is
// `${source.revision}@${cellSize}` — revision is the contract's content
// hash over every float that reaches the field, so anatomy/ratio/sever
// re-derives produce a NEW key and cannot hit stale geometry. Entries are
// shared across actors with the same revision (all zombies bind
// identically). Explicit disposal only; the pose path allocates nothing.
//
// Pure CPU + 'three' (like chunk-bake-geometry.ts): no three/webgpu, no
// DOM, so vitest can import this file directly. The TSL renderer lives in
// mesh-renderer.ts.
// The approved mesh-only zombie skull art adapter now subtracts anatomical
// recesses and mandible planes before extraction; other anatomy is unchanged.
import * as THREE from 'three';
import { meshBoneSource } from './mesh-skull';
import { extractHullSoup, fitHullGrid } from '../surface-nets-cpu';
import type { BoneFieldSource } from './contract';
import type { Vec3 } from '../../types';

/** Extraction resolution. Matches BAKE_CELL (chunk-bake-geometry.ts): 1 cm
 *  cells are what the shipped bake pays for torn-flesh craters; the bone
 *  cache pays once per revision. The limb two-anchor approximation (worst
 *  measured 1.26 mm, task-1.md) is 8x below this cell — invisible here. */
export const MESH_CELL = 0.01;

export interface SegmentMesh {
  /** Cache key: `${revision}@${cellSize}`. */
  key: string;
  /** Segment-local indexed geometry, welded by exact position, smooth
   *  normals from computeVertexNormals. */
  geometry: THREE.BufferGeometry;
  verts: number;
  tris: number;
  /** CPU extraction cost, ms — reported, never asserted. */
  bakeMs: number;
  overflow: boolean;
  droppedQuads: number;
  /** True when the grid hit fitHullGrid's dimension cap (a clamped grid can
   *  clip the surface — the renderer must report it, not ship it). */
  clamped: boolean;
}

/**
 * Extract one segment's bone surface, segment-local. Grid: the contract
 * bounds re-centred (fitHullGrid rounds to whole blocks around `centre`),
 * band 0 (the TRUE surface — the Newton pull in extractHullSoup lands
 * vertices ON the field), distort 1 as in the chunk bake.
 */
export function extractSegmentMesh(source: BoneFieldSource, cellSize = MESH_CELL): SegmentMesh {
  source = meshBoneSource(source);
  const t0 = performance.now();
  const { min, max } = source.bounds;
  const centre: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const half: Vec3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
  const grid = fitHullGrid(centre, half, cellSize, 0);
  const soup = extractHullSoup(p => source.distance(p), grid, 0, 1);

  // Weld the soup by exact position (surface-nets repeats each cell vertex
  // verbatim per quad, so exact-float keys are safe — chunk-bake-geometry
  // does the same). No albedo here: bone shading is the march's own
  // boneShade in world space (mesh-renderer.ts), not a baked colour.
  const index: number[] = [];
  const positions: number[] = [];
  const weld = new Map<string, number>();
  for (let i = 0; i < soup.vertCount; i++) {
    const x = soup.positions[i * 3]!, y = soup.positions[i * 3 + 1]!, z = soup.positions[i * 3 + 2]!;
    const key = `${x},${y},${z}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      weld.set(key, id);
      positions.push(x, y, z);
    }
    index.push(id);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return {
    key: `${source.revision}@${cellSize}`,
    geometry,
    verts: positions.length / 3,
    tris: index.length / 3,
    bakeMs: performance.now() - t0,
    overflow: soup.overflow,
    droppedQuads: soup.droppedQuads,
    clamped: grid.clamped,
  };
}

/**
 * Revision+resolution keyed mesh cache with explicit disposal. get() is the
 * ONLY way to obtain geometry for rendering — it extracts on miss and
 * returns the SAME SegmentMesh object on hit (identity is the cache-hit
 * signal the tests assert).
 */
export interface SegmentMeshCacheStats {
  entries: number;
  /** Number of synchronous extractions (cache misses) since construction. */
  extractCount: number;
  /** Total wall time spent inside extractSegmentMesh on the main thread. */
  extractMs: number;
  /** performance.now() timestamp of the FIRST extraction (page time origin). */
  firstExtractAt: number | null;
  /** performance.now() timestamp of the most recent extraction. */
  lastExtractAt: number | null;
  /** bakeMs of the single most expensive extraction seen. */
  maxExtractMs: number;
  maxExtractKey: string | null;
}

export class SegmentMeshCache {
  readonly #map = new Map<string, SegmentMesh>();
  #extractCount = 0;
  #extractMs = 0;
  #firstExtractAt: number | null = null;
  #lastExtractAt: number | null = null;
  #maxExtractMs = 0;
  #maxExtractKey: string | null = null;
  constructor(readonly cellSize: number = MESH_CELL) {}

  keyOf(source: BoneFieldSource): string {
    return `${meshBoneSource(source).revision}@${this.cellSize}`;
  }

  get(source: BoneFieldSource): SegmentMesh {
    const key = this.keyOf(source);
    let m = this.#map.get(key);
    if (!m) {
      m = extractSegmentMesh(source, this.cellSize);
      const at = performance.now();
      this.#extractCount++;
      this.#extractMs += m.bakeMs;
      if (this.#firstExtractAt === null) this.#firstExtractAt = at;
      this.#lastExtractAt = at;
      if (m.bakeMs > this.#maxExtractMs) { this.#maxExtractMs = m.bakeMs; this.#maxExtractKey = key; }
      this.#map.set(key, m);
    }
    return m;
  }

  /** Bounded main-thread extraction telemetry. Never starts new work and is
   *  CUMULATIVE across disposal (see dispose()); it is attribution, not a
   *  view of the live map. */
  stats(): SegmentMeshCacheStats {
    return {
      entries: this.#map.size,
      extractCount: this.#extractCount,
      extractMs: Math.round(this.#extractMs * 100) / 100,
      firstExtractAt: this.#firstExtractAt === null ? null : Math.round(this.#firstExtractAt * 100) / 100,
      lastExtractAt: this.#lastExtractAt === null ? null : Math.round(this.#lastExtractAt * 100) / 100,
      maxExtractMs: Math.round(this.#maxExtractMs * 100) / 100,
      maxExtractKey: this.#maxExtractKey,
    };
  }

  get size(): number {
    return this.#map.size;
  }

  /** Total extracted vertices/triangles across live entries (diagnostics). */
  get totals(): { verts: number; tris: number } {
    let verts = 0, tris = 0;
    for (const m of this.#map.values()) { verts += m.verts; tris += m.tris; }
    return { verts, tris };
  }

  /** Disposes every cached geometry and clears the map. A later get()
   *  re-extracts from scratch — disposal is a memory event, not an
   *  invalidation of the field contract. The extraction counters are
   *  intentionally CUMULATIVE across a disposal: they are diagnostics, and
   *  a rebuild that pays extraction again must not hide that cost. */
  dispose(): void {
    for (const m of this.#map.values()) m.geometry.dispose();
    this.#map.clear();
  }
}
