// src/lab/sdf-zombie/webgpu/gib-library.ts
//
// THE GIB LIBRARY — a character archetype's gib pieces baked ONCE, as meshes,
// and reused by every instance of that character for the rest of the session.
//
// The owner's call, and it is the right one: "we should bake it at spawn and
// basically reuse across a character instance eg all zombies use the same gib
// library". Every zombie comes apart into the SAME pieces — the torso three
// ways, each limb at its joint, the skeleton as its own groups (gib-parts.ts) —
// so a body's gib set is a property of its ARCHETYPE, not of the individual
// zombie or of the blast. Baking per blast pays 5.3 ms x ~24 pieces every time,
// for geometry that is identical every time; baking per archetype pays it once,
// at boot, and every later blast is pure instancing.
//
// WHY THIS IS A DIFFERENT PATH FROM THE SETTLE BAKE. The existing bake
// (game-main's `finishChunkBake`) exists to stop a SETTLED chunk from marching
// forever, and it takes its input from a live `ChunkGpuView` (`view.bakeData()`) —
// it needs a marched GPU view to exist first. `bakeChunkGeometry` itself does not:
// it is pure CPU, synchronous, and takes a plain description of the field. So a
// library can be built with NO renderer, NO actor and NO blast, straight from the
// archetype's rest-pose body. This module is that call, per piece, cached.
//
// THE GEOMETRY IS RECENTRED, AND THAT IS LOAD-BEARING TWICE OVER:
//
//  1. Instancing. `bakeChunkGeometry` emits WORLD-space positions (the field is
//     composed in world space), so a library geometry left in world coords could
//     only ever be drawn at the one place it was baked. Each piece is therefore
//     translated to its own centre, and that centre is kept as the piece's
//     rest-pose OFFSET so a spawn can put it back.
//  2. THE DETAIL MATERIAL. The per-pixel bump samples `positionLocal`, which for a
//     geometry is its own position attribute. Left in world coordinates that is a
//     domain metres across the level, so the noise would be grain-fine, different
//     for every instance, and the `goreCfg.w` scale fixed earlier would mean
//     nothing. Recentred, every instance of a piece gets the SAME relief — which
//     is also what "all zombies share one library" should mean.
import * as THREE from 'three/webgpu';

import type { Quat } from '../vec';
import type { Primitive, Vec3 } from '../types';
import type { BuildResult } from '../build-body';
import { gibParts, type GibPiece, type GibBoneRelease } from '../gib-parts';
import { chunkExtent } from '../extent';
import { boneChunkRadius } from '../melt-bones';
import type { ChunkKind } from '../gib-chunks';
import type { ChunkLook } from '../chunk-bake-field';
import { bakeChunkGeometry, type ChunkBakeData, BAKE_CELL } from './chunk-bake-geometry';

/** One baked piece, ready to instance. */
export interface GibLibraryPiece {
  /** `gib-parts.ts`'s stable label ('torso.chest', 'legL.upper', 'bone.cage').
   *  The library is keyed by this, so a rig can ask for a named piece. */
  part: string;
  limb: string;
  kind: ChunkKind;
  /** PIECE-LOCAL geometry, recentred — see the header. */
  geometry: THREE.BufferGeometry;
  /** Where this piece's centre sat in the archetype's REST pose. A spawn adds
   *  this to the body's own transform. */
  offset: Vec3;
  /** Collision radius, from the same `chunkExtent`/`boneChunkRadius` the marched
   *  path uses, so a library piece settles at the same height and bounces off the
   *  same walls as a marched one. */
  radius: number;
  /** The topple axis, from the same `primsLongAxis` rule as the marched path. */
  longAxis: Vec3;
  verts: number;
  tris: number;
  bakeMs: number;
  /** The untouched split, kept so a future pass can re-derive anything (and so a
   *  test can compare the library against `gibParts` directly). */
  prims: Primitive[];
  bones: Primitive[];
  tornAt: Vec3[];
}

export interface GibLibrary {
  archetype: string;
  pieces: GibLibraryPiece[];
  /** Named lookup — `get('bone.cage')` is how a rig asks for the ribcage. */
  byPart: Map<string, GibLibraryPiece>;
  /** Wall-clock cost of building the whole library, and the bake total inside it. */
  builtMs: number;
  bakeMsTotal: number;
  totalVerts: number;
  totalTris: number;
  /** The archetype's rest pose, so a spawn knows where the body's own origin was. */
  restOrigin: Vec3;
  dispose(): void;
}

export interface BuildGibLibraryOptions {
  archetype: string;
  /** The archetype's REST-pose body (`buildBody(makeZombie(...), …)`). **/
  body: BuildResult;
  /** The flesh palette to paint the bake with — normally read off a live actor's
   *  view uniforms so the pieces match the bodies in this level exactly. */
  look: ChunkLook;
  /** Which skeleton groups to release; mirrors `?gibbones`. */
  bones?: GibBoneRelease;
  /** Overridable for a coarse/fast library; the default is the shipped one. */
  cellSize?: number;
}

/** The long axis of a piece's prims — the same rule `spawnChunkPiece` uses, so a
 *  library piece topples exactly like a marched one. */
