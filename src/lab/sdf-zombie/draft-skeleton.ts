// draft-skeleton — turns a skinned reference into a DRAFT SKELETON: which
// vertices belong to which bone, what each bone's chain segment and surface
// fit are, and the assembled {@link DraftInput} the emitter consumes.
//
// This is the pipeline middle the `blob:draft` CLI used to own inline. It
// lives under src/ so the acceptance properties (soles on the floor, chain
// vs the height line, len= against the rig) are testable END TO END on a
// synthetic rig — scripts/ is outside tsconfig and its main() runs at
// import, so a test cannot reach the pipeline there without pinning a
// re-typed copy of its rules (the vacuous-test failure mode).
//
// THE CHAIN AND THE SURFACE (chain-drift spec,
// docs/superpowers/specs/2026-09-02-blob-draft-chain-drift-design.md):
// len=/dir= come from the RIG — `.blob`'s skeleton is a rigid chain, so a
// bone's len= places every descendant, and overlapping vertex clouds do not
// compose into one. The cloud keeps radii, bands, colour, and answers for
// the surface offset. See fitSide for the per-bone split.
import type { Vec3 } from './types';
import type { RefSkin } from './ref-skin';
import { refBones, type RigDef } from './ref-align';
import {
  bandCloud, cloudAlongAxis, cloudOffset, medialLine, rigLine, type MedialLine,
} from './draft-fit';
import {
  bandColour, bodyPaint, inferStance, pairAsymmetry,
  type PaintedPt, type RgbImage, type PairAsym,
} from './draft-paint';
import type { DraftBone, DraftInput, DraftSideFit } from './draft-emit';
import { builtSurfaceY, emitDraft } from './draft-emit';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { add, dot, scale as vscale, sub } from './vec';

/**
 * The .blob tree this tool builds, in chain order (parents first). The RIG
 * supplies which joints group each bone's vertices and which way the bone
 * runs; this table supplies only what the rig cannot: the .blob NAMES, the
 * limb cluster each folds into, the tree's parentage, and the order the
 * statements emit in. It carries no measurements.
 *
 * `skull` is not a rig bone (MESHY_BIPED leaves Head unmapped — that is the
 * whole point of draft-paint's unmapped clouds): its cloud is the Head
 * joint's surface, measured along the rig's neck bone's head->tail axis —
 * NOT along the cloud's own principal axis, which on real references is the
 * HAIR's axis (schoolgirl's measured 75° off vertical), and a skull bone
 * leaning sideways steals the very crown-to-sole extent the height line is
 * checked against. `hand` has no joint pair beyond the wrist (Meshy lumps
 * the whole hand into one joint — no fingers are derivable), so its axis is
 * signed away from the forearm's tail joint instead, and stays fully
 * cloud-derived: no chain property runs through it (arm/leg bones MUST be
 * pairs and the hand is each arm's leaf). Both stay CLOUD-CHAINED (no rig
 * segment exists), which is legal ONLY because both are chain LEAVES — a
 * cloud line's len= misplaces every descendant, and these place none.
 * Asserted below rather than trusted, since SPECS is static and this is
 * checkable.
 */
interface DraftBoneSpec {
  name: string;
  parent: string | null;
  limb: DraftBone['limb'];
  /** Where this bone's vertex cloud comes from. */
  cloud:
    | { kind: 'rig'; base: string }   // rigClouds[`${base}.l`] and `.r` (or the bone itself once, when the rig has no pair)
    | { kind: 'unmapped'; joint: string }  // e.g. Head — counted by groupByBone, returned by nobody
    | { kind: 'unmappedHands' };           // LeftHand / RightHand, one mitten mass each
  /** rig.boneMap entry whose head->tail joints give the axis its SIGN. */
  orientBy?: string;
  /**
   * Measure this leaf's cloud along its PARENT's rig direction instead of
   * the cloud's own principal axis. Set on the skull: the head cloud is
   * dominated by hair, whose axis is not the head's (schoolgirl's measured
   * 75° off the neck), and the crown end of the height line rides on this
   * bone.
   */
  leafAxis?: 'parent-rig';
}

