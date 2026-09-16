// src/lab/sdf-zombie/gib-parts.ts
//
// THE PIECE SET — what a body actually becomes when a blast takes it apart.
//
// WHY THIS EXISTS (owner, 2026-09-10): *"when the SDF body is gibbed it just
// breaks into like tubes (arms and legs) and orbs (torso) which doesnt really
// read as gibs"* and *"i still dont see anything bone related like idk rib cage
// or something"*. Both complaints are about WHAT the pieces are, not how they
// are drawn:
//
//   - `gibAll` (sever.ts) is ONE CHUNK PER CLUSTER, and a cluster is a whole
//     limb (arm, forearm, thigh, shin, head, torso). One arm = one tube, the
//     whole torso = one orb. That is literally the shape the owner rejected.
//   - Every cluster chunk CARRIES its bone prims (`bones: cBones`) and packs
//     them as more capsules UNIONED into the same marched field, so the femur
//     is inside the meat and no bone is ever visible. `?boneMesh` does not fix
//     it either — its crater exposure is fed from ACTOR wounds only, so a
//     detached chunk's own bones never surface.
//
// So this module produces a piece set with the owner's decisions applied
// (docs/dev-notes/2026-09-10-gib-quality-and-transition/README.md §2, all four
// taken 2026-09-10):
//
//   torso SPLIT into chest / abdomen / pelvis   (decision: "Split it.")
//   limbs NOT kept whole: upper / lower per limb (decision: "Do NOT keep them
//                                                 whole.")
//   head stays whole                             (its face carves and skull
//                                                 sphere do not survive a split)
//   the skeleton released as its OWN bone pieces (the answer to "no bones")
//
// CUT PLANES ARE CAPPED, AND THE NEIGHBOURS STILL MEET. Cutting a limb between
// two capsules leaves their rounded ends a centimetre or two apart, and a gap
// at the joint is exactly the "it doesnt read that the body was torn apart"
// problem in reverse — at the frame of release the pieces must still add up to
// the body. Two mechanisms, both here:
//
//   1. SEAL: each side's boundary prim is extended ALONG ITS OWN AXIS to the
//      cut plane (capsule ends are round; extending one to a plane lands its
//      centre line on the plane, so the two pieces touch).
//   2. CAP: each side gets a `sub` blob on the far side of its own cut plane.
//      A sphere of radius R centred R beyond the plane removes everything past
//      the plane within about t²/2R of it — flat to a few millimetres over any
//      piece this game has, and the two sides' carve spheres are complementary,
//      so they cut at the SAME plane. That is what turns a rounded tube end
//      into a slab of meat, which is the difference between "a tube" and "a
//      gib". `sub` prims are skipped by chunkExtent (extent.ts), so the carve
//      sphere costs no proxy-box volume however large R is.
//
// BONES ARE BONE-ONLY CHUNKS, NOT PRIMS ON A FLESH CHUNK. `melt-bones.ts`
// already partitions a body's bone prims into the ELEVEN rigid groups a
// skeleton actually moves in (skull, cage, pelvis, and the eight long bones) —
// the melt releases them exactly that way, and `ChunkGpuView` already carries
// every special case a bone-only chunk needs (counts2.y bareBones, lodCfg.w off
// for the torn-meat mask, and the caller's meltCfg.x = 1 for the PALE bone
// albedo instead of the meat one — see game-main's spawnChunkPiece). A bone
// group is passed as `bones` with `prims: []`, which is what makes it a
// bone-only chunk rather than a chunk with bones buried in it.
//
// PURE, LIKE THE REST OF THE GIB PATH: no Date.now, no Math.random, no DOM. The
// caller's rng seeds the chunk tumble; nothing here reads it.
import type { BuildResult } from './build-body';
import type { ChunkKind } from './gib-chunks';
import type { LimbId, Primitive, Vec3 } from './types';
import { BONE_GROUPS, groupCentroid, groupOf, limbOfGroup, type BoneGroup } from './melt-bones';
import { add, dot, len, normalize, scale, sub } from './vec';

/** Cut-plane geometry, all in metres. */
export const GIB_CUT = {
  /**
   * Cut-sphere radius as a multiple of the PIECE's own reach. The carve is
   * only flat to about t²/2R across the face (t = distance from the piece's
   * axis), so R must clear the piece by a good margin: at 12x a 0.15 m piece
   * cuts flat to 1 mm. Large R is free — a `sub` prim never enters an extent.
   */
  radiusK: 12,
  /** Never smaller than this, so a tiny piece still cuts on a flat-enough arc. */
  minRadius: 0.6,
  /** smax fillet where the cut meets the skin. Sub-centimetre: a razor edge
   *  reads as a cut, not a chamfer. */
  blendK: 0.003,
  /** Overhang (see GibCut) as a multiple of the cut's own blend radius. */
  overhangK: 2,
} as const;

