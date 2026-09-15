// src/lab/sdf-zombie/webgpu/gib-carve.ts
//
// MESH THE WHOLE BODY ONCE, THEN CUT IT INTO PIECES.
//
// The owner's call, after the per-piece bake hit a wall: "couldnt we make meshes
// from the zombie.blob? i thought we had a pipeline for that already actually and
// could like just modify it to do like more granular chunks/pieces".
//
// He is right, and the pipeline is `chunk-bake-field.ts` + `surface-nets-cpu.ts`
// (the same pair the settled-chunk bake uses). The per-piece bake
// (`gib-library.ts`) extracted each MARCHED piece one at a time, which inherited
// two limits of that path:
//
//   1. **It could not bake bones.** A bone-only piece has no flesh, and the
//      chunk field unions bones only NEAR A WOUND — so its field is empty and it
//      extracts to nothing. The whole library had no skeleton in it.
//   2. **Its pieces were the AUTHORED split**, so granularity was whatever
//      `gib-parts.ts` decided and could not be dialled.
//
// Both disappear here, because this composes the field differently:
//
//   ONE FIELD OVER THE WHOLE BODY, with no wound gate anywhere. (The gate in
//   `chunk-bake-field` exists for the CHUNK case — a piece with bones packed in
//   its flesh — and is irrelevant to a whole body.)
//
//   CORRECTION (2026-09-11): this used to claim that passing the bone prims
//   alongside the flesh "yields the body with its skeleton inside it", and that
//   this was the advantage over the per-piece bake. IT IS NOT TRUE. `sdBody`
//   skips `op === 'bone'` and `op === 'organ'` in both of its folds and states
//   why: "the CPU field never shows it". The bones never reached the geometry,
//   and the test that claimed to prove they did only counted bone prims whose
//   BOUNDING BOX overlapped a region — never a vertex. The skeleton is real on a
//   cut, but as MATERIAL, not silhouette: `makeKindAt` marks the vertices a cut
//   drove inside a bone and the chunk material shades them as bone.
//
//   PIECES ARE REGION CLIPS, NOT SEPARATE EXTRACTIONS. A piece is the body
//   INTERSECTED with a region: `field = max(bodyField, regionField)`. Surface
//   nets then closes the surface ALONG THE REGION BOUNDARY, so the cut is CAPPED
//   by construction — cutting a single extracted mesh into pieces instead would
//   leave every piece with an open, hollow edge. That is the whole reason this
//   composes fields rather than slicing triangles.
//
//   GRANULARITY IS A DIAL. Each cluster is split into `cells` slabs along its own
//   long axis (a limb splits into segments, the torso into slices), so a caller
//   asks for finer gore instead of accepting the authored partition.
//
// WHAT THIS GIVES UP, stated plainly: bones inside a piece are BURIED in its
// flesh except where a cut crosses them — which is what a real cut does, and is
// why the ribcage becomes visible on the chest's cut faces. Releasing the
// skeleton as its OWN pieces (the marched `parts` mode's bone chunks, with their
// own thud physics) is a different feature and is NOT what this module does.
import * as THREE from 'three/webgpu';
import type { Vec3 } from '../types';
import type { Primitive } from '../types';
import type { Quat } from '../vec';
import type { BuildResult } from '../build-body';
import type { ChunkLook, ChunkFieldEvals } from '../chunk-bake-field';
import { bakeAoAt, bakeChunkAlbedo, chunkBakeField } from '../chunk-bake-field';
import { sdPrimitive } from '../validate';
import { BONE_GROUPS, groupOf, type BoneGroup } from '../melt-bones';
import { extractHullSoup, fitHullGrid, type HullSoup } from './surface-nets-cpu';

/** Extraction cell. 1 cm, matching the settled-chunk bake: a cut face is 3-5
 *  cells across, which reads as a torn edge rather than a nibble. */
export const CARVE_CELL = 0.01;