const SPECS: DraftBoneSpec[] = [
  { name: 'pelvis', parent: null, limb: 'torso', cloud: { kind: 'rig', base: 'pelvis' }, orientBy: 'pelvis' },
  { name: 'spine1', parent: 'pelvis', limb: 'torso', cloud: { kind: 'rig', base: 'spine1' }, orientBy: 'spine1' },
  { name: 'chest', parent: 'spine1', limb: 'torso', cloud: { kind: 'rig', base: 'chest' }, orientBy: 'chest' },
  { name: 'spine2', parent: 'chest', limb: 'torso', cloud: { kind: 'rig', base: 'spine2' }, orientBy: 'spine2' },
  { name: 'neck', parent: 'spine2', limb: 'torso', cloud: { kind: 'rig', base: 'neck' }, orientBy: 'neck' },
  { name: 'skull', parent: 'neck', limb: 'head', cloud: { kind: 'unmapped', joint: 'Head' }, orientBy: 'neck', leafAxis: 'parent-rig' },
  { name: 'clavicle', parent: 'spine2', limb: 'arm', cloud: { kind: 'rig', base: 'clavicle' }, orientBy: 'clavicle' },
  { name: 'upperarm', parent: 'clavicle', limb: 'arm', cloud: { kind: 'rig', base: 'upperarm' }, orientBy: 'upperarm' },
  { name: 'forearm', parent: 'upperarm', limb: 'arm', cloud: { kind: 'rig', base: 'forearm' }, orientBy: 'forearm' },
  { name: 'hand', parent: 'forearm', limb: 'arm', cloud: { kind: 'unmappedHands' } },
  { name: 'thigh', parent: 'pelvis', limb: 'leg', cloud: { kind: 'rig', base: 'thigh' }, orientBy: 'thigh' },
  { name: 'shin', parent: 'thigh', limb: 'leg', cloud: { kind: 'rig', base: 'shin' }, orientBy: 'shin' },
  { name: 'foot', parent: 'shin', limb: 'leg', cloud: { kind: 'rig', base: 'foot' }, orientBy: 'foot' },
];

// The load-time check behind the skull/hand comment above: cloud-chained
// bones are chain leaves, or their len= drifts every descendant (the exact
// failure the rig-derived lines exist to prevent).
for (const s of SPECS) {
  if (s.parent === 'skull' || s.parent === 'hand')
    throw new Error(`SPECS: "${s.name}" hangs off "${s.parent}", which has no rig segment — a cloud-chained bone `
      + 'with children drifts the chain; give it a rig mapping or re-parent it');
}

/** Below this a cloud is not a bone: fewer points than two of bandColour's
 *  paint minimum (8) cannot give bandCloud's 8-station floor even two points
 *  per station, so any "fit" would be noise wearing a prim. The bone is
 *  skipped and its children re-parent up the chain — the rig's connectivity
 *  survives; only the unevidenced geometry goes. (The minotaur's spine1 and
 *  neck carry ZERO dominant verts — Meshy buried the whole torso in Hips —
 *  and skipping them honestly is exactly what this floor is for.) */
const MIN_BONE_VERTS = 16;
/** Above the floor but below this, the fit emits with a thin-evidence note:
 *  ~6 points per station on bandCloud's 8-station floor is measurable, but
 *  the author should know the bands are weak before refining against them. */
const THIN_BONE_VERTS = 128;

/**
 * When a cloud's fitted axis sits more than this far from the rig chain's
 * direction, the surface genuinely does not follow its bone — it is a mass
 * whose principal axis is lateral or fore-aft (a skirt's cone, hair down the
 * back, bilateral hips wider than tall) — and the angle is REPORTED, on
 * stderr and in the emitted `# fit:` comment.
 *
 * It decides NOTHING else. This threshold once STEERED: past it, the CLI
 * substituted the rig chain's direction for the cloud axis, because a
 * non-limb cloud could point a bone sideways and the draft would not build
 * connected (schoolgirl's dress measured 86°). Chain drift removed the need:
 * directions come from the rig now, so a skirt cannot steer a bone, and the
 * measurement stays because it is a real signal the author should see
 * (spec: "demote it from a source to a check").
 *
 * NOT TUNED TO LOOK RIGHT — measured on the two references this tool ships
 * with, where the angle-to-rig distribution has a wide gap:
 *
 *   schoolgirl  chest 41° (ribcage, stays unremarked)
 *   schoolgirl  skull 75°, pelvis 82°, spine1 86°, spine2 88°, neck 89°
 *               (hair, skirt, hips — all reported)
 *
 * Anything in [42°, 74°] classifies every measured bone identically; 45 is
 * its lower edge ("no more than half-turned").
 */
const AXIS_REPORT_DEG = 45;

/**
 * One side's fit, or null below the evidence floor. The CHAIN and the
 * SURFACE have different sources (chain-drift spec):
 *
 *   chain   — `seg`, the bone's chain segment × g through rigLine: len=/dir=
 *             are chain quantities (a bone's head is its parent's TAIL), and
 *             overlapping vertex clouds do not compose into a chain — rig
 *             joint-to-joint distances do, by construction. A null seg means
 *             the rig does not map the bone (skull, hands): the leaf's cloud
 *             line stays the chain, safe only because those bones are chain
 *             LEAVES (asserted against SPECS at load). The skull's leaf line
 *             is measured along its parent's rig axis (see SPECS.leafAxis),
 *             the hand's along its own principal axis.
 *   surface — the cloud's own medial line keeps feeding bandCloud (radii
 *             about a centroid axis are the honest tube radii; about the rig
 *             axis they would inflate by √(r²+d²)), re-signed so from=0 stays
 *             at the bone head; and cloudOffset says how far the PRIM must
 *             shift off the rig axis to sit on the surface — the 9-13 cm
 *             joint-vs-skin trap's fix, which must never move the bone.
 *             The skull is the one leaf banded about its (parent-rig) chain
 *             line too: its axis IS the line the height line runs down, and
 *             bands measured on a 75°-tilted cloud axis would tile the head
 *             sideways.
 *
 * `leafDir` is only read when seg is null: the growth direction that orients
 * a leaf's line (skull: the neck's head->tail; hand: away from the wrist).
 * `axisDisagreeDeg` — the cloud axis vs the rig chain, sign-blind — is
 * RETURNED, never acted on: where it exceeds AXIS_REPORT_DEG the caller
 * reports it (a skirt genuinely does not follow its bone; the author's call,
 * not the CLI's — the old substitution is gone with the steering role).
 */