/** How the skeleton is released. `core` is the cost A/B against `all`. */
export type GibBoneRelease = 'all' | 'core' | 'off';

/** The bone groups `core` releases: the three torso masses plus the skull —
 *  the pieces that make a pile read as a skeleton rather than as meat. */
export const CORE_BONE_GROUPS: readonly BoneGroup[] = ['skull', 'cage', 'pelvis'];

/** A cut between two pieces of the SAME body. `n` is the unit normal pointing
 *  from the piece that keeps the `-n` side toward the one that keeps `+n`. */
export interface GibCut {
  at: Vec3;
  n: Vec3;
  /**
   * How far each side may keep material PAST the plane, in metres — the
   * smooth-min fillet the cut is about to delete.
   *
   * A cut at exactly the plane under-covers the body by the blend radius. The
   * body's surface between two prims is the smin fillet, which belongs to
   * NEITHER prim: cut both sides on the plane and the fillet is gone, so the
   * union comes back up to a couple of centimetres thin at the flank — measured
   * at 2.2 cm on the torso, which is a visible waistline pinch at the frame the
   * body comes apart. Each side carving `blendK` past the plane puts the fillet
   * back (doubled, which is invisible, and gone the instant the pieces move).
   */
  overhang: number;
}

/** One piece of a gibbed body, in WORLD space (the same frame `gibAll` hands
 *  back), ready for `spawnChunkPiece`. */
export interface GibPiece {
  limb: LimbId;
  /** Stable label for telemetry and tests: 'torso.chest', 'legL.lower',
   *  'bone.cage'. Not read by the renderer. */
  part: string;
  /** 'bone' for a released skeleton group — picks the chunk's physics and its
   *  material (see spawnChunkPiece). */
  kind: ChunkKind;
  /** Flesh prims. EMPTY on a bone-only piece, which is what makes it one. */
  prims: Primitive[];
  /** Bone/organ rows. On a flesh piece this is empty: the skeleton is released
   *  as its own pieces, so nothing is left buried inside the meat. */
  bones: Primitive[];
  origin: Vec3;
  /** Where this piece tore away. Empty: the cut is a CAPPED PLANE (see the
   *  header), and a torn-end crater at the same point would eat the cap and
   *  open the gap the cap exists to close. */
  tornAt: Vec3[];
  /**
   * STABLE REGION IDENTITY. Indices into the body's own `prims` for every
   * flesh prim this piece owns (the `sub` caps have no source — they are new
   * geometry, and they follow their piece because the whole piece is
   * translated together). The body-to-gib rupture (gib-tear.ts) displaces
   * each region as a unit and must address the SAME prims it draws, so the
   * region plan carries their origin here rather than re-deriving the
   * partition on the displaced body. Optional only so hand-built test
   * fixtures keep compiling; `gibParts` always fills it.
   */
  srcPrims?: number[];
  /** Indices into the body's own `bonePrims` for a bone/organ piece — the
   *  twin of `srcPrims`. Empty on a flesh piece. */
  srcBones?: number[];
  /**
   * FLESH PEEL scale, applied by the rupture along the plan's own cranial axis
   * (`GibPlan.up`) at `TearTuning.chestPeelM * peel`. Set on the ribcage-bearing
   * chest band (body-to-gib task 3) so it lifts a few extra centimetres off the
   * ribcage and leaves the cage standing in a real gap, rather than the whole
   * chest merely translating with the blast push. Along the BODY's axis, not
   * the push, so the reveal does not depend on where the bundle landed.
   * Absent (0) means "no peel", which is every piece but `torso.chest`.
   */
  peel?: number;
}

/** A cut between two pieces of one plan, indexed by PIECE (not by prim), for
 *  the rupture's seam opening: the two sides separate along `n`. */
export interface GibCutLink {
  /** Piece that keeps the `-n` side. */
  a: number;
  /** Piece that keeps the `+n` side. */
  b: number;
  at: Vec3;
  n: Vec3;
}

/**
 * THE REUSABLE PIECE PLAN — one coherent representation of the separating
 * regions, prepared once from a clean posed body. `pieces` is what `gibParts`
 * always returned; `cuts` is the extra piece-to-piece adjacency the rupture
 * needs to open seams. Both the visualization and the chunk physics read the
 * same plan and the same region offsets, so the region drawn is the region
 * spawned (gib-tear.ts).
 */