export interface CarvedPiece {
  /** `limb` + slab index, e.g. `legL.2`. Stable within one build. */
  part: string;
  limb: string;
  /** The region that produced it, in body space. */
  centre: Vec3;
  halfExtent: Vec3;
  /** PIECE-LOCAL geometry (recentred to `offset`). */
  geometry: THREE.BufferGeometry;
  offset: Vec3;
  radius: number;
  longAxis: Vec3;
  verts: number;
  tris: number;
  /** How many authored BONE prims this region's surface is near — i.e. whether
   *  the cut exposes skeleton. The ribcage/skull/pelvis pieces read > 0. */
  bonesNear: number;
  /** The bone/limb names the region covers, for telemetry and tests. */
  boneNames: string[];
}

export interface CarvedLibrary {
  archetype: string;
  pieces: CarvedPiece[];
  /** Granularity actually used (slabs per cluster). */
  cells: number;
  cellSize: number;
  builtMs: number;
  totalVerts: number;
  totalTris: number;
  /** Bones present in the whole-body field — the thing the per-piece bake lost. */
  bonePrims: number;
  fleshPrims: number;
  skipped: { part: string; reason: string }[];
  dispose(): void;
}

/** Axis-aligned box as an SDF (negative inside). Used to CLIP the body. */
function boxSdf(p: Vec3, centre: Vec3, half: Vec3): number {
  const dx = Math.abs(p[0] - centre[0]) - half[0];
  const dy = Math.abs(p[1] - centre[1]) - half[1];
  const dz = Math.abs(p[2] - centre[2]) - half[2];
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0), oz = Math.max(dz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(dx, Math.max(dy, dz)), 0);
}

/** How far beneath the ORIGINAL skin a vertex must sit before it is fully torn
 *  meat rather than skin. One and a half millimetres: the extraction puts a
 *  genuine skin vertex at preWound = 0 to well under a tenth of that (measured
 *  p50 = 0.47 mm over the whole library), and a cut face is 3-5 cells across, so
 *  this is a crisp tear rim and not a gradient smeared over the piece. */
export const CUT_BAND = 0.0015;

/**
 * THE CUT IS THE WOUND.
 *
 * `bakeChunkAlbedo` mirrors the march's albedo chain, and in that chain the
 * wound mask is the SOLE authority on whether a point is wounded:
 * `albedo = mix(baseColor, tissue, wm)`. The entire tissue ramp — dermis, fat,
 * muscle, clot, viscera — is multiplied by it.
 *
 * A rest-pose body has no torn ends, so `chunkBakeField` gets `torn: []` and its
 * mask is identically zero. Left that way, every vertex of every piece is
 * painted as intact outer skin — including the third of the surface that is a
 * slab cut face. That is a gib with no interior: one flat hue at alpha 0, which
 * the shader then renders fully matte. "Pale, grey, concrete."
 *
 * But the carve knows exactly where it cut, and it needs no new machinery to say
 * so. A piece's surface is `max(bodyField, regionField)`: on the ORIGINAL skin
 * the body field is what reached zero, so `preWound` is 0; on a CUT FACE the
 * region field is what reached zero and `preWound` is negative by however deep
 * into the meat the slab boundary fell. Depth beneath the original skin IS the
 * cut mask, and it is the same quantity the tissue ramp already reads — so the
 * mask and the colour it selects can never disagree about where the tear is.
 */