function fitSide(
  data: SideData, seg: { head: Vec3; tail: Vec3 } | null, leafDir: Vec3, image: RgbImage | null, g: number,
  leafAxis = false, leafAnchor?: Vec3,
): { fit: DraftSideFit; chain: MedialLine; degenerate: number; axisDisagreeDeg?: number } | null {
  if (data.positions.length < MIN_BONE_VERTS) return null;
  const cloudFit = medialLine(data.positions);
  let chain: MedialLine;
  let line: MedialLine;
  let offset: Vec3 | undefined;
  let axisDisagreeDeg: number | undefined;
  if (seg) {
    chain = rigLine(seg.head, seg.tail, g, data.positions);
    line = orient(cloudFit, chain.dir);
    offset = cloudOffset(data.positions, chain);
    // Sign-blind on purpose: an eigenvector's canonical flip is not a
    // disagreement, and both signs name the same surface behaviour.
    axisDisagreeDeg = Math.acos(Math.min(1, Math.abs(dot(cloudFit.dir, chain.dir)))) * 180 / Math.PI;
  } else if (leafAxis && leafAnchor) {
    // The hair trap: the skull cloud's principal axis is the HAIR's, not the
    // head's (schoolgirl's measured 75° off the neck). The parent rig
    // direction is the honest axis, anchored where the grammar will pin the
    // bone's head — the parent chain's tail — because a child bone cannot
    // float. The leaf line IS the statement line here, so the head's extent
    // lands on the chain.
    chain = cloudAlongAxis(leafAnchor, leafDir, data.positions);
    line = chain;
    offset = cloudOffset(data.positions, chain);
  } else {
    chain = orient(cloudFit, leafDir);
    line = chain;
  }
  // bandColour gets the SAME bands object bandCloud returned — it assigns
  // points to bands by walking them in order, so a refitted copy risks a
  // divergent assignment for no benefit.
  const bands = bandCloud(data.positions, line);
  const paint = bandColour(data.pts, line, bands, image);
  // A band whose fitted eccentricity exceeds its own mean radius comes out
  // with a NEGATIVE wide/deep ((d0±a)/d0 < 0) — a prim scaled inside-out,
  // which compiles fine and renders as garbage. It is a real measurement of
  // a cross-section that pinches through the axis (knee flares, mitten
  // edges), but the format cannot carry it and a draft must not booby-trap
  // its author: drop the band, keep the paint array index-aligned, and let
  // the caller say so. End drops re-anchor to the bone end (the emitter
  // pins first/last bands to from=0/to=1); interior drops leave an honest
  // gap.
  const usableBands: typeof bands = [];
  const usablePaint: typeof paint = [];
  let degenerate = 0;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!;
    if (Number.isFinite(b.wide) && Number.isFinite(b.deep) && b.wide > 0.01 && b.deep > 0.01) {
      usableBands.push(b);
      usablePaint.push(paint[i]!);
    } else degenerate++;
  }
  if (usableBands.length === 0) return null;
  return { fit: { line, bands: usableBands, paint: usablePaint, offset }, chain, degenerate, axisDisagreeDeg };
}

/** One side's vertex data: paint-ready points, and the bare positions the
 *  fitters want (the same arrays, so the two can never disagree). */
interface SideData { pts: PaintedPt[]; positions: Vec3[] }

/**
 * Re-sign a fitted line so its dir points the way the bone GROWS (head ->
 * tail), t0/t1 following. medialLine canonicalises its eigenvector to
 * positive-dominant, which for a thigh points UP the cloud; the emitter maps
 * band fractions onto the bone statement with from=0 at the bone's head, so
 * an unre-signed line lands every band inverted. The rig decides only the
 * SIGN (its head->tail joint pair) — position, extent and radii stay
 * cloud-derived, which is the joint trap's letter, not its spirit.
 */
function orient(line: MedialLine, anatomical: Vec3): MedialLine {
  if (dot(line.dir, anatomical) >= 0) return line;
  return { ...line, dir: vscale(line.dir, -1), t0: -line.t1, t1: -line.t0 };
}

/** The point a line's bone grows FROM — its head end. */
const headPoint = (l: MedialLine): Vec3 => add(l.origin, vscale(l.dir, l.t0));
/** ...and the point it grows TO — where a child bone hangs. */
const tailPoint = (l: MedialLine): Vec3 => add(l.origin, vscale(l.dir, l.t1));

/** Mirror a cloud across the body plane, to union a pair into the shared fit
 *  the mirrored prim must actually cover. uv is NOT mirrored: the atlas
 *  paints each side in place. */