export interface GibPlan {
  pieces: GibPiece[];
  cuts: GibCutLink[];
  /**
   * THE BODY'S OWN CRANIAL AXIS (torso centre toward head centre), in world
   * space. A piece's `peel` is applied along THIS, not along the blast push:
   * a bundle that lands beside or inside the body must still lift the chest
   * off the ribs along the body's axis, or the reveal changes with the throw.
   * Optional only so hand-built test plans keep compiling.
   */
  up?: Vec3;
}

/** One prim plus its index in the body array it came from. The partition runs
 *  on these so every piece can report its `srcPrims`/`srcBones`. */
interface IdxPrim {
  p: Primitive;
  i: number;
}

export interface GibPartsOptions {
  /** Skeleton release. Default 'all'. */
  bones?: GibBoneRelease;
  /** Release the gut coil as its own piece. Default true. */
  organs?: boolean;
}

/**
 * Build the reusable plan: the piece set plus the piece-to-piece cuts. Pure,
 * like everything here. The rupture calls this ONCE on the clean posed body and
 * reuses it for every frame of the transition and for the released chunks.
 */
export function gibPlan(body: BuildResult, opts: GibPartsOptions = {}): GibPlan {
  const boneRelease: GibBoneRelease = opts.bones ?? 'all';
  const up = bodyUp(body);
  const out: GibPiece[] = [];
  const cuts: GibCutLink[] = [];

  for (const c of body.clusters) {
    if (!c.alive) continue;
    // LIVE prims of this cluster, with their source indices carried.
    const ips: IdxPrim[] = [];
    for (let k = c.start; k < c.start + c.count; k++) {
      const p = body.prims[k];
      if (p && !p.dead) ips.push({ p, i: k });
    }
    if (ips.length === 0) continue;

    if (c.limb === 'head') {
      // WHOLE. An intact head is a Blood signature and this one's face carves
      // and skull sphere are baked against the head's own axes — splitting it
      // gives two half-faces, which reads as a bug rather than as gore.
      out.push(piece(c.limb, 'head', ips, c.center, []));
      continue;
    }

    const groups = c.limb === 'torso'
      ? splitTorso(ips, up, c.center)
      : splitLimb(ips);
    const base = out.length;
    for (const g of groups.pieces) out.push(g);
    // The cuts come from `assemble`, where the pre-cap prims are still in
    // scope — recomputing them from a piece's prims would let an enormous cap
    // sphere become the "nearest endpoint pair" and move the plane.
    for (const l of groups.cuts) cuts.push({ ...l, a: base + l.a, b: base + l.b });
  }

  if (boneRelease !== 'off') {
    for (const g of bonePieces(body, boneRelease)) out.push(g);
  }
  if (opts.organs ?? true) {
    const organs: IdxPrim[] = [];
    for (let i = 0; i < body.bonePrims.length; i++) {
      const p = body.bonePrims[i];
      if (p && p.op === 'organ' && !p.dead) organs.push({ p, i });
    }
    if (organs.length > 0) {
      out.push({
        limb: 'torso', part: 'organ.gut', kind: 'limb',
        prims: [], bones: organs.map(o => ({ ...o.p })), origin: groupCentroid(organs.map(o => o.p)),
        tornAt: [], srcPrims: [], srcBones: organs.map(o => o.i),
      });
    }
  }
  return { pieces: out, cuts, up };
}

/**
 * Split a posed body into its gib pieces. Thin wrapper over `gibPlan` for the
 * many call sites and tests that only need the pieces.
 *
 * ALIVE FLAGS ARE RESPECTED, NOT RE-DERIVED: a cluster that is not alive, or a
 * prim flagged dead, is simply not here — so a body that lost an arm to a slug
 * earlier does not emit that arm's pieces. Same mechanism `gibAll` uses. This
 * function deliberately does NOT hand back a mutated body: the only caller
 * retires the actor outright, and a second "already gibbed" state to keep in
 * sync is the kind of duplication that drifts.
 */
export function gibParts(body: BuildResult, opts: GibPartsOptions = {}): GibPiece[] {
  return gibPlan(body, opts).pieces;
}

/**
 * ONE CHUNK PER LIVE CLUSTER, with the source indices the rupture needs.
 *
 * This is `sever.ts`'s `gibAll` shape (same live-prim filter, same
 * cluster-bone filter, same origin) but carrying `srcPrims`/`srcBones`, which
 * `gibAll` never did. It exists for the BUDGET TIER PLANNER (task 3): the
 * preview has to be drawn from the SAME regions the release will spawn, and a
 * cluster-tier preview that could not name the body prims would have to fall
 * back to the full set — the exact "preview rich, spawn cheap" mismatch this
 * task fixes. No cuts: one chunk per whole cluster shares no plane with
 * another, so there is nothing for the seam term to open.
 */