function primsLongAxis(prims: readonly Primitive[], origin: Vec3): Vec3 {
  let best: Vec3 = [0, 1, 0];
  let bestLen = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l > bestLen) { bestLen = l; best = d; }
  }
  return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
}

/**
 * Move a baked geometry's vertices so its centre is the origin. Returns the
 * centre that was subtracted, i.e. where the piece was in the rest pose.
 *
 * `bakeColor` is untouched: it is per-vertex and was computed from a
 * centre-relative noise anchor already (`localOf` in `bakeChunkGeometry`), so it
 * stays correct under a pure translation.
 */
function recentre(geo: THREE.BufferGeometry, centre: Vec3): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let i = 0; i < a.length; i += 3) {
    a[i] = a[i]! - centre[0];
    a[i + 1] = a[i + 1]! - centre[1];
    a[i + 2] = a[i + 2]! - centre[2];
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
}

/**
 * Bake one archetype's gib pieces. Synchronous and CPU-only — see the header —
 * so this is safe to call from boot, from a test, or from a worker.
 */
export function buildGibLibrary(opts: BuildGibLibraryOptions): GibLibrary {
  const t0 = performance.now();
  const pieces: GibLibraryPiece[] = [];
  const byPart = new Map<string, GibLibraryPiece>();
  let bakeMsTotal = 0;
  let totalVerts = 0, totalTris = 0;

  const split: GibPiece[] = gibParts(opts.body, { bones: opts.bones ?? 'all' });
  for (const g of split) {
    const boneOnly = g.prims.length === 0 && g.bones.length > 0;
    const extentSource = boneOnly ? g.bones : g.prims;
    const radius = boneOnly
      ? boneChunkRadius(g.bones)
      : chunkExtent(g.prims, g.origin);
    // The bake's own contract, satisfied by construction: a plain field
    // description. `quat` is identity because a rest pose has no settle
    // orientation, and `carveK` is the shipped torn-end carve width (the marched
    // chunk uploads the same value; see chunk-bake-field.ts's mirroring notes).
    const data: ChunkBakeData = {
      flesh: g.prims,
      bones: g.bones,
      torn: g.tornAt as unknown as ChunkBakeData['torn'],
      carveK: 0.008,
      centre: g.origin,
      extent: Math.max(radius, 0.02),
      halfExtent: [radius, radius, radius],
      quat: [0, 0, 0, 1] as Quat,
      look: opts.look,
      gore: 1,
      cellSize: opts.cellSize ?? BAKE_CELL,
    };
    let baked;
    try {
      baked = bakeChunkGeometry(data);
    } catch (err) {
      // A piece that cannot be baked is REPORTED, not skipped silently: a
      // library quietly missing its ribcage is exactly the "i still dont see
      // anything bone related" failure this whole path exists to end.
      console.warn(`[gib-library] ${opts.archetype}/${g.part}: bake failed: ${String(err)}`);
      continue;
    }
    if (baked.verts === 0) {
      console.warn(`[gib-library] ${opts.archetype}/${g.part}: bake produced no geometry`);
      continue;
    }
    if (baked.overflow || baked.droppedQuads > 0) {
      console.warn(`[gib-library] ${opts.archetype}/${g.part}: overflow=${baked.overflow} `
        + `droppedQuads=${baked.droppedQuads} — geometry holes`);
    }
    recentre(baked.geometry, baked.centre);
    const piece: GibLibraryPiece = {
      part: g.part, limb: g.limb as unknown as string, kind: g.kind,
      geometry: baked.geometry,
      offset: [baked.centre[0], baked.centre[1], baked.centre[2]],
      radius,
      longAxis: primsLongAxis(extentSource, g.origin),
      verts: baked.verts, tris: baked.tris, bakeMs: baked.bakeMs,
      prims: g.prims, bones: g.bones, tornAt: g.tornAt,
    };
    pieces.push(piece);
    byPart.set(piece.part, piece);
    bakeMsTotal += baked.bakeMs;
    totalVerts += baked.verts;
    totalTris += baked.tris;
  }

  return {
    archetype: opts.archetype,
    pieces, byPart,
    builtMs: performance.now() - t0,
    bakeMsTotal, totalVerts, totalTris,
    // The rest pose's own origin: the split is authored around the body's
    // position, and `gibParts` returns piece origins in that same space, so the
    // body's own translation IS the rest origin by construction.
    restOrigin: [0, 0, 0],
    dispose() {
      for (const p of pieces) p.geometry.dispose();
      pieces.length = 0;
      byPart.clear();
    },
  };
}

/**
 * A process-wide cache keyed by archetype, so "all zombies use the same gib
 * library" is enforced rather than merely intended: the second zombie asks for
 * `zombie` and gets the same object, and the bake cost is paid exactly once for
 * the session.
 */
const LIBRARIES = new Map<string, GibLibrary>();

export function gibLibraryFor(
  archetype: string, build: () => BuildGibLibraryOptions,
): GibLibrary {
  const hit = LIBRARIES.get(archetype);
  if (hit) return hit;
  const lib = buildGibLibrary(build());
  LIBRARIES.set(archetype, lib);
  return lib;
}

export function gibLibraryCount(): number { return LIBRARIES.size; }

export function disposeGibLibraries(): void {
  for (const lib of LIBRARIES.values()) lib.dispose();
  LIBRARIES.clear();
}
