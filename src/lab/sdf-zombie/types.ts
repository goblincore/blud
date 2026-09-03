// src/lab/sdf-zombie/types.ts
import type { Quat } from './vec';

export type Vec3 = readonly [number, number, number];

/**
 * A `shell` — a thin sheet taken off a closed primitive's field
 * (`abs(d) - thickness`), clipped against a half-space plane with a rounded
 * rim. `thickness` is the HALF-thickness (the sheet spans +/-thickness about
 * the base surface). The clip keeps the side where `dot(p, clipNormal) -
 * clipOffset` is negative; `rim` rounds the edge where the sheet meets the
 * plane (0 = a razor edge). Cloth, not mass: a shell's `radius` is the BASE
 * capsule's radius; the sheet rides `thickness` off that surface.
 */
export interface ShellParams {
  thickness: number;
  clipNormal: Vec3;
  clipOffset: number;
  rim: number;
}

/**
 * A rounded box swept along the primitive's segment. Half-extents are
 * `radius * scale` — identical to the capsule's semi-axes, which is what keeps
 * `blob:rings` meaningful on a box. `round` is the corner radius as a FRACTION
 * of `radius`, 0..1, applied INSET:
 *
 *     sdBox(q - closest, vec3(radius * (1 - round))) - radius * round
 *
 * so raising it softens the corner without growing the part. `round: 1` is
 * exactly the capsule; `round: 0.05` reads machined.
 */
export interface BoxParams { round: number }

/** Fixed fold order. Index into this array IS the cluster id. Never reorder. */
export const CLUSTER_ORDER = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'] as const;
export type LimbId = (typeof CLUSTER_ORDER)[number];

/** Authoring-time limb, before mirror expansion. */
export type LimbBase = 'head' | 'torso' | 'arm' | 'leg';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Direction in world axes (this body is authored in a rest pose, no rotations). */
  dir: Vec3;
  length: number;
  /** Lateral (x) offset of this bone's head from its parent's tail. Negated on the mirrored side. */
  side?: number;
  /** When true, expands into `<name>.l` and `<name>.r`. */
  mirror?: boolean;
}