export function gibClusterPieces(body: BuildResult): GibPiece[] {
  const out: GibPiece[] = [];
  body.clusters.forEach((c, ci) => {
    if (!c.alive) return;
    const prims: Primitive[] = [];
    const srcPrims: number[] = [];
    for (let i = c.start; i < c.start + c.count; i++) {
      const p = body.prims[i];
      if (p && !p.dead) { prims.push({ ...p }); srcPrims.push(i); }
    }
    if (prims.length === 0) return;
    const bones: Primitive[] = [];
    const srcBones: number[] = [];
    (body.bonePrims ?? []).forEach((b, j) => {
      if (b.cluster === ci && !b.dead) { bones.push({ ...b }); srcBones.push(j); }
    });
    out.push({
      limb: c.limb, part: c.limb, kind: 'limb',
      prims, bones, origin: c.center, tornAt: [], srcPrims, srcBones,
    });
  });
  return out;
}

/** The tier the release ladder would choose, chosen ONCE up front. */
export interface GibTierPlan {
  plan: GibPlan;
  /** Graph label of the chosen shape — the same ids `gibActor` reports. */
  tier: string;
  /** How many chunk views this plan needs (what to reserve). */
  reserve: number;
}

export interface GibTierPlanOptions extends GibPartsOptions {
  /** `?gib=` shape. `parts` is the default ladder; `clusters` is its own single
   *  shape. `pieces` is NOT planned here — `gibAllPieces` has no source indices
   *  yet, so it keeps the pre-task-3 path (see RESULTS.md Task 3 limits). */
  mode?: 'parts' | 'clusters';
  /** Blast point, used only for the `slice` fallback's nearest-first order. */
  at?: Vec3;
}

/**
 * CHOOSE THE PIECE SHAPE AT SCHEDULE TIME (body-to-gib task 3).
 *
 * The defect this replaces: `scheduleGib` previewed the full `parts` plan for
 * the whole window and `gibActor` then re-derived a cheaper tier at release, so
 * a tight pool showed a 16-region body and spawned 9 cluster lumps. Both ends
 * now read THIS function: the preview is built from the returned plan, and
 * `gibActor` is locked to it (no ladder re-derivation), so what separates is
 * what spawns.
 *
 * The ladder is deliberately the same rung order and the same lengths as
 * `gibActor`'s, because the choice must be the one the game would already have
 * made — this moves WHEN it is made, not what it is. `budget` is the allowance
 * the existing greedy arithmetic hands this body.
 */