const mirrorPt = (p: PaintedPt): PaintedPt => ({ position: [-p.position[0], p.position[1], p.position[2]], uv: p.uv });

function centroid(positions: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const p of positions) { x += p[0]; y += p[1]; z += p[2]; }
  const n = positions.length || 1;
  return [x / n, y / n, z / n];
}

/** The assembled draft plus the numbers the CLI's provenance header names. */
export interface AssembledDraft {
  input: DraftInput;
  /** Fit debts and skips, one line each — the CLI prints them on stderr. */
  notes: string[];
  /** The skinned figure's own crown-to-sole extent, in mesh units. */
  meshExtent: number;
  /** The authored height this draft was scaled to (flag or mesh extent). */
  height: number;
  /** The one global scale: height / meshExtent. */
  g: number;
}

/**
 * Fit a skinned reference's vertex clouds and assemble the draft the
 * emitter consumes. Throws (never exits) when there is no root/head surface
 * to hang a body from or a pair is one-sided — the CLI turns that into its
 * exit-2 contract.
 *
 * The returned `g` is the SURFACE-calibrated scale ({@link calibrated}), not
 * the raw height/meshExtent ratio — every fit in `input` was made at it, so
 * the artifact's numbers and its `chain.scale` provenance agree with it by
 * construction.
 */
export function assembleDraft(
  skin: RefSkin, rig: RigDef, image: RgbImage | null, opts: { name: string; height?: number },
): AssembledDraft {
  // --- authored height -------------------------------------------------------
  // Default: the skinned figure's own extent. The skinned surface is the
  // measurement — parseGlb's raw POSITION would be wrong by the armature
  // scale on these files, the exact bug ref-skin.ts exists to prevent.
  let minY = Infinity, maxY = -Infinity;
  for (const v of skin.verts) {
    if (v.position[1] < minY) minY = v.position[1];
    if (v.position[1] > maxY) maxY = v.position[1];
  }
  const meshExtent = maxY - minY;
  const height = opts.height ?? meshExtent;
  return calibrated(skin, rig, image, opts, meshExtent, height);
}

/**
 * One full fit pass at global scale `g`: the grouping walk, per-bone fits
 * and chain assembly. Positions are scaled into authored metres up front, so
 * EVERY measurement below — lengths, radii, offsets, residuals, the root
 * anchor — is linear in `g`. That homogeneity is what makes the calibration
 * in {@link calibrated} exact in one step rather than iterative.
 */