export interface PrimDef {
  /** Bone name this primitive rides. For mirrored prims, the unsuffixed base name. */
  bone: string;
  /**
   * 1-based line in the `.blob` source this primitive was written on. Absent
   * for primitives built in TypeScript (zombie's `makeZombie()`, test
   * fixtures). Exists so a measurement can say "line 143 (snout on skull)"
   * instead of "band 7" — the only form an agent can act on.
   */
  src?: number;
  /** Normalised position along the bone, 0 = head, 1 = tail. */
  at: number;
  /** When set, the primitive is a capsule spanning `at` → `capTo` on the same bone. */
  capTo?: number;
  radius: number;
  /**
   * Radius at the FAR end (`capTo`/`tip`), when the primitive tapers.
   *
   * Absent means untapered — a plain capsule of constant `radius`, which is
   * every primitive authored before tapers existed and which still takes a
   * bit-identical code path in both fields. Present turns the primitive into a
   * round cone, and a `radiusB` of 0 gives a TRUE POINT: the one shape a
   * capsule cannot make, and the reason this exists. A goblin's hooked nose
   * was two ellipsoids faked into a hook that read as a bump in profile,
   * because smooth-min rounds every tip it touches.
   */
  radiusB?: number;
  /** Ellipsoid axis scale applied to the primitive's local space. */
  scale: Vec3;
  /** Smooth-min strength against the rest of the body. */
  blendK: number;
  /**
   * How this primitive folds into the field.
   *
   * Absent is `round` — the quadratic polynomial smooth-min that gives every
   * SDF character its fillets, and the whole reason the aesthetic reads as
   * SDF. `chamfer` folds with a flat 45-degree bevel instead, which keeps a
   * CREASE where round gives a fillet. Before this the only alternative to a
   * fillet was `blendK: 0` — no blend at all, a hard boolean seam — so there
   * was nothing between "smeared" and "cut".
   */
  blendProfile?: 'round' | 'chamfer';
  /**
   * Displacement of the quadratic Bezier CONTROL point from the MIDPOINT of
   * the primitive's two endpoints, in world axes — the same convention as
   * `offset` and `tip`, so an author reasons about all three the same way.
   * Absent means straight, and a straight primitive keeps the exact code path
   * it has always had.
   *
   * Carried as a MID-RELATIVE displacement rather than a resolved control
   * point on purpose: rigging, severing and root translation all move the
   * endpoints and never need to touch this — the control point follows the
   * midpoint it is defined against. And a pair of horns has to curve outward,
   * not both lean the same way, so `mirrorOffset` negates `bend.x` exactly as
   * it does `tip.x`.
   */
  bend?: Vec3;
  limb: LimbBase;
  mirror?: boolean;
  /**
   * `side=l|r` on the source line: SINGLE-SIDED. expandMirror emits one copy
   * on that side of the bone pair and never sets `mirrored` — one authored
   * number placed once, nothing x-negated. See BlobPart.side.
   */
  side?: 'l' | 'r';
  /**
   * 'sub' carves this primitive out of the assembled field instead of adding
   * to it. 'groove' cuts a narrow CHANNEL along where this primitive's surface
   * meets the assembled body — a mouth line, a panel seam, a nostril slit —
   * rather than removing a solid. Both apply AFTER the complete additive fold;
   * see applyCarves in march.glsl.ts for why not per-cluster.
   * 'bone' is a second material strictly INSIDE the flesh: skipped by both the
   * additive fold and the carve pass, folded as a hard min after wounds are
   * carved, so it appears only where a wound has reached it. 'organ' is soft
   * viscera on the same array and the same terms — see W_ORGAN in pack.ts.
   */
  op?: 'add' | 'sub' | 'groove' | 'bone' | 'organ';
  /**
   * Groove depth and width, in metres. Only read when `op` is 'groove'.
   *
   * DECLARED HERE as well as on Primitive, and the omission was the bug: the
   * `op` lived on the def while its two parameters lived only on the placed
   * prim, so `placePrims` had nothing to copy and every authored groove
   * arrived with `op: 'groove'` and no channel. `sdGroove(d, sd, 0, 0)`
   * computes `inBand = 0 - |b|`, never positive, and returns the field
   * untouched — a silent no-op in the CPU field and, through pack.ts reading
   * the same two fields, in the shader too. An operator and its arguments
   * belong on the same interface.
   */
  grooveDepth?: number;
  grooveWidth?: number;
  /**
   * Displacement from the bone-relative placement, in world axes. The body is
   * authored in a rest pose with no rotations, so world and bone axes coincide
   * at authoring time.
   */
  offset?: Vec3;
  /**
   * Extra displacement applied to the FAR end only, so a primitive can point
   * somewhere its bone does not.
   *
   * Without this every capsule runs ALONG a bone, because both ends come from
   * `at`/`capTo` on the same bone and `offset` moves both together. A nose
   * points forward out of a vertical skull bone; a tusk points up out of a jaw.
   * Both were previously faked by stacking spheres at hand-computed offsets,
   * which is how the goblin's nose ended up as two ellipsoids that only read
   * from the front.
   *
   * Mirrored in x by `mirrorOffset` exactly as `offset` is — a pair of tusks
   * has to splay outward, not both lean the same way.
   */
  tip?: Vec3;
  /**
   * Emits two copies with `offset.x` negated. For bilateral features on a bone
   * that is NOT itself mirrored — eye sockets on the skull. Distinct from
   * `mirror`, which requires a mirrored bone and throws without one.
   */
  mirrorOffset?: boolean;
  /**
   * Linear-RGB albedo that REPLACES the flesh colour wherever this primitive
   * is the nearest one to the surface — the "dominant" prim the fold already
   * tracks for noise anchoring. Absent means flesh. This is what lets a
   * .blob carry its own sunglasses, shoes and clothes: the reference mesh is
   * one sculpt with painted regions, and a coloured primitive is exactly that.
   * sRGB in the source (`color=rrggbb`), linear here.
   */
  color?: Vec3;
  /**
   * 0..1. Pushes the surface toward a tight wet highlight — lenses, patent
   * shoes — independent of the flesh preset's wetness. Only read when
   * `color` is set.
   */
  gloss?: number;
  /**
   * Marks this painted primitive as METAL: shading suppresses the diffuse
   * to a small floor and tints the specular by `color` instead of the light
   * colour. A paint approximation, not a BRDF — there is no environment map
   * and no roughness-driven reflection, say so in the grammar docs. Implies
   * gloss's noise suppression with or without `gloss=` set (a machined
   * surface has no pores). `gloss` and `metal` stay SEPARATE axes on
   * purpose: a glass lens is glossy and emphatically not metal, and folding
   * one into the other turns the cyclops' eye into a ball bearing. Only
   * read when `color` is set (enforced at parse time). Packed as prof
   * bit 4 (16) — see pack.ts.
   */
  metal?: boolean;
  /**
   * Marks this primitive as the limb's STRUCTURAL MASS for the fuse probe
   * (clusterCore). Without it the fattest prim in the cluster is taken,
   * which is wrong as soon as a shoe or a sleeve is fatter than the bone it
   * hangs off. One per cluster is the intent; a second one just ties.
   */
  core?: boolean;
  /**
   * When set, this primitive is a thin clipped SHELL (cloth, not mass): the
   * closed base capsule's field is thinned to `abs(d) - thickness`, clipped
   * against `clipNormal`/`clipOffset`, with the cut edge rounded by `rim`.
   * Additive, and folds exactly as any other prim; see ShellParams.
   */
  shell?: ShellParams;
  /**
   * Present when this primitive is a rounded BOX swept along its segment
   * rather than a capsule. `round` is the corner radius as a fraction of
   * `radius` (0..1), inset — see BoxParams.
   */
  box?: BoxParams;
}