export function gibTierPlan(
  body: BuildResult,
  budget: number,
  opts: GibTierPlanOptions = {},
): GibTierPlan {
  const up = bodyUp(body);
  const mode = opts.mode ?? 'parts';
  if (mode === 'clusters') {
    const pieces = gibClusterPieces(body);
    return { plan: { pieces, cuts: [], up }, tier: 'clusters', reserve: pieces.length };
  }
  const bones: GibBoneRelease = opts.bones ?? 'all';
  const organs = opts.organs ?? true;
  const full = gibPlan(body, { bones, organs });
  if (full.pieces.length <= budget) return { plan: full, tier: 'parts', reserve: full.pieces.length };

  const core = gibPlan(body, { bones: 'core', organs });
  if (core.pieces.length <= budget) return { plan: core, tier: 'parts-core', reserve: core.pieces.length };

  const clusters = gibClusterPieces(body);
  const coreBones = core.pieces.filter(p => p.kind === 'bone');
  const cage = coreBones.filter(p => p.part === 'bone.cage');
  const rungs: { tier: string; pieces: GibPiece[] }[] = [
    { tier: 'clusters+core', pieces: [...clusters, ...coreBones] },
    { tier: 'clusters+cage', pieces: [...clusters, ...cage] },
    { tier: 'clusters', pieces: clusters },
  ];
  for (const rung of rungs) {
    if (rung.pieces.length <= budget) {
      return { plan: { pieces: rung.pieces, cuts: [], up }, tier: rung.tier, reserve: rung.pieces.length };
    }
  }
  // The slice is the last resort, and it is done HERE for the same reason as
  // every rung: the preview must already be the sliced set. Nearest the blast
  // first, matching gibActor's own order.
  const at = opts.at ?? [0, 0, 0] as Vec3;
  const dist = (p: Vec3) => (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 + (p[2] - at[2]) ** 2;
  const sliced = [...clusters].sort((x, y) => dist(x.origin) - dist(y.origin))
    .slice(0, Math.max(1, budget));
  return { plan: { pieces: sliced, cuts: [], up }, tier: 'slice', reserve: sliced.length };
}

/**
 * The body's own cranial axis, from the torso's centre to the head's. Used to
 * split the torso into cranial/caudal halves and NOT world Y: a blasted actor
 * may be collapsed, crawling, or already toppled by the meter, and a world-Y
 * split would then slice a lying body into head-end and feet-end slabs and call
 * the slab nearest the sky a "chest".
 */
function bodyUp(body: BuildResult): Vec3 {
  const torso = body.clusters.find(c => c.limb === 'torso');
  const head = body.clusters.find(c => c.limb === 'head');
  if (!torso || !head) return [0, 1, 0];
  const d = sub(head.center, torso.center);
  return len(d) < 1e-4 ? [0, 1, 0] : normalize(d);
}

/** Midpoint of a prim's endpoints — its centre for banding purposes. Bend is
 *  deliberately ignored: only the ORDER of pieces along the axis matters, and a
 *  bent prim's chord orders the same as its curve. */
function primCentre(p: Primitive): Vec3 {
  return [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
}

/** The authored bone name in the form every rule here matches on. The cast is
 *  not consistent (`upperArm` on the zombie, `upperarm` on the soldier), so
 *  every comparison is case-folded — a rule that matched only one spelling
 *  would silently leave that character's arm whole again. */
function boneKey(p: Primitive): string {
  return (p.bone ?? '').toLowerCase();
}

/** Bone names that belong to the DISTAL half of a limb. */
function isDistalBone(key: string): boolean {
  return key.startsWith('forearm') || key.startsWith('hand')
    || key.startsWith('shin') || key.startsWith('foot');
}

/** Bone names that are the pelvic mass of the torso. */
function isPelvicBone(key: string): boolean {
  return key === 'pelvis' || key === 'hips';
}

/**
 * CHEST / ABDOMEN / PELVIS.
 *
 * The pelvic prims are the ones authored on the pelvis bone. What is left rides
 * the spine, and is split at the MIDDLE OF ITS OWN AXIAL RANGE rather than at a
 * fixed height: the zombie's three spine blobs (ribcage, mid-chest, gut) come
 * out 2 + 1, and a character with a longer spine still comes out as an upper
 * and a lower half instead of as one piece and a crumb.
 */
function splitTorso(ips: IdxPrim[], up: Vec3, centre: Vec3): GibGroups {
  const pelvic = ips.filter(x => isPelvicBone(boneKey(x.p)));
  const axial = ips.filter(x => !isPelvicBone(boneKey(x.p)));
  if (axial.length === 0) return { pieces: [piece('torso', 'torso.pelvis', ips, centre, [])], cuts: [] };

  const proj = (x: IdxPrim) => dot(sub(primCentre(x.p), centre), up);
  const sorted = [...axial].sort((a, b) => proj(b) - proj(a));
  const hi = proj(sorted[0]!);
  const lo = proj(sorted[sorted.length - 1]!);
  const mid = (hi + lo) / 2;
  // A mid-line exactly on a prim's centre would otherwise fall to one side by
  // float noise; `<=` puts it in the abdominal half, which is the smaller of
  // the two on every character here and so the one that can afford it.
  const cranial = sorted.filter(x => proj(x) > mid);
  const caudal = sorted.filter(x => proj(x) <= mid);

  const parts: { id: string; ips: IdxPrim[] }[] = [];
  if (cranial.length === 0) parts.push({ id: 'torso.abdomen', ips: [...caudal, ...cranial] });
  else {
    if (cranial.length > 0) parts.push({ id: 'torso.chest', ips: cranial });
    if (caudal.length > 0) parts.push({ id: 'torso.abdomen', ips: caudal });
  }
  if (pelvic.length > 0) parts.push({ id: 'torso.pelvis', ips: pelvic });

  const groups = assemble(parts, up, 'torso');
  // TORSO STRETCH (see GibPiece.peel). The cranial half LIFTS off the cage and
  // the caudal half is driven the other way, so the ribcage band is emptied
  // rather than just translated: measured on the marched field, lifting the
  // chest alone still left the gut's top edge across ribs 4-6, and the exposed
  // band was three ribs. The counter-peel on the abdomen opens the band to the
  // whole cage and is the brief stretch the contract asks for.
  //
  // The PELVIS takes the SAME counter-peel as the abdomen so the peel cancels
  // across their shared cut: the abdomen/pelvis seam then opens on the blast
  // push exactly as it always did. (Moving the abdomen down alone closed that
  // cut — measured, `gib-tear.test.ts` "opens every cut" caught it.) The price
  // is a visible stretch at the hips, which is the same "brief flesh stretch".
  for (const p of groups.pieces) {
    if (p.part === 'torso.chest') p.peel = 1;
    else if (p.part === 'torso.abdomen' || p.part === 'torso.pelvis') p.peel = -0.7;
  }
  return groups;
}

/**
 * UPPER / LOWER per limb, by the authored bone name. `isDistalBone` is the
 * whole rule: the elbow and the knee are where the prim authoring changes bone,
 * and using the names means a character with an extra segment (the soldier's
 * separate `hand` and `foot`) still splits at the joint it actually has.
 */
function splitLimb(ips: IdxPrim[]): GibGroups {
  const lower = ips.filter(x => isDistalBone(boneKey(x.p)));
  const upper = ips.filter(x => !isDistalBone(boneKey(x.p)));
  const limb = ips[0]!.p.limb;
  // A limb whose prims are all on one side of the joint — a one-prim foot, or a
  // character with no forearm authored — is NOT split. Emitting an empty piece
  // would put a zero-volume chunk in the pool and a phantom in the census.
  if (upper.length === 0 || lower.length === 0) {
    return { pieces: [piece(limb, `${limb}.whole`, ips, centroid(ips.map(x => x.p)), [])], cuts: [] };
  }
  return assemble([
    { id: `${limb}.upper`, ips: upper },
    { id: `${limb}.lower`, ips: lower },
  ], null, limb);
}

/**
 * Order the groups along the cut axis, SEAL and CAP every cut between adjacent
 * ones, and emit the pieces. `axis` is the body's cranial direction for the
 * torso (the groups are already in cranial-to-caudal order) and null for a
 * limb, where the cut direction comes from the two prims' own endpoints.
 */
function assemble(
  parts: { id: string; ips: IdxPrim[] }[],
  axis: Vec3 | null,
  limb: LimbId,
): GibGroups {
  const cuts: (GibCut | undefined)[] = [];
  const primsOf = (part: { ips: IdxPrim[] }) => part.ips.map(x => x.p);
  for (let i = 0; i + 1 < parts.length; i++) {
    cuts[i] = cutBetween(primsOf(parts[i]!), primsOf(parts[i + 1]!), axis) ?? undefined;
  }

  const out: GibPiece[] = [];
  const links: GibCutLink[] = [];
  for (let i = 0; i < parts.length; i++) {
    const own = parts[i]!;
    const ownPrims = primsOf(own);
    const centre = centroid(ownPrims);
    // Radius from THIS PIECE's own reach, and only its own: the cut sphere has
    // to clear the face being cut, not the whole cluster's span. Both sides of
    // a cut measure differently and that is fine — each sphere's surface passes
    // through the plane at its own centre whatever its radius, so the two sides
    // still meet; only the shallowness of the arc differs.
    const radius = Math.max(GIB_CUT.minRadius, extentOf(ownPrims, centre) * GIB_CUT.radiusK);
    // The cut BELOW this piece (this piece keeps the -n side) and the cut ABOVE
    // it (keeps the +n side). Only the cuts this piece actually has a side of,
    // which is why they are tracked by index rather than by "all cuts".
    const below = i - 1 >= 0 ? cuts[i - 1] : undefined;
    const above = cuts[i];
    let prims = ownPrims.map(p => ({ ...p }));
    if (above) prims = capAt(prims, above, -1, radius);
    if (below) prims = capAt(prims, below, +1, radius);
    out.push({
      limb, part: own.id, kind: 'limb',
      prims, bones: [], origin: centre, tornAt: [],
      srcPrims: own.ips.map(x => x.i), srcBones: [],
    });
    // The link this piece forms with the NEXT one, in piece indices. One piece
    // per part, so part i is piece i.
    if (above) links.push({ a: i, b: i + 1, at: above.at, n: above.n });
  }
  return { pieces: out, cuts: links };
}

/** A cluster's pieces plus the cuts between them, in piece indices local to
 *  the cluster. `gibPlan` offsets them into the whole-body plan. */
interface GibGroups {
  pieces: GibPiece[];
  cuts: GibCutLink[];
}

/**
 * The cut plane between two adjacent groups: through the MIDPOINT of the
 * closest endpoint pair (those two capsule ends are what has to meet), with the
 * normal running from the first group to the second. A limb supplies its own
 * direction this way; the torso, whose blobs are single points sharing no
 * endpoint, uses the body's cranial axis instead.
 */
function cutBetween(a: Primitive[], b: Primitive[], axis: Vec3 | null): GibCut | null {
  let best = Infinity;
  let pa: Vec3 | null = null;
  let pb: Vec3 | null = null;
  let blend = 0;
  for (const p of a) for (const q of b) for (const ea of [p.a, p.b]) for (const eb of [q.a, q.b]) {
    const d = len(sub(ea, eb));
    if (d < best) { best = d; pa = ea; pb = eb; blend = Math.max(p.blendK, q.blendK); }
  }
  if (!pa || !pb) return null;
  const at: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
  const raw = sub(pb, pa);
  const n = len(raw) > 1e-5 ? normalize(raw) : (axis ?? [0, 1, 0]);
  return { at, n, overhang: blend * GIB_CUT.overhangK };
}

/**
 * Everything this piece keeps is on the `keep` side of the cut: seal the
 * boundary across to the plane, then cap it.
 *
 * SEAL — extend the one prim whose endpoint is nearest the plane along its own
 * axis until it reaches the plane. Along the axis, not straight at the plane:
 * a capsule extended sideways turns into a bulge, and what is wanted here is
 * the same tube, longer. Near-parallel prims (a rib authored almost in the
 * plane) fall back to a straight move, because `-d/dot(dir, n)` walks to
 * infinity as the axis turns parallel to the plane.
 *
 * CAP — one `sub` blob centred `radius` past the plane on the side being
 * removed. It is a sphere, so its carve of the flat face is a very shallow
 * concave arc (t²/2R), which is also what keeps the two neighbours from
 * z-fighting at exactly the same plane.
 */
function capAt(prims: Primitive[], cut: GibCut, keep: 1 | -1, radius: number): Primitive[] {
  // `n` runs from group i toward group i+1. keep = -1 means this piece is group
  // i (it keeps the -n side) — so its carve sits on the +n side and the
  // endpoint it seals is the one with the SMALLEST shortfall on the keep side.
  const s = keep;
  // Both the seal and the carve work against the plane pushed `overhang` past
  // the nominal cut, so they agree on where the material ends.
  const plane: GibCut = {
    at: add(cut.at, scale(cut.n, -s * cut.overhang)),
    n: cut.n, overhang: cut.overhang,
  };
  // `short > 0` means "on this piece's own side of the plane, that far short of
  // it"; negative means the endpoint is already through and the cap cuts it.
  // Taking the MINIMUM positive shortfall picks the endpoint nearest the plane.
  // (Taking the MAXIMUM seals the endpoint deepest inside the piece — which
  // drags the far end of an arm bar up to the plane and deletes the bar. It
  // cost 21% of the body's interior on the first build of this file.)
  let bestIdx = -1;
  let bestEnd: 'a' | 'b' = 'a';
  let bestShort = Infinity;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i]!;
    if (p.op === 'sub') continue;
    for (const e of ['a', 'b'] as const) {
      const short = dot(sub(p[e], plane.at), cut.n) * s;
      if (short > 0 && short < bestShort) { bestShort = short; bestIdx = i; bestEnd = e; }
    }
  }
  const out = prims.map(p => ({ ...p }));
  if (bestIdx >= 0) {
    out[bestIdx] = extendToPlane(out[bestIdx]!, bestEnd, plane);
  }
  const centre = add(plane.at, scale(cut.n, -s * radius));
  out.push({
    limb: prims[0]?.limb ?? 'torso',
    cluster: prims[0]?.cluster ?? 0,
    op: 'sub',
    a: centre, b: centre,
    radius,
    scale: [1, 1, 1],
    blendK: GIB_CUT.blendK,
  });
  return out;
}