function fitPass(
  skin: RefSkin, rig: RigDef, image: RgbImage | null, opts: { name: string; height?: number },
  meshExtent: number, height: number, g: number,
): AssembledDraft {

  // --- the one grouping walk --------------------------------------------------
  // skin.verts are already dominant-weight-filtered (the calibrated rule
  // lives in readRefSkin — never re-derived here). This walk only attributes
  // them the way groupByBone does, carrying each vertex's uv along because
  // the paint pass needs the join; groupByBone itself returns bare
  // positions. Positions are scaled into body space HERE, so every fit
  // below measures in authored metres and needs no second scale pass.
  const claims = new Map<string, string>();
  for (const [bone, e] of Object.entries(rig.boneMap)) for (const j of e.claims) claims.set(j, bone);
  const rigClouds = new Map<string, SideData>();
  const unmapped = new Map<string, SideData>();
  const allPainted: PaintedPt[] = [];
  for (let i = 0; i < skin.verts.length; i++) {
    const v = skin.verts[i]!;
    const pt: PaintedPt = { position: vscale(v.position, g), uv: skin.uv ? skin.uv[i] ?? null : null };
    allPainted.push(pt);
    const key = claims.get(v.joint) ?? v.joint;
    const into = claims.has(v.joint) ? rigClouds : unmapped;
    let s = into.get(key);
    if (s === undefined) { s = { pts: [], positions: [] }; into.set(key, s); }
    s.pts.push(pt);
    s.positions.push(pt.position);
  }

  /** rig bone head->tail direction, scaled to body space (scale cancels in a
   *  sign test, but the stance offset below wants body metres anyway). */
  const jointPairDir = (bone: string): Vec3 | null => {
    const e = rig.boneMap[bone];
    const head = e && skin.jointWorld.get(e.head), tail = e && skin.jointWorld.get(e.tail);
    return head && tail ? vscale(sub(tail, head), g) : null;
  };

  /** The rig bone whose head->tail joints own a spec's CHAIN line, with the
   *  segment itself — or null where the rig does not map the bone (the
   *  unmapped leaves) or its joints are missing (the same gap that nulls
   *  jointPairDir, which skips the bone below). Same key convention as
   *  collect(): `base` unpaired, `base.l`/`.r` for a pair. */
  const ref = refBones(skin.jointWorld, rig);

  /** The cloud-axis-vs-rig-chain check: report past the bar, on stderr and
   *  on the fit (the emitter carries it into the `# fit:` comment). Decides
   *  nothing else — the substitution this once performed is gone. */
  const reportDisagreement = (
    label: string, angle: number, fit: DraftSideFit, notes: string[],
  ): void => {
    if (angle <= AXIS_REPORT_DEG) return;
    fit.axisDisagreeDeg = angle;
    notes.push(`${label}: cloud axis ${angle.toFixed(0)}° off the rig chain — reported, not corrected `
      + '(the surface does not follow the bone: skirt, hair or bilateral mass; radii and offset still the cloud\'s)');
  };

  // --- fit each spec ----------------------------------------------------------
  interface Built {
    spec: DraftBoneSpec;
    /** The STATEMENT line: the rig's chain segment for a mapped bone, the
     *  signed cloud line for an unmapped leaf — what len=, side= children
     *  and the emitted statement carry. */
    line: MedialLine;
    /** Present when line is rig-derived (see DraftBone.chain in draft-emit).
     *  `head`/`tail` are the rig JOINT NAMES the span runs between — a child
     *  chain continues from `tail`, and the emitter names them in the `#
     *  fit:` comment so the artifact carries its own source. */
    chain?: { rigBone: string; scale: number; head: string; tail: string };
    /** True for the skull leaf (SPECS.leafAxis): line is cloudAlongAxis down
     *  the PARENT's rig direction, not a principal-axis fit. Carried into the
     *  DraftBone so the emitter's `# fit:` source phrase tells the truth — a
     *  spread property TypeScript does not check would otherwise vanish here
     *  and the statement would claim "medial axis of the skull cloud". */
    axisFromParent?: boolean;
    shared?: DraftSideFit;
    l?: DraftSideFit;
    r?: DraftSideFit;
    asym?: PairAsym;
    /** head-point lateral offset from the parent's tail (pairs only) — the
     *  `side=` the statement carries. */
    pairSide?: number;
    kept: number;
  }
  const built = new Map<string, Built>();
  const notes: string[] = [];

  // Coverage first (it is a property of the SKIN, not of any fit): which
  // joints no rig bone claims, biggest cloud first — the same line the CLI
  // printed when it owned this walk, and the author's map of what the draft
  // could not see.
  if (unmapped.size) {
    const list = [...unmapped.entries()].sort((a, b) => b[1].positions.length - a[1].positions.length)
      .map(([j, d]) => `${j}(${d.positions.length})`);
    notes.push(`unmapped joints: ${list.join(', ')}`);
  }

  for (const spec of SPECS) {
    // The anatomical direction per side, or null where the rig cannot say.
    const sideDir = (side: 'l' | 'r' | null): Vec3 | null => {
      if (spec.cloud.kind === 'unmappedHands') {
        // No joint beyond the wrist: orient AWAY from it — the palm points
        // down the limb chain, so the axis sign is the cloud centroid's side
        // of the wrist. rig.boneMap['forearm'] must supply the wrist joint;
        // without it there is no honest sign, and an unorientable hand is a
        // skipped hand, not a guessed one.
        const arm = rig.boneMap[side === 'r' ? 'forearm.r' : 'forearm.l'];
        const wrist = arm && skin.jointWorld.get(arm.tail);
        const data = unmapped.get(side === 'r' ? 'RightHand' : 'LeftHand');
        if (!wrist || !data || data.positions.length === 0) return null;
        return sub(centroid(data.positions), vscale(wrist, g));
      }
      const orientBy = spec.orientBy!;
      return jointPairDir(orientBy.endsWith('.l') || orientBy.endsWith('.r')
        ? orientBy
        : side === null ? orientBy : `${orientBy}.${side}`) ?? null;
    };

    const collect = (spec2: DraftBoneSpec, side: 'l' | 'r' | null): SideData | undefined => {
      if (spec2.cloud.kind === 'unmapped') return unmapped.get(spec2.cloud.joint);
      if (spec2.cloud.kind === 'unmappedHands') return unmapped.get(side === 'r' ? 'RightHand' : 'LeftHand');
      const key = side === null ? spec2.cloud.base : `${spec2.cloud.base}.${side}`;
      const d = rigClouds.get(key);
      return d ?? { pts: [], positions: [] };
    };

    const isPair = spec.cloud.kind === 'unmappedHands'
      || (spec.cloud.kind === 'rig' && rig.boneMap[`${spec.cloud.base}.l`] !== undefined);

    if (!isPair) {
      const data = collect(spec, null);
      const anatomical = sideDir(null);
      if (!anatomical || data === undefined || data.positions.length < MIN_BONE_VERTS) {
        if (spec.name === 'pelvis')
          throw new Error(`no root surface (pelvis cloud ${data?.positions.length ?? 0} verts) — there is nothing to hang a skeleton from`);
        if (spec.name === 'skull')
          throw new Error(`no head surface (Head cloud ${data?.positions.length ?? 0} verts) — the face block rides the skull bone unconditionally`);
        // An unorientable or empty mid-chain bone is skippable; its children
        // re-parent below.
        notes.push(`skipped ${spec.name}: ${data?.positions.length ?? 0} verts — no evidence`);
        continue;
      }
      const rc = rigChainOf(spec, null);
      // The leaf-axis anchor is where the grammar pins the bone head: the
      // nearest kept ancestor's chain tail (the skull's own parent — neck —
      // is skipped on the minotaur, so the anchor rides the chain down to
      // spine2's tail). pelvis is SPECS-first and required, so a kept
      // ancestor always exists by the time a leaf fits.
      let leafAnchor: Vec3 | undefined;
      if (spec.leafAxis === 'parent-rig') {
        const ancestor = nearestKeptAncestor(spec.parent!);
        const parentLine = ancestor ? built.get(ancestor)?.line : undefined;
        if (parentLine) leafAnchor = tailPoint(parentLine);
      }
      const fitted = fitSide(data, rc?.seg ?? null, anatomical, image, g, spec.leafAxis === 'parent-rig', leafAnchor);
      if (!fitted) { notes.push(`skipped ${spec.name}: ${data.positions.length} verts — no evidence`); continue; }
      if (fitted.axisDisagreeDeg !== undefined)
        reportDisagreement(spec.name, fitted.axisDisagreeDeg, fitted.fit, notes);
      if (fitted.degenerate > 0)
        notes.push(`${spec.name}: dropped ${fitted.degenerate} degenerate band(s) — cross-section fit pinched through the axis`);
      if (data.positions.length < THIN_BONE_VERTS)
        notes.push(`thin evidence: ${spec.name} carries only ${data.positions.length} verts — its bands are weak`);
      built.set(spec.name, {
        spec, line: fitted.chain,
        chain: rc ? { rigBone: rc.key, scale: g, head: rc.head, tail: rc.tail } : undefined,
        ...(spec.leafAxis === 'parent-rig' ? { axisFromParent: true } : {}),
        shared: fitted.fit, kept: data.positions.length,
      });
      continue;
    }

    // --- a bilateral pair ---
    const lData = collect(spec, 'l'), rData = collect(spec, 'r');
    const lDir = sideDir('l'), rDir = sideDir('r');
    const nl = lData?.positions.length ?? 0, nr = rData?.positions.length ?? 0;
    if (nl < MIN_BONE_VERTS && nr < MIN_BONE_VERTS) {
      notes.push(`skipped ${spec.name}: ${nl + nr} verts — no evidence`);
      continue;
    }
    if (nl < MIN_BONE_VERTS || nr < MIN_BONE_VERTS) {
      // A genuinely one-sided limb cannot be mirrored (the mirror block
      // clones it to the empty side) and cannot go per-side (the emitter
      // needs both sides' fits). Fail rather than fabricate either way.
      throw new Error(`${spec.name} pair is one-sided (${nl} l verts vs ${nr} r) — a single-sided limb `
        + 'cannot be mirrored or emitted per-side; author it by hand after drafting');
    }
    if (!lDir || !rDir) {
      notes.push(`skipped ${spec.name}: the rig offers no honest axis sign`);
      continue;
    }

    const asym = pairAsymmetry(lData!.positions, rData!.positions);
    const rcL = rigChainOf(spec, 'l'), rcR = rigChainOf(spec, 'r');

    if (asym.mirrorable) {
      // The union cloud, mirrored into one side, is what the SHARED prim must
      // cover — fitting it is the honest shared fit (per-side fits would bake
      // each side's quirks into a prim that exists twice). Its banding axis:
      // the mean of the left direction and the MIRRORED right one — the
      // sides' raw directions are mirror images, and averaging them
      // unmirrored cancels the lateral component to ~zero, leaving
      // normalize() to pick an arbitrary axis (measured: a T-posed pair's
      // mean was [~0, …], and the leaf axis came out vertical for a
      // horizontal arm). Only the LEAF path uses it; a mapped pair's bands
      // sign against the left rig segment inside fitSide.
      const union: SideData = {
        pts: [...lData!.pts, ...rData!.pts.map(mirrorPt)],
        positions: [...lData!.positions, ...rData!.positions.map((p) => [-p[0], p[1], p[2]] as Vec3)],
      };
      const unionDir: Vec3 = [
        (lDir[0] - rDir[0]) / 2, (lDir[1] + rDir[1]) / 2, (lDir[2] + rDir[2]) / 2,
      ];
      const fitted = fitSide(union, rcL?.seg ?? null, unionDir, image, g);
      if (!fitted) { notes.push(`skipped ${spec.name}: union fit under evidentiary floor`); continue; }
      if (fitted.axisDisagreeDeg !== undefined)
        reportDisagreement(spec.name, fitted.axisDisagreeDeg, fitted.fit, notes);
      if (fitted.degenerate > 0)
        notes.push(`${spec.name}: dropped ${fitted.degenerate} degenerate band(s) — cross-section fit pinched through the axis`);
      built.set(spec.name, {
        spec, line: fitted.chain,
        chain: rcL ? { rigBone: rcL.key, scale: g, head: rcL.head, tail: rcL.tail } : undefined,
        shared: fitted.fit, asym,
        pairSide: pairSideOf(fitted.chain, spec),
        kept: nl + nr,
      });
    } else {
      // NOT mirrorable (the minotaur's prosthetic shin is the case): the
      // skeleton stays one statement — the sides genuinely share a chain,
      // taken from the LEFT rig segment because the mirror block flips the
      // statement's own dir for the right — but the prims are fitted and
      // emitted per side.
      const lf = fitSide(lData!, rcL?.seg ?? null, lDir, image, g);
      const rf = fitSide(rData!, rcR?.seg ?? null, rDir, image, g);
      if (!lf || !rf) { notes.push(`skipped ${spec.name}: a side fell under the evidentiary floor`); continue; }
      if (lf.axisDisagreeDeg !== undefined) reportDisagreement(`${spec.name}.l`, lf.axisDisagreeDeg, lf.fit, notes);
      if (rf.axisDisagreeDeg !== undefined) reportDisagreement(`${spec.name}.r`, rf.axisDisagreeDeg, rf.fit, notes);
      if (lf.degenerate + rf.degenerate > 0)
        notes.push(`${spec.name}: dropped ${lf.degenerate + rf.degenerate} degenerate band(s) — cross-section fit pinched through the axis`);
      built.set(spec.name, {
        spec, line: lf.chain,
        chain: rcL ? { rigBone: rcL.key, scale: g, head: rcL.head, tail: rcL.tail } : undefined,
        l: lf.fit, r: rf.fit, asym,
        pairSide: pairSideOf(lf.chain, spec), kept: nl + nr,
      });
    }
    if (asym.score >= 0.5)
      notes.push(`${spec.name}: NOT mirrored (asym ${asym.score.toFixed(3)}) — prims emitted per side`);
  }

  /** The rig bone whose head->tail joints own a spec's CHAIN line, with the
   *  segment itself — or null where the rig does not map the bone (the
   *  unmapped leaves) or its joints are missing (the same gap that nulls
   *  jointPairDir, which skips the bone below). Same key convention as
   *  collect(): `base` unpaired, `base.l`/`.r` for a pair. */
  /**
   * The chain segment a mapped spec's .blob bone spans, with the rig JOINT
   * NAMES at its ends — or null where the rig does not map the bone.
   *
   * THE BRANCH RULE. `.blob` is a strict chain (a child's head sits at its
   * parent's TAIL) but a rig is a TREE: the legs and the spine both branch
   * at Hips, so the first leg bone's rig head joint sits BELOW its .blob
   * parent's tail. Transcribing each rig bone verbatim leaves the branch
   * stubs unmodelled — the whole leg chain hung one stub too high, which
   * after chain drift was THE residual sole/height error (schoolgirl's
   * soles +0.25 m = Hips→Spine02 + Hips→UpLeg). So a mapped bone whose rig
   * head is not its .blob parent's chain-tail joint EXTENDS: its segment
   * runs from that parent tail joint to its own rig tail joint. The span's
   * endpoints are still rig joints, so len= stays a rig joint-to-joint
   * distance × the one global scale — the acceptance property holds by
   * construction — and the chain lands every JOINT at its rig position (the
   * leg chain reaches the rig's ankle exactly). The spine needs no
   * extension: each spine bone's rig head IS the previous tail. The skull
   * and hand are unmapped leaves and never reach here.
   */
  function rigChainOf(spec2: DraftBoneSpec, side: 'l' | 'r' | null):
    { key: string; seg: { head: Vec3; tail: Vec3 }; head: string; tail: string } | null {
    if (spec2.cloud.kind !== 'rig') return null;
    const key = side === null ? spec2.cloud.base : `${spec2.cloud.base}.${side}`;
    const entry = rig.boneMap[key];
    const seg0 = ref.get(key);
    if (!entry || !seg0) return null;
    // The .blob parent's chain-tail joint: the nearest KEPT mapped ancestor
    // (skipped bones splice out of the .blob chain entirely); the ROOT has
    // none and keeps its own head.
    const parentName = nearestKeptAncestor(spec2.parent);
    const parentChain = parentName ? built.get(parentName)?.chain : undefined;
    const headJoint = parentChain ? parentChain.tail : entry.head;
    if (headJoint === entry.head) return { key, seg: seg0, head: entry.head, tail: entry.tail };
    const head = skin.jointWorld.get(headJoint);
    // A missing parent-tail joint cannot be spanned honestly — no chain, the
    // same gap that nulls refBones and falls back to the cloud line.
    if (!head) return null;
    return { key, seg: { head, tail: seg0.tail }, head: headJoint, tail: entry.tail };
  }

  /** `side=` from the measured lateral offset of the pair's head point past
   *  the parent's tail. The mirror block is symmetric, so the SIGN is
   *  arbitrary — the magnitude is the measurement. `lLine` is the left
   *  side's own axis (the union's head point sits midway between the sides,
   *  on the mirror plane, where it would measure ~0 for every pair). */
  function pairSideOf(lLine: MedialLine | null, spec: DraftBoneSpec): number {
    // null ancestor cannot happen for a pair (its parent chain exists by the
    // time pairs are fitted) — but built.get wants a string, and the runtime
    // behaviour of a miss (parent undefined -> side 0) is the honest fallback.
    const ancestor = nearestKeptAncestor(spec.parent!);
    const parent = ancestor === null ? undefined : built.get(ancestor);
    if (!parent || !lLine) return 0;
    return Math.abs(headPoint(lLine)[0] - tailPoint(parent.line)[0]);
  }

  /** Nearest KEPT ancestor, splicing skipped bones out of the chain: a bone
   *  with no evidence contributes no geometry, but the rig's connectivity
   *  must survive it (the minotaur's neck is empty and its skull must still
   *  hang off the spine). */
  function nearestKeptAncestor(name: string | null): string | null {
    let cur = name;
    while (cur !== null && !built.has(cur)) {
      cur = SPECS.find((s) => s.name === cur)!.parent;
    }
    return cur;
  }

  if (!built.has('pelvis'))
    throw new Error('no pelvis was fitted — there is no root to hang the skeleton from');

  // --- assemble the input -----------------------------------------------------
  const bones: DraftBone[] = [];
  for (const b of built.values()) {
    const parent = nearestKeptAncestor(b.spec.parent);
    bones.push({
      name: b.spec.name, parent, limb: b.spec.limb, line: b.line,
      ...(b.chain ? { chain: b.chain } : {}),
      ...(b.axisFromParent ? { axisFromParent: true } : {}),
      ...(b.spec.name === 'pelvis'
        ? { at: headPoint(b.line)[1] } // the root hangs from its rig head joint; x/z are the parser's [0, at, 0]
        : {}),
      ...(b.pairSide !== undefined ? { pairSide: b.pairSide } : {}),
      ...(b.shared ? { shared: b.shared } : {}),
      ...(b.l && b.r ? { l: b.l, r: b.r, asym: b.asym } : {}),
    });
  }

  const hip = skin.jointWorld.get('LeftUpLeg'), knee = skin.jointWorld.get('LeftLeg'), ankle = skin.jointWorld.get('LeftFoot');
  const stance = hip && knee && ankle
    ? inferStance(vscale(hip, g), vscale(knee, g), vscale(ankle, g))
    : null;

  const skullSpec = SPECS.find((s) => s.name === 'skull')!;
  const headCloud = built.has('skull') ? unmapped.get((skullSpec.cloud as { joint: string }).joint)!.positions : null;

  return {
    input: {
      name: opts.name,
      height,
      bones,
      headCloud,
      stance,
      paint: bodyPaint(allPainted, image),
    },
    notes,
    meshExtent,
    height,
    g,
  };
}