export interface BodyDef {
  name: string;
  /** World position of the root bone's head. */
  root: Vec3;
  bones: BoneDef[];
  prims: PrimDef[];
  /**
   * AUTHORED bone primitives from a `.blob` `bones` block (wound pass r2,
   * task 4b), tagged `op: 'bone'` by compileBlob. Named `bonePrims`, not the
   * plan's `bones`: `BodyDef.bones` is TAKEN — it is the rig skeleton above.
   *
   * Kept OUT of `prims` for the same reason BuiltBody keeps them out: the
   * authoring-time field must not be the place where flesh and bone mix.
   * buildBody expands them through the same mirror pass as flesh, places
   * them, and moves them to BuiltBody.bonePrims — an authored bone wins PER
   * BONE, suppressing auto-derivation for the bones it names.
   */
  bonePrims?: PrimDef[];
  /**
   * Bone radius as a fraction of the flesh prim it sits inside — drives the
   * auto-derivation `buildBody` runs over the flesh prims (deriveBones).
   * Absent means DEFAULT_BONE_RATIO; 0 opts a body out of bone entirely.
   * Set by a `bones` block's `ratio` line; the block's authored parts
   * (bonePrims above) override derivation per bone on top of it.
   */
  boneRatio?: number;
}

/** A resolved primitive in rest space. */
export interface Primitive {
  a: Vec3;
  b: Vec3;
  /** Carried from PrimDef.bone through mirror/placement, so CONCRETE (`thigh.l`). */
  bone?: string;
  /** Carried from PrimDef.src through mirror/placement — see there. */
  src?: number;
  /**
   * This primitive is one of the TWO copies `expandMirror` made from a single
   * authored line — either a `mirror` pair on a bilateral bone or a
   * `mirrorOffset` pair on one bone. Set by `expandMirror`, carried by
   * `placePrims`; absent means the line placed exactly one primitive.
   *
   * IT IS A CONSTRAINT ON WHAT MAY BE WRITTEN BACK, not a decoration. The two
   * copies share one source number and the mirror NEGATES its x, so anything
   * measured on one copy and fed back to the line is applied ANTI-symmetrically
   * in x. See `fitPrims`, which drops the x component of its offset suggestion
   * for exactly this reason.
   */
  mirrored?: boolean;
  radius: number;
  /** Radius at `b`. Absent means untapered — see PrimDef.radiusB. */
  radiusB?: number;
  scale: Vec3;
  blendK: number;
  /** Absent means `round`. See PrimDef.blendProfile. */
  blendProfile?: 'round' | 'chamfer';
  limb: LimbId;
  cluster: number;
  /**
   * Displacement of the quadratic Bezier CONTROL point from the MIDPOINT of
   * the primitive's two endpoints, in world axes. Absent means straight — a
   * plain capsule/round cone, bit-identical to every primitive authored
   * before bends existed (the zombie pin demands it). See PrimDef.bend for
   * why this is a displacement rather than a resolved point: it survives
   * rigging and translation untouched because it is defined against the
   * midpoint of endpoints that DO move.
   */
  bend?: Vec3;
  /**
   * Absent means 'add'. Optional rather than required so the many existing
   * test fixtures that build Primitive literals keep compiling.
   * 'bone' is a second material strictly INSIDE the flesh: skipped by both the
   * additive fold and the carve pass, folded as a hard min after wounds are
   * carved, so it appears only where a wound has reached it. 'organ' is soft
   * viscera on the same array and the same terms — see W_ORGAN in pack.ts.
   */
  op?: 'add' | 'sub' | 'groove' | 'bone' | 'organ';
  /** Groove depth and width, in metres. Only read when `op` is 'groove'. */
  grooveDepth?: number;
  grooveWidth?: number;
  /**
   * Severed mid-limb but never removed — the smooth-min fold order is sacred,
   * so a distal prim goes DEAD instead: packBody writes primScale.w = 2 and
   * every field (shader add fold, carve pass, CPU mirror) skips it. Absent
   * means alive.
   */
  dead?: boolean;
  /**
   * Per-prim ORIENTATION (motion-polish task 3): the quaternion that carries
   * the prim's local frame into world space. Absent means identity — almost
   * every prim is identity; applyRig sets it to the head's rigid rotation on
   * skull-owned prims so the anisotropically scaled face ellipsoids (brow,
   * nose, jaw, cranium) rotate WITH the head instead of staying world-aligned
   * (the detached-visor bug). sdPrim/sdPrimitive rotate the sample point into
   * the prim's local frame by the CONJUGATE about the prim midpoint before
   * the scale-divide. Optional so fixtures compile — same pattern as `dead`.
   */
  orient?: Quat;
  /** See PrimDef.color. Carried through mirror, resolve and the rig untouched. */
  color?: Vec3;
  /** See PrimDef.gloss. */
  gloss?: number;
  /** See PrimDef.metal. Carried through mirror, resolve and the rig untouched. */
  metal?: boolean;
  /** See PrimDef.core. */
  core?: boolean;
  /** See PrimDef.shell. Carried through mirror, resolve and the rig untouched. */
  shell?: ShellParams;
  /** See PrimDef.box. Carried through mirror, resolve and the rig untouched. */
  box?: BoxParams;
}