function cutAwareField(ev: ChunkFieldEvals, look: ChunkLook): ChunkFieldEvals {
  // THE RAMP'S KNEES DESCRIBE TISSUE LAYERS, AND LAYERS ONLY EXIST NEAR THE SKIN.
  //
  // fatDepth 4 mm, muscleDepth 14 mm, visceraDepth 45 mm: those are authored for a
  // WOUND CRATER a centimetre or two deep, which is the only thing the march ever
  // feeds them. A slab cut through a torso is 100 mm deep across its whole face
  // (measured p99 86 mm, max 124 mm), so the raw depth drives every interior vertex
  // clean past the last knee and paints the piece entrails-dark edge to edge.
  // Measured before this cap: 21.2% of vertices landed nearest VISCERA and 0.0%
  // nearest fat — an anatomy chart, not a gib, and the owner read it as a butcher's
  // cross-section ("beef chunks I get from the Piggly Wiggly").
  //
  // So the depth the ALBEDO sees saturates at the clot knee: exponential, C1, and
  // monotonic, so a deeper cut is still never lighter than a shallower one. The
  // rim of a cut still runs dermis -> fat -> muscle and its middle still reaches
  // clot; what it can no longer do is run off the end of the ramp it was given.
  // The GEOMETRY is untouched — this is `preWound`, the colour's depth term only.
  const clotKnee = Math.max(look.muscleDepth * 2.5, 1e-4);
  return {
    ...ev,
    preWound(p: Vec3): number {
      const d = -ev.preWound(p);
      if (d <= 0) return 0;
      return -clotKnee * (1 - Math.exp(-d / clotKnee));
    },
    woundMask(p: Vec3): number {
      const depth = -ev.preWound(p);
      if (depth <= 0) return 0;
      const t = Math.min(1, depth / CUT_BAND);
      return t * t * (3 - 2 * t);
    },
  };
}

/**
 * A SLAB CUT IS NOT A CAVITY.
 *
 * `bakeChunkAlbedo` fires the viscera lump wherever `wm > 0` and the depth clears
 * the muscle knee. The march is stricter: it gates viscera on `wmCav`, the CAVITY
 * mask, precisely because entrails belong to a hole blown INTO a body, not to
 * every wounded pixel. A settled chunk has real cavities and that collapse is fair
 * there; a rest-pose body cut into slabs has none, so on this path the gate would
 * be true across every cut face — which is where the 21.2% came from.
 *
 * Organs are not lost by this: they are authored prims, and `makeKindAt` tags their
 * vertices `goreKind = 2`, which is the material's own organ branch.
 */
function cutLook(look: ChunkLook): ChunkLook {
  return { ...look, visceraAmp: 0 };
}

/** A bone/organ prim owns a surface point when the point is INSIDE it.
 *
 *  Zero, not a margin. `sdBody` skips `op === 'bone'` and `'organ'` outright —
 *  "the CPU field never shows it", in validate.ts's own words — so a bone never
 *  bulges the surface and there is no fillet to allow for. What a bone DOES do is
 *  get cut through: a slab boundary that crosses a femur puts surface points
 *  strictly inside it, and `sdPrimitive <= 0` is exactly that test.
 *
 *  It was 0.008 first, which tagged an 8 mm halo of FLESH around every bone as
 *  bone — roughly 10% of all vertices, most of them nowhere near a cut. */
const KIND_EPS = 0;

/**
 * WHICH TISSUE OWNS A SURFACE POINT — 0 meat, 1 bone, 2 organ.
 *
 * `createBakedChunkMaterial({goreDetail: true})` reads a `goreKind` VERTEX
 * ATTRIBUTE and branches the whole material on it, and its docstring is explicit
 * that "geometry without it must NOT use this mode ... an attribute that is not
 * there is not 0 — it is a bind error". This module shipped without one, and
 * three said so every frame:
 *
 *     THREE.AttributeNode: Vertex attribute "goreKind" not found on geometry.
 *
 * An unbound branch selector took the piece down the ORGAN arm (albedo dragged
 * 62% toward a pale wash, wetness forced to >= 0.86, gloss 48 -> 220) or the BONE
 * arm (gloss 90) at random. A gloss-220 highlight under a 4x flashlight beam is a
 * blown-out white speck wherever the normal happens to face the lamp.
 *
 * The carve does not need to guess. Its field folds the flesh prims AND the
 * archetype's authored bone/organ prims together, so at any surface point the
 * prim whose own iso is crossed there IS the tissue the cut exposed.
 */