/**
 * Slide one endpoint of a prim onto the cut plane, along the prim's axis.
 *
 * SIDE-BLIND ON PURPOSE: the endpoint's signed distance to the plane may be
 * either sign — the piece above the cut reaches it from -n, the piece below
 * from +n — and both want the same thing, the endpoint AT the plane. Solving
 * `d + t·dot(axis, n) = 0` does that for either sign, so there is no branch to
 * get backwards. (There WAS one, and it was: the +n side's endpoint reads as
 * "already past the plane" by raw sign while actually being 15 mm short of it,
 * which left every joint in the body open by exactly that much.)
 *
 * PERPENDICULAR FALLBACK when the axis runs parallel to the plane: a point prim
 * (a == b — every torso blob) has no axis at all, and `-d / dot(axis, n)` walks
 * to infinity as the axis turns parallel. Moving the endpoint straight at the
 * plane turns such a blob into a stubby capsule reaching the cut, which is the
 * same shape the extend was for.
 */
function extendToPlane(p: Primitive, end: 'a' | 'b', cut: GibCut): Primitive {
  const e = p[end];
  const d = dot(sub(e, cut.at), cut.n);
  const axis = sub(p.b, p.a);
  const axisLen = len(axis);
  const dn = axisLen < 1e-6 ? 0 : dot(scale(axis, 1 / axisLen), cut.n);
  const moved: Vec3 = Math.abs(dn) > 0.25
    ? add(e, scale(axis, -d / (dn * axisLen)))
    : add(e, scale(cut.n, -d));
  return end === 'a' ? { ...p, a: moved } : { ...p, b: moved };
}