export interface ClusterInfo {
  id: number;
  limb: LimbId;
  /** Index of the first primitive of this cluster in `BuiltBody.prims`. */
  start: number;
  count: number;
  center: Vec3;
  radius: number;
  alive: boolean;
}

export interface ResolvedBone {
  head: Vec3;
  tail: Vec3;
}

export interface BuiltBody {
  /** Sorted by cluster id. Never reorder — see the fold-order constraint. */
  prims: Primitive[];
  clusters: ClusterInfo[];
  bones: Map<string, ResolvedBone>;
  /**
   * Bone primitives — a SECOND material strictly inside the flesh, kept OUT
   * of `prims` on purpose. (Named `bonePrims` rather than the spec prose's
   * `bones` because BuiltBody.bones is TAKEN — it is the rig skeleton map
   * above, and every character test pins pose against it.)
   *
   * About twenty modules walk `prims` and filter on `op`, and only four of
   * them would ever want bone: rig-bind (pose it), pack (upload it), sever
   * (drop it with its limb) and validate (contain it). Keeping bone here
   * makes the other sixteen correct by construction rather than by fifteen
   * remembered filters. An earlier design put bone in `prims` and silently
   * inflated the shadow hull, rendered bone as flesh inside gibs, and broke
   * severDistal's positional slice.
   *
   * Each carries `cluster`, naming the flesh cluster it belongs to, so
   * severing drops it with its limb (packBody skips bones whose cluster is
   * not alive).
   */
  bonePrims: Primitive[];
}