function makeKindAt(bones: Primitive[]): (p: Vec3) => number {
  if (bones.length === 0) return () => 0;
  return (p: Vec3): number => {
    let best = Infinity;
    let organ = false;
    for (const b of bones) {
      const d = sdPrimitive(p, b);
      if (d < best) { best = d; organ = b.op === 'organ'; }
    }
    if (best > KIND_EPS) return 0;
    return organ ? 2 : 1;
  };
}

/**
 * THE ANATOMICAL PARTITION — where a gib should be cut.
 *
 * The first cut strategy split each CLUSTER'S BOUNDING BOX into `cells` even
 * slabs along its longest axis. That is a dial for granularity and nothing else:
 * the cuts land at arbitrary fractions of a bounding box, so an arm came out as
 * `armL.0/1/2` — three anonymous lumps — and the owner's read was that the pieces
 * "read a little too abstract ... should at least somewhat resemble pieces from
 * the character".
 *
 * The body already carries the answer. `melt-bones.ts` partitions the authored
 * bone prims into eleven rigid groups (skull, cage, pelvis, upperArm.l/r,
 * foreArm.l/r, thigh.l/r, shin.l/r) — the same partition the melt drops the
 * skeleton in. Cutting on THOSE gives an upper arm, a forearm, a thigh, a shin:
 * parts of a character rather than slices of a box.
 *
 * The region is a NEAREST-BONE-GROUP VORONOI CELL, not a box:
 *
 *   regionSdf_G(p) = minDist(p, bones of G) - minDist(p, bones of every other G)
 *
 * negative inside the cell, zero on the boundary. Three properties earn it:
 *
 *   1. The cells TILE the body exactly, so no flesh is lost between pieces and
 *      none is claimed twice — a box partition can do neither.
 *   2. The boundary between two groups falls where their bones are equidistant,
 *      which on a limb IS THE JOINT. The elbow is where the cut lands because
 *      that is where the humerus stops being nearest and the radius starts.
 *   3. Flesh with no bone of its own goes to the nearest group that has one, so
 *      the HAND rides out on the forearm and the FOOT on the shin instead of
 *      vanishing or becoming a piece of its own with an empty field.
 */
interface Region {
  part: string;
  limb: string;
  /** Bone prims that define this cell. */
  own: Primitive[];
  /** Every other group's bones — the cell's competitors. */
  rivals: Primitive[];
  centre: Vec3;
  half: Vec3;
}

const minDistTo = (p: Vec3, prims: readonly Primitive[]): number => {
  let best = Infinity;
  for (const q of prims) {
    const d = sdPrimitive(p, q);
    if (d < best) best = d;
  }
  return best;
};

/** A prim's own extent, for region AABBs. */
function primBounds(p: Primitive): { min: Vec3; max: Vec3 } {
  const r = (p.radius ?? 0) * Math.max(1, Math.abs(p.scale?.[0] ?? 1));
  return {
    min: [Math.min(p.a[0], p.b[0]) - r, Math.min(p.a[1], p.b[1]) - r, Math.min(p.a[2], p.b[2]) - r],
    max: [Math.max(p.a[0], p.b[0]) + r, Math.max(p.a[1], p.b[1]) + r, Math.max(p.a[2], p.b[2]) + r],
  };
}

function boundsOf(prims: readonly Primitive[], pad: number): { centre: Vec3; half: Vec3 } | null {
  if (prims.length === 0) return null;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const q of prims) {
    const bb = primBounds(q);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, bb.min[i]!);
      hi[i] = Math.max(hi[i]!, bb.max[i]!);
    }
  }
  return {
    centre: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
    half: [(hi[0] - lo[0]) / 2 + pad, (hi[1] - lo[1]) / 2 + pad, (hi[2] - lo[2]) / 2 + pad],
  };
}