/** Reach of a prim set from `centre` — `chunkExtent`'s recipe, kept local so
 *  this module stays free of the renderer's imports. Carves are skipped there
 *  and skipped here: the cap spheres are enormous on purpose. */
function extentOf(prims: Primitive[], centre: Vec3): number {
  let r = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const ms = Math.max(p.scale[0], p.scale[1], p.scale[2]);
    const rMax = Math.max(p.radius, p.radiusB ?? p.radius) * ms;
    for (const e of [p.a, p.b]) r = Math.max(r, len(sub(e, centre)) + rMax);
  }
  return r;
}

/** Mean of every endpoint — the same centre `cluster.center` uses, so a piece's
 *  physics seed and its spawn origin agree with the body's own bookkeeping. */
function centroid(prims: Primitive[]): Vec3 {
  let x = 0, y = 0, z = 0, n = 0;
  for (const p of prims) for (const e of [p.a, p.b]) { x += e[0]; y += e[1]; z += e[2]; n++; }
  return n > 0 ? [x / n, y / n, z / n] : [0, 0, 0];
}

function piece(limb: LimbId, part: string, ips: IdxPrim[], origin: Vec3, tornAt: Vec3[]): GibPiece {
  return {
    limb, part, kind: 'limb', prims: ips.map(x => ({ ...x.p })), bones: [], origin, tornAt,
    srcPrims: ips.map(x => x.i), srcBones: [],
  };
}