/**
 * The one scale, corrected to the SURFACE.
 *
 * A reference mesh's height is a SURFACE measurement — the crown is skin,
 * not the Head joint — so the draft's height line is one too. But fitPass
 * scales the VERTEX extent to `height`, and the built body is capsules, not
 * vertices: the outermost band at each end adds its radius past the last
 * cloud point (measured on the acceptance fixture: ~4 cm at the sole, ~12 cm
 * at the crown, on a 1.9 m figure — the +5.3% the height acceptance read).
 * The grounding already absorbs the sole side, which is precisely why the
 * whole excess showed up at the crown.
 *
 * Every length and radius in a pass is linear in the one global scale, so
 * ONE corrective ratio is exact, not iterative: re-fit at
 * g · height / builtExtent and the crown and the re-derived grounding both
 * land. The rule is general on purpose — the SURFACE is the requested
 * height, whatever made it stick out — so a horned or hatted character
 * corrects the same way; special-casing the head prim would not.
 *
 * A first pass that does not build cannot be measured; the draft is then
 * emitted at the vertex-extent scale and says so in its notes (the same
 * honesty rule as the emitter's ungrounded case).
 */
function calibrated(
  skin: RefSkin, rig: RigDef, image: RgbImage | null, opts: { name: string; height?: number },
  meshExtent: number, height: number,
): AssembledDraft {
  const first = fitPass(skin, rig, image, opts, meshExtent, height, height / meshExtent);
  let g2: number | null = null;
  try {
    const text = emitDraft(first.input);
    const doc = parseBlob(text);
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    const { min, max } = builtSurfaceY(body.prims);
    const extent = max - min;
    if (Number.isFinite(extent) && extent > 0) {
      const corrected = (height / meshExtent) * (height / extent);
      // Within epsilon of a no-op correction, skip the second pass: the
      // numbers would come out the same, and the returned notes then describe
      // exactly the fits being returned.
      if (Math.abs(corrected / first.g - 1) > 1e-6) g2 = corrected;
    } else {
      first.notes.push('built surface unmeasurable — scale left uncalibrated (vertex-extent scale)');
    }
  } catch {
    first.notes.push('first pass did not build — scale left uncalibrated (vertex-extent scale)');
  }
  if (g2 === null) return first;
  try {
    return fitPass(skin, rig, image, opts, meshExtent, height, g2);
  } catch (e) {
    // The pass differs from the first only by scale; if it still throws,
    // keeping the measured-but-uncorrected draft beats aborting a fit that
    // built fine (the CLI's build report will name the real problem).
    first.notes.push(`calibration pass failed (${(e as Error).message}) — kept the vertex-extent scale`);
    return first;
  }
}