/**
 * The prims that can affect the field inside a grid box — the per-region cull.
 *
 * SOUND, not a tolerance. Surface nets only emits where the field crosses zero,
 * and dropping a prim can only ever make the field LARGER (less inside), so the
 * only way a cull could move the surface is by removing a prim that had points
 * inside it within the grid. A prim whose own AABB does not reach the grid has
 * none. The margin covers the smooth-min's blend, which can round the surface a
 * little beyond a prim's own extent.
 *
 * It matters because `sdBody` folds EVERY prim on the body at EVERY sample. A
 * forearm's grid was paying for the skull, the pelvis and both legs. With the
 * anatomical partition running eleven full-part grids instead of thin slabs, and
 * the Voronoi and the baked AO on top, the boot build had gone 3-5 s -> 19.8 s.
 */
function primsNear(prims: readonly Primitive[], centre: Vec3, half: Vec3, margin: number): Primitive[] {
  return prims.filter(q => {
    const bb = primBounds(q);
    for (let i = 0; i < 3; i++) {
      if (bb.max[i]! <= centre[i]! - half[i]! - margin) return false;
      if (bb.min[i]! >= centre[i]! + half[i]! + margin) return false;
    }
    return true;
  });
}

/** Blend margin for `primsNear`: comfortably over any authored `blendK`. */
const NEAR_MARGIN = 0.06;

/** The limb a bone group belongs to, for the piece's physics/telemetry name. */
const LIMB_OF: Record<BoneGroup, string> = {
  skull: 'head', cage: 'torso', pelvis: 'torso',
  'upperArm.l': 'armL', 'foreArm.l': 'armL',
  'upperArm.r': 'armR', 'foreArm.r': 'armR',
  'thigh.l': 'legL', 'shin.l': 'legL',
  'thigh.r': 'legR', 'shin.r': 'legR',
};

/**
 * Build one region per bone group present on this body. The GRID for a cell is
 * sized from the group's own bones PLUS the flesh prims nearest to it, because a
 * Voronoi cell reaches wherever its flesh reaches — a forearm's cell contains the
 * whole hand, which extends well past the last bone in it.
 */
function anatomicalRegions(body: BuildResult): Region[] {
  const bones = (body.bonePrims ?? []).filter(b => b.op === 'bone') as Primitive[];
  if (bones.length === 0) return [];
  const byGroup = new Map<BoneGroup, Primitive[]>();
  for (const b of bones) {
    const g = groupOf(b.bone);
    const arr = byGroup.get(g);
    if (arr) arr.push(b); else byGroup.set(g, [b]);
  }
  // Every flesh prim joins the group its CENTRE is nearest to — this is what
  // sizes the grid, and it is the same nearest-group rule the cell itself uses,
  // so the box can only be too big, never too small.
  const fleshOf = new Map<BoneGroup, Primitive[]>();
  for (const f of body.prims) {
    if (f.dead) continue;
    const c: Vec3 = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2, (f.a[2] + f.b[2]) / 2];
    let bestG: BoneGroup | null = null;
    let bestD = Infinity;
    for (const [g, gb] of byGroup) {
      const d = minDistTo(c, gb);
      if (d < bestD) { bestD = d; bestG = g; }
    }
    if (!bestG) continue;
    const arr = fleshOf.get(bestG);
    if (arr) arr.push(f); else fleshOf.set(bestG, [f]);
  }
  const out: Region[] = [];
  for (const g of BONE_GROUPS) {
    const own = byGroup.get(g);
    if (!own || own.length === 0) continue;
    // Pad by a cell-ish margin: the grid must contain the cell's whole surface,
    // and a flesh prim's own radius is already in primBounds.
    const bb = boundsOf([...own, ...(fleshOf.get(g) ?? [])], 0.02);
    if (!bb) continue;
    // RIVAL CULLING — a correctness-preserving cost cut, not an approximation
    // with a tolerance. The cell SDF is only ever evaluated INSIDE this grid, and
    // a group whose bones are everywhere further from the grid than this group's
    // own bones can be cannot win the nearest test at any point in it. Keeping
    // only the groups whose padded bounds reach the grid takes the rival set from
    // every other bone on the body (~55 prims) to a limb's actual neighbours
    // (~10) and roughly halves the field cost, which the whole-body Voronoi had
    // otherwise doubled: 10.8 s -> the figure in the build log.
    //
    // The bound is a LIPSCHITZ one, so this is exact, not a tolerance. Group h
    // can only change the cell inside this grid if it wins the nearest test
    // somewhere in it, i.e. if min_G d_h <= max_G d_own. Both sides bound:
    //   min_G d_h   >= the box-to-box distance from the grid to h's own AABB
    //   max_G d_own <= d_own(grid centre) + half the grid's diagonal
    //                  (a distance field is 1-Lipschitz)
    // so a group further than that can be dropped with the cell unchanged — and
    // the piece geometry is bit-identical with and without this, which is the
    // check that it really is a bound and not a guess.
    //
    // It matters because the Voronoi doubled the per-sample field cost: sdBody
    // folds 91 prims and the naive rival set added every other bone on the body
    // (~55 more), on a path that evaluates the field ~14 times per grid cell.
    const diagHalf = Math.hypot(bb.half[0], bb.half[1], bb.half[2]);
    const ownAtCentre = minDistTo(bb.centre, own);
    const reach = ownAtCentre + diagHalf;
    const rivals: Primitive[] = [];
    for (const [h, hb] of byGroup) {
      if (h === g) continue;
      const hbb = boundsOf(hb, 0);
      if (!hbb) continue;
      // Box-to-box distance between the grid and h's bounds.
      let d2 = 0;
      for (let i = 0; i < 3; i++) {
        const gap = Math.abs(hbb.centre[i]! - bb.centre[i]!) - bb.half[i]! - hbb.half[i]!;
        if (gap > 0) d2 += gap * gap;
      }
      if (Math.sqrt(d2) <= reach) rivals.push(...hb);
    }
    out.push({ part: g, limb: LIMB_OF[g] ?? 'torso', own, rivals, centre: bb.centre, half: bb.half });
  }
  return out;
}