/**
 * THE SKELETON, AS ITS OWN PIECES.
 *
 * `partitionBones` groups the authored bone prims into the eleven rigid groups
 * a skeleton moves in and `groupCentroid` seeds each with its own centre of
 * mass, so this is a thin adapter over machinery the melt has used since
 * 2026-09-03 — and it inherits the melt's one trap: ORGANS RIDE THE SAME ARRAY
 * and are not bones (a rigid gut coil is not a thing), so they are filtered out
 * here exactly as `partitionBones` does.
 *
 * `limbOfGroup` decides the chunk's LIMB ID, which is not cosmetic: the chunk
 * view switches its face projection on for a 'head' limb, and a bare pale skull
 * wearing the zombie's painted eyes is worse than no skull at all. It maps the
 * skull group to 'torso' for that reason.
 */
function bonePieces(body: BuildResult, release: GibBoneRelease): GibPiece[] {
  // Index-aware replacement for `partitionBones` (which drops the source
  // index): the plan needs each bone piece to name the `bonePrims` rows it
  // owns so the rupture can displace it as one rigid region.
  const parts = new Map<BoneGroup, IdxPrim[]>();
  for (let i = 0; i < body.bonePrims.length; i++) {
    const p = body.bonePrims[i];
    if (!p || p.op !== 'bone' || p.dead) continue;
    const g = groupOf(p.bone);
    const arr = parts.get(g);
    if (arr) arr.push({ p, i });
    else parts.set(g, [{ p, i }]);
  }
  const out: GibPiece[] = [];
  // Emitted in BONE_GROUPS order (not Map order) so the census and the tests
  // read the same sequence on every run — the Map is built from first-seen
  // order, which is stable today and would not be the day authoring moves a
  // line.
  for (const group of BONE_GROUPS) {
    const ips = parts.get(group);
    if (!ips || ips.length === 0) continue;
    if (release === 'core' && !CORE_BONE_GROUPS.includes(group)) continue;
    out.push({
      limb: limbOfGroup(group),
      part: `bone.${group}`,
      kind: 'bone',
      prims: [],
      bones: ips.map(x => ({ ...x.p })),
      origin: groupCentroid(ips.map(x => x.p)),
      tornAt: [],
      srcPrims: [],
      srcBones: ips.map(x => x.i),
    });
  }
  return out;
}

/**
 * Move every region of a plan by its own offset. PURE: the plan is not
 * mutated, and every prim of a region — flesh, bone and the `sub` caps that
 * have no source index — is translated together, so the caps stay welded to
 * the cut plane they cap. This is the hand-off from the rupture's drawn regions
 * to the live-chunk path: the pieces spawned are the plan's own regions at the
 * offsets the body was last drawn with, not a second partition of a second
 * pose (gib-tear.ts).
 */
export function displaceGibPieces(
  pieces: readonly GibPiece[],
  offsets: readonly Vec3[],
): GibPiece[] {
  return pieces.map((g, i) => {
    const o = offsets[i] ?? [0, 0, 0] as Vec3;
    if (o[0] === 0 && o[1] === 0 && o[2] === 0) return g;
    const t = (p: Primitive): Primitive => ({ ...p, a: add(p.a, o), b: add(p.b, o) });
    return {
      ...g,
      prims: g.prims.map(t),
      bones: g.bones.map(t),
      origin: add(g.origin, o),
      tornAt: g.tornAt.map(p => add(p, o)),
    };
  });
}