/**
 * The body's prims, plus a COUNT of its authored bones.
 *
 * The bones are concatenated for the count and for `materialAt` only. They do
 * NOT enter the geometry, and the header's original claim that they did was
 * wrong: `sdBody` skips `op === 'bone'` and `op === 'organ'` in both of its
 * folds, and says so — "'bone' matches neither branch on purpose: it is not a
 * carve, and the CPU field never shows it". Passing them in `flesh` is a no-op
 * for the surface. What makes the skeleton VISIBLE on a cut is not geometry but
 * material: `makeKindAt` tags the vertices a cut drove inside a bone, and the
 * chunk material shades those as bone.
 */
function allPrims(body: BuildResult): { prims: Primitive[]; boneCount: number } {
  const bones = (body.bonePrims ?? []) as Primitive[];
  return { prims: [...body.prims, ...bones], boneCount: bones.length };
}

/**
 * Cut one region out of the whole-body field and weld it into a geometry.
 *
 * Mirrors `bakeChunkGeometry`'s weld/albedo/normals tail (the soup repeats each
 * cell vertex verbatim per quad, so exact-float keys are safe) but over a field
 * this module composes rather than one a `ChunkBakeData` describes.
 */
function extractRegion(
  ev: ChunkFieldEvals, look: ChunkLook, kindAt: (p: Vec3) => number,
  region: (p: Vec3) => number, centre: Vec3, half: Vec3, cell: number,
): { geometry: THREE.BufferGeometry; verts: number; tris: number; centre: Vec3 } | null {
  // INTERSECTION: the body, clipped to the region. `max` (not smax) so the cut
  // face is a clean plane rather than a fillet that would round the gore.
  const field = (p: Vec3) => Math.max(ev.field(p), region(p));
  const grid = fitHullGrid(centre, half, cell, 0);
  const soup: HullSoup = extractHullSoup(field, grid, 0, 1);
  if (soup.vertCount === 0) return null;

  const index: number[] = [];
  const positions: number[] = [];
  const colors: number[] = [];
  const kinds: number[] = [];
  const aos: number[] = [];
  const weld = new Map<string, number>();
  const qc: Quat = [0, 0, 0, 1];
  void qc;
  for (let i = 0; i < soup.vertCount; i++) {
    const p: Vec3 = [
      soup.positions[i * 3]!, soup.positions[i * 3 + 1]!, soup.positions[i * 3 + 2]!,
    ];
    const key = `${p[0]},${p[1]},${p[2]}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      weld.set(key, id);
      positions.push(p[0], p[1], p[2]);
      // The albedo anchor is the piece-local point, so the flesh ramp and its
      // mottle are consistent for every instance of this piece.
      const local: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
      const [r, g, b, wm] = bakeChunkAlbedo(p, local, ev, look);
      colors.push(r, g, b, wm);
      kinds.push(kindAt(p));
      aos.push(bakeAoAt(field, p, cell));
    }
    index.push(id);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('bakeColor', new THREE.Float32BufferAttribute(colors, 4));
  // The detail material's branch selector. Required, not optional — see makeKindAt.
  geometry.setAttribute('goreKind', new THREE.Float32BufferAttribute(kinds, 1));
  // Baked AO. Opt-in on the material side (`bakedAo`) for the same reason
  // goreKind is: a material that reads an attribute the geometry lacks is a bind
  // error, not a zero.
  geometry.setAttribute('bakeAo', new THREE.Float32BufferAttribute(aos, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const bs = geometry.boundingSphere!;
  // Recentre: required to re-instance at all, and required for the detail
  // material's bump, which samples positionLocal (a world-space domain would be
  // grain-fine and different per instance).
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = arr[i]! - bs.center.x;
    arr[i + 1] = arr[i + 1]! - bs.center.y;
    arr[i + 2] = arr[i + 2]! - bs.center.z;
  }
  pos.needsUpdate = true;
  geometry.computeBoundingSphere();
  return {
    geometry,
    verts: positions.length / 3,
    tris: index.length / 3,
    centre: [bs.center.x, bs.center.y, bs.center.z],
  };
}

export interface CarveOptions {
  archetype: string;
  /** The archetype's REST-pose body, e.g.
   *  `buildBody(compileBlob(parseBlob(zombieBlobSrc)), DEFAULT_BUILD_OPTS, {})`. */
  body: BuildResult;
  look: ChunkLook;
  /** SUBDIVISIONS PER ANATOMICAL PART, along the part's long axis. Default 1 —
   *  one piece per bone group, which is what makes a piece read as a forearm
   *  rather than as a slice of a bounding box. 2+ trades that recognisability
   *  back for granularity. (Before the anatomical partition this meant slabs per
   *  CLUSTER and defaulted to 3.) */
  cells?: number;
  cellSize?: number;
}

/**
 * Cut the whole body into `cells` slabs per cluster, each an independent capped
 * mesh extraction. Pure CPU + three: no renderer, no actor, no blast.
 */
export function carveBodyIntoPieces(opts: CarveOptions): CarvedLibrary {
  const t0 = performance.now();
  const cells = Math.max(1, Math.round(opts.cells ?? 1));
  const cellSize = opts.cellSize ?? CARVE_CELL;
  const pieces: CarvedPiece[] = [];
  const skipped: { part: string; reason: string }[] = [];

  const { prims, boneCount } = allPrims(opts.body);
  // ONE field over everything — see the header.
  // No `torn` (a rest pose has no wounds) and no separate bone list (bones are
  // in the fold, ungated) — but the SLAB CUT is a wound, and `cutAwareField`
  // derives the mask for it from the field this already has. Without that
  // wrapper the whole tissue ramp is dead code on this path; see its docstring.
  const look = cutLook(opts.look);

  const bonePrims = (opts.body.bonePrims ?? []) as Primitive[];
  const kindAt = makeKindAt(bonePrims);

  const regions = anatomicalRegions(opts.body);
  if (regions.length === 0) {
    skipped.push({ part: '*', reason: 'the body has no authored bone prims to partition on' });
  }

  for (const region of regions) {
    // The cell itself: nearest-bone-group, negative inside. See anatomicalRegions.
    const cellSdf = (p: Vec3) => minDistTo(p, region.own) - minDistTo(p, region.rivals);
    // A field over only the prims that can reach this grid — see primsNear.
    const evR = cutAwareField(chunkBakeField({
      flesh: primsNear(prims, region.centre, region.half, NEAR_MARGIN),
      bones: [], torn: [], carveK: 0.008,
    }), opts.look);
    const span: [number, number, number] = [region.half[0] * 2, region.half[1] * 2, region.half[2] * 2];
    // The part's own long axis, for the piece's tumble.
    let axis = 0;
    if (span[1] >= span[0] && span[1] >= span[2]) axis = 1;
    else if (span[2] >= span[0] && span[2] >= span[1]) axis = 2;
    const longAxis: [number, number, number] = [0, 0, 0];
    longAxis[axis] = 1;

    for (let sIdx = 0; sIdx < cells; sIdx++) {
      // `cells` still dials granularity, but it now SUBDIVIDES an anatomical part
      // rather than defining one: cells = 1 gives a forearm, cells = 2 gives two
      // halves of a forearm. The default is 1, because the whole point of the
      // change is that a piece should be recognisable.
      const part = cells === 1 ? region.part : `${region.part}.${sIdx}`;
      const half: [number, number, number] = [region.half[0], region.half[1], region.half[2]];
      const centre: [number, number, number] = [region.centre[0], region.centre[1], region.centre[2]];
      let clip = cellSdf;
      if (cells > 1) {
        const step = span[axis]! / cells;
        centre[axis] = region.centre[axis]! - region.half[axis]! + step * (sIdx + 0.5);
        // Overlap by a cell so adjacent slabs do not leave a crack between them.
        half[axis] = step / 2 + cellSize;
        const sc: Vec3 = [centre[0], centre[1], centre[2]];
        const sh: Vec3 = [half[0], half[1], half[2]];
        clip = (p: Vec3) => Math.max(cellSdf(p), boxSdf(p, sc, sh));
      }

      let out;
      try {
        out = extractRegion(evR, look, kindAt, clip, centre, half, cellSize);
      } catch (err) {
        skipped.push({ part, reason: String(err) });
        continue;
      }
      if (!out) {
        // An empty region is normal — a subdivision slab can fall in a gap.
        // Reported, not hidden.
        skipped.push({ part, reason: 'no surface in the region' });
        continue;
      }

      // Which bone prims does this region's surface actually reach? Measured from
      // the prims the grid contains rather than guessed from the part name.
      const boneNames: string[] = [];
      for (const b of bonePrims) {
        const bb = primBounds(b);
        const inside = [0, 1, 2].every(i =>
          bb.max[i]! > centre[i]! - half[i]! && bb.min[i]! < centre[i]! + half[i]!);
        if (inside) boneNames.push(b.bone ?? b.op ?? 'bone');
      }

      pieces.push({
        part, limb: region.limb,
        centre, halfExtent: half,
        geometry: out.geometry, offset: out.centre,
        radius: out.geometry.boundingSphere!.radius,
        longAxis,
        verts: out.verts, tris: out.tris,
        bonesNear: boneNames.length, boneNames,
      });
    }
  }

  let totalVerts = 0, totalTris = 0;
  for (const p of pieces) { totalVerts += p.verts; totalTris += p.tris; }
  return {
    archetype: opts.archetype,
    pieces, cells, cellSize,
    builtMs: performance.now() - t0,
    totalVerts, totalTris,
    bonePrims: boneCount,
    fleshPrims: opts.body.prims.length,
    skipped,
    dispose() {
      for (const p of pieces) p.geometry.dispose();
      pieces.length = 0;
    },
  };
}
