// draft-emit — turns the Tasks 5-8 measurements into .blob TEXT, inside the
// primitive budget. This is the module the `blob:draft` CLI (Task 10) prints.
//
// THE CONTRACT WITH THE AUTHOR. Every emitted number carries a `# fit:`
// comment naming its source, so the house rule ("every number has a source")
// holds by construction rather than by an author's discipline. What was NOT
// attempted is stated in the output itself (fingers, bend=, angles on
// side/fwd bones), and bones whose fitted axis or cross-section says a hand
// pass is owed are listed in the header — a draft that lies by omission is
// worse than no draft, because it looks finished.
//
// THE BUDGET, AND WHY IT IS NOT validateBody'S JOB. MAX_PRIMS is 128 and
// MAX_CLUSTERS is 6, both of which validateBody errors on — but
// MAX_CLUSTER_PRIMS is 64 and is SILENT: march.wgsl.ts folds a cluster with a
// fixed 64-iteration loop, so prim 65 onward quietly stops existing. Worse,
// MAX_PRIMS counts FLESH AND DERIVED WOUND BONES TOGETHER, and buildBody
// derives ~one bone per substantial band (bone-derive's MASS_FRACTION rule) —
// an 80-band draft can carry 80 derived bones and overflow 128 that way. So
// the draft budgets explicitly: 80 prims / 40 per cluster (half the hard
// ceilings, leaving the author room to add detail), with the derived-bone
// estimate counted against 128. Bands are trimmed least-evidenced-first,
// never a bone's END bands — those own the joints, and a draft whose joints
// gap is broken in a way blob:render-check would spend minutes discovering.
//
// Spec: docs/superpowers/specs/2026-09-02-blobforge-draft-and-depth-design.md.

import type { Vec3 } from './types';
import { DEFAULT_FACE, facePrims } from './face';
import { MAX_PRIMS } from './validate';
import { inferDir, type MedialLine, type Band } from './draft-fit';
import type { BandPaint, BodyPaint, PairAsym, StanceFit, Rgb } from './draft-paint';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { add, dot, scale as vscale, sub } from './vec';

/**
 * The draft's prim ceilings — half the shader's hard ones (128 total, 64 per
 * cluster), so refinement ADDS detail instead of being forced to delete
 * before it can add. Measured shipped characters run 23-67 prims with a worst
 * cluster of 5-27, so 80/40 is a rich draft, not a tight one.
 */
export const DRAFT_BUDGET_TOTAL = 80;
export const DRAFT_BUDGET_CLUSTER = 40;

/**
 * `rotated` above this means the band's cross-section is genuinely turned
 * against the bone axes — the format cannot say it, so the band emits
 * axis-aligned and the header flags the hand pass. This is bandCloud's own
 * aligned-noise bar (draft-fit.test.ts pins it from both sides).
 */
const ROTATED_BAR = 0.25;

/**
 * RMS distance of a cloud from its fitted axis above which the bone reads as
 * CURVED — a straight limb's cloud sits within a centimetre or two of its
 * axis, so 3 cm RMS is a visible bow the draft's straight bones cannot
 * carry. Same judgement as MedialLine.residual's doc: the draft cannot emit
 * `bend=`, so it must at least say which bones want one.
 */
const RESIDUAL_BAR = 0.03;

/** How many prims the face block contributes (it rides `skull` through
 *  compileBlob unconditionally, so it is in every cluster budget). Read off
 *  the real thing rather than a magic constant, so the two cannot drift. */
const FACE_PRIMS = facePrims(DEFAULT_FACE).length;

/** One bone side's prim fit: the line the bands were banded against, the
 *  bands (one authored prim each), and each band's paint. */
export interface DraftSideFit {
  line: MedialLine;
  bands: Band[];
  /** Indexed with `bands` (bandColour's contract). */
  paint: BandPaint[];
  /**
   * Perpendicular displacement of the cloud's centroid off the RIG axis —
   * cloudOffset's answer to rig joints sitting 9-13 cm from the skin. The
   * prim moves to the surface; the BONE stays on the chain, because moving
   * the bone is what breaks len='s placement of every descendant. Absent for
   * unmapped leaves (skull, hands): with no rig axis there is nothing to be
   * off of. The emitter suppresses a measured zero — see bandRec.
   */
  offset?: Vec3;
  /**
   * Present when the cloud's own principal axis sat beyond the CLI's bar off
   * the rig chain's direction. Reported in the bone statement's `# fit:`
   * comment — a real signal (a skirt genuinely does not follow its bone) —
   * and since chain drift it steers nothing.
   */
  axisDisagreeDeg?: number;
}

export interface DraftBone {
  /** Grammar bone name, no .l/.r suffix — the mirror block supplies sides. */
  name: string;
  /** Parent bone name; null for the root (exactly one, bones[0]). */
  parent: string | null;
  /** Limb cluster the bone's prims fold into. arm/leg bones MUST be pairs —
   *  the grammar leaves those limb prims no legal placement otherwise. */
  limb: 'head' | 'torso' | 'arm' | 'leg';
  /** Root only: the height the root bone hangs from (`root <name> at <h>`). */
  at?: number;
  /** Present = a mirrored pair with this lateral offset (`side=`). */
  pairSide?: number;
  /** The bone STATEMENT's line: `len=` from its extent, `dir=` via inferDir.
   *  For an asymmetric pair this is the shared skeleton — the sides' prims
   *  carry their own fits below. */
  line: MedialLine;
  /**
   * Present when `line` is the RIG's chain segment (joint-to-joint × the one
   * global scale) rather than a cloud fit. `.blob`'s skeleton is a rigid
   * chain — a bone's head is its parent's TAIL — so len= places every
   * descendant, and overlapping vertex clouds (thigh and shin both own the
   * knee) do not compose into one. `head`/`tail` are the rig JOINT NAMES the
   * span runs between: a child chain continues from `tail` (the branch rule
   * in draft-skeleton can move `head` up to the parent's tail joint when the
   * rig branches), and the emitted `# fit:` comment names them so the
   * artifact carries its own source. Absent for the unmapped leaves (skull,
   * hands), whose cloud lines place no descendants.
   */
  chain?: { rigBone: string; scale: number; head: string; tail: string };
  /**
   * True for the skull leaf: its line is the CLOUD measured along the
   * PARENT's rig axis (cloudAlongAxis), not the cloud's own principal axis —
   * the head cloud is dominated by hair, whose axis is not the head's
   * (schoolgirl's measured 75° off the neck), and a skull bone leaning
   * sideways steals the crown extent the height line checks.
   */
  axisFromParent?: boolean;
  /** One fit for both sides: unpaired bones and mirrorable pairs. */
  shared?: DraftSideFit;
  /** NOT-mirrorable pairs: per-side prims, emitted `side=l` / `side=r`. */
  l?: DraftSideFit;
  r?: DraftSideFit;
  /** The verdict that chose per-side over shared (pairAsymmetry). */
  asym?: PairAsym;
}

export interface DraftInput {
  /** One word — the `model` line's name token. */
  name: string;
  /** Authored height in metres (the `height` line). */
  height: number;
  /** Chain order: parents before children; bones[0] is the root. */
  bones: DraftBone[];
  /** The unmapped Head cloud (draft-paint's unmappedCloud) — sizes the face
   *  block's cranium. The skull BONE itself is a fit bone like any other. */
  headCloud: Vec3[] | null;
  /** The rig's knee-fold verdict (inferStance); null = omit the line, which
   *  the grammar reads as "not checked" — never as a default stance. */
  stance: StanceFit | null;
  /** Whole-body paint (bodyPaint); null = untextured reference, no palette. */
  paint: BodyPaint | null;
}

/** One authored prim line, held in parts until the budget trim has decided
 *  its fate and its cluster's core mark. */
interface Rec {
  /** The grammar words, no comment, no `core`. */
  words: string;
  /** The trailing comment's text, without the `  # `. */
  comment: string;
  /** Which built clusters this line lands in — its length IS the built-prim
   *  count (a mirrored pair is one line, two prims). */
  clusters: string[];
  /** The band's sample count — the trim's evidence ordering. */
  samples: number;
  /** A bone's FIRST and LAST bands are never trimmed: they own the ends of
   *  the bone, and the ends are where clusters fuse. */
  interior: boolean;
  /** Expanded bone name (thigh.l) — the key deriveBones fattens per. */
  boneKey: string;
  /** This band's radius — the derived-bone estimate reads it. */
  r: number;
  /** The band's 1-based index within its side — the header's owed list names it. */
  bandNo: number;
  /** Flags for the header's hand-pass-owed list. */
  rotated: boolean;
  splitPaint: boolean;
  /** Set post-trim: the first surviving line of each cluster. */
  core?: boolean;
}

/**
 * Formats a measured number: 4 decimals, trailing zeros trimmed. House files
 * read 0.1204 and 1.392, not 0.12040000 — and the `# fit:` comment next to
 * every number is where more precision would live if it were meaningful.
 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`emitDraft: non-finite number ${n} reached formatting`);
  const v = n === 0 ? 0 : n; // kill -0: `pitch=-0` is noise
  let s = v.toFixed(4);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** Even-count median averages the two central values (draft-fit's rule). */
function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Bone length from its line's extent, loud when the cloud has none — a
 *  zero-length bone would parse fine and place nothing, which is exactly the
 *  silent kind of wrong this module exists to prevent. */
function extent(line: MedialLine, name: string): number {
  const e = line.t1 - line.t0;
  if (!(e > 1e-6))
    throw new Error(`emitDraft: bone "${name}" cloud has no extent along its axis — cannot size a bone from it`);
  return e;
}

/** Structural validation of the fit — every check below is something the
 *  grammar or expandMirror would reject LATER and FURTHER from the cause.
 *  Throwing here names the bone and the reason in emit terms. */
function validateInput(input: DraftInput): void {
  if (/\s/.test(input.name))
    throw new Error(`emitDraft: name "${input.name}" must be one word (the model line's name token)`);
  if (input.bones.length === 0) throw new Error('emitDraft: fit has no bones');
  const root = input.bones[0]!;
  if (root.parent !== null) throw new Error('emitDraft: bones[0] must be the root (parent null)');

  const seen = new Set<string>();
  const paired = new Set<string>();
  for (const b of input.bones) {
    if (seen.has(b.name)) throw new Error(`emitDraft: duplicate bone "${b.name}"`);
    seen.add(b.name);
    if (b.parent !== null) {
      // Parents must be DECLARED before their children: the .blob parser
      // resolves `parent=` against bones seen so far, and a chain-order fit
      // is what Task 10's rig walk produces.
      if (!seen.has(b.parent))
        throw new Error(`emitDraft: bone "${b.name}" appears before its parent "${b.parent}" — chain order required`);
      if (paired.has(b.parent) && b.pairSide === undefined)
        throw new Error(`emitDraft: bone "${b.name}" hangs off mirrored bone "${b.parent}" but is not itself a pair — ambiguous side`);
    }
    if (b.pairSide === undefined && (b.limb === 'arm' || b.limb === 'leg'))
      throw new Error(`emitDraft: bone "${b.name}" carries ${b.limb} prims but is not a mirror pair — the grammar has no legal placement for that (limbFor throws)`);
    if (b.pairSide !== undefined) paired.add(b.name);
    const hasShared = b.shared !== undefined;
    const hasSides = b.l !== undefined || b.r !== undefined;
    if (hasShared && hasSides)
      throw new Error(`emitDraft: bone "${b.name}" carries both a shared fit and per-side fits`);
    if (hasSides && (b.l === undefined || b.r === undefined))
      throw new Error(`emitDraft: bone "${b.name}" carries only one side's fit — emit both or neither`);
    if (hasSides && b.asym === undefined)
      throw new Error(`emitDraft: bone "${b.name}" has per-side fits but no asym verdict — record pairAsymmetry's result`);
  }
  // facePrims ride `skull` unconditionally (compileBlob adds them whether or
  // not the draft writes a face block), so a fit without the bone fails at
  // build time with a message about a bone the author never wrote. Fail HERE
  // instead, in emit terms.
  if (!seen.has('skull'))
    throw new Error('emitDraft: no "skull" bone — the face block\'s prims ride it unconditionally');
  extent(root.line, root.name);
}

/**
 * Fraction of the STATEMENT bone a band's cloud-frame t lands at. Bands are
 * measured against the fit's own line (the cloud axis for mapped bones), but
 * the statement places them along the CHAIN segment — which can extend past
 * the cloud, because the branch rule spans a branch-extended thigh from the
 * pelvis joint to the knee while the flesh occupies its lower part. The
 * projection is the frame transfer: from/to are where the flesh IS on the
 * bone, not the cloud's own [0,1] stretched over the bone. Consecutive
 * bands share edges exactly (one projection, t1[i] == t0[i+1]).
 *
 * First and last bands stay PINNED to the bone's ends: they own the joints,
 * and the joints are where clusters fuse — an extended clavicle's flesh
 * starts well out from the neck joint it now grows from, and without the pin
 * nothing bridges torso↔arm (the schoolgirl's spine2 sliver bands can't).
 * The pin places a joint-sized sphere of end-band flesh at the joint, which
 * is the format's own convention (hand-authored files end bones with joint
 * prims the same way); interior bands stay projected, honestly placed.
 */
function bandRange(bone: DraftBone, f: DraftSideFit, i: number, n: number): { from: number; to: number } {
  const e = extent(bone.line, bone.name);
  // lerp(head, tail, f) = origin + dir·(t0 + f·e), so the fraction of a
  // point at axis distance t is (t − t0)/e — the t0 matters on lines whose
  // origin is NOT the bone head (the skull's cloud line is centred on the
  // cloud, t0 < 0), and is 0 on rigLine's.
  const frac = (t: number): number => {
    const p = add(f.line.origin, vscale(f.line.dir, t));
    return Math.min(1, Math.max(0, (dot(sub(p, bone.line.origin), bone.line.dir) - bone.line.t0) / e));
  };
  return { from: i === 0 ? 0 : frac(f.bands[i]!.t0), to: i === n - 1 ? 1 : frac(f.bands[i]!.t1) };
}

/** The prim line for one band. `side` is null for shared/unpaired authoring
 *  (a mirrored pair emits the `mirror` word instead). */
function bandRec(
  bone: DraftBone, f: DraftSideFit, side: 'l' | 'r' | null, i: number, band: Band, paint: BandPaint,
): Rec {
  const n = f.bands.length;
  const { from, to } = bandRange(bone, f, i, n);
  // Blend: a fixed fraction of the band radius, clamped to the range every
  // shipped character uses (0.003-0.013). Not measured — a smoothing constant
  // has no measurement — so the comment owns that it is a convention.
  const blend = Math.min(0.014, Math.max(0.004, band.r * 0.08));
  const mirror = side === null && bone.pairSide !== undefined;
  const label = bone.name + (side ? `.${side}` : '');

  let words = `bar ${bone.limb} on ${bone.name} from=${fmt(from)} to=${fmt(to)} r=${fmt(band.r)}`
    + ` wide=${fmt(band.wide)} deep=${fmt(band.deep)} blend=${fmt(blend)}`;
  // The prim sits where the SURFACE is, not where the joint is — the 9-13 cm
  // joint-vs-skin offset lives HERE, never in the bone's placement (moving
  // the bone is what breaks the chain). A displacement below print resolution
  // is an unmeasured zero, not sub-micron precision: emit no arg rather than
  // `offset=(0,0,0)` noise on every line.
  if (f.offset && Math.max(Math.abs(f.offset[0]), Math.abs(f.offset[1]), Math.abs(f.offset[2])) >= 5e-5)
    words += ` offset=(${fmt(f.offset[0])},${fmt(f.offset[1])},${fmt(f.offset[2])})`;
  if (mirror) words += ' mirror';
  if (side !== null) words += ` side=${side}`;
  if (paint.color) words += ` color=${hex(paint.color)}`;

  const clusters = clustersOf(bone.limb, side);
  let comment = `fit: band ${i + 1}/${n} of the ${label} cloud, ${band.samples} verts`
    + ` — median r, t ${fmt(band.t0)}..${fmt(band.t1)}, blend 8% of r, rot ${fmt(band.rotated)}`;
  let rotated = false;
  let splitPaint = false;
  if (band.rotated > ROTATED_BAR) {
    comment += `; ROTATED ${fmt(band.rotated)} — cross-section turned vs the bone axes; hand pass owed`;
    rotated = true;
  }
  if (paint.bimodal) {
    // A paint boundary IS a primitive boundary in this format — but where it
    // falls inside the band is not derivable from the per-band dominant
    // colour, so the draft flags the split instead of guessing a t. (The
    // spec's "split at the boundary" needs a boundary LOCATION; Task 8 ships
    // a per-band measure, not a location.)
    comment += `; PAINT SPLITS mid-band (split ${fmt(paint.split)}) — colour boundary owed`;
    splitPaint = true;
  }

  return {
    words, comment, clusters, samples: band.samples,
    // First and last bands of each side own the bone's ends — the joints —
    // and are exempt from the budget trim.
    interior: i > 0 && i < n - 1,
    boneKey: label, r: band.r, bandNo: i + 1, rotated, splitPaint,
  };
}

/** Which built clusters one authored line lands in. The array length is the
 *  built-prim count — that identity is what the budget arithmetic runs on. */
function clustersOf(limb: DraftBone['limb'], side: 'l' | 'r' | null): string[] {
  if (limb === 'head') return ['head'];
  if (limb === 'torso') return ['torso'];
  const stem = limb === 'arm' ? 'arm' : 'leg';
  if (side === 'l') return [`${stem}L`];
  if (side === 'r') return [`${stem}R`];
  return [`${stem}L`, `${stem}R`];
}

function hex(c: Rgb): string {
  return c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * buildBody auto-derives wound bones from flesh (bone-derive: one per prim
 * at least half the fattest radius on its expanded bone), and validateBody
 * counts those bones TOGETHER with flesh against MAX_PRIMS. The same rule
 * evaluated on the kept bands gives the exact upper bound of what derivation
 * will add — exact because the containment filter only ever DROPS bones.
 * A mirrored band exists on both sides, so it counts twice.
 *
 * The FACE prims ride `skull` too and are flesh like any other: they take
 * part in skull's mass yardstick and each can derive a bone of its own.
 * Leaving them out kept this estimate below the truth — measured on the
 * first real character through the emitter (the minotaur): its face prims
 * 0.118/0.092 both cleared half of skull's fattest, +2 bones the band-only
 * arithmetic never saw, and the build landed at 130 > 128 while the header
 * claimed inside-budget. facePrims' radii are fixed (they come from
 * DEFAULT_FACE — the draft never tunes them), so reading them here cannot
 * drift from what compileBlob adds.
 */
function derivedEstimate(recs: Rec[]): number {
  const fattest = new Map<string, number>();
  for (const r of recs) fattest.set(r.boneKey, Math.max(fattest.get(r.boneKey) ?? 0, r.r));
  const faceRadii = facePrims(DEFAULT_FACE).map((p) => p.radius);
  fattest.set('skull', Math.max(fattest.get('skull') ?? 0, ...faceRadii));
  let n = 0;
  for (const r of recs) if (r.r >= (fattest.get(r.boneKey) ?? 0) * 0.5) n += r.clusters.length;
  for (const fr of faceRadii) if (fr >= (fattest.get('skull') ?? 0) * 0.5) n++;
  return n;
}

/**
 * Trim kept bands until every budget holds: per-cluster first (the SILENT
 * shader ceiling is per-cluster), then the total, then the derived-bone
 * share of MAX_PRIMS. Victims are the least-evidenced interior bands, ties
 * breaking to the LATER line (keep the earlier-drawn mass). Returns the
 * survivors plus how many were cut and whether the fit could not be brought
 * inside at all (its end bands alone overflow — the header says so loudly,
 * and validateBody will also report it, loudly, at build).
 */
function trimToBudget(recs: Rec[]): { kept: Rec[]; trimmedN: number; over: boolean } {
  const kept = [...recs];
  let trimmedN = 0;
  for (;;) {
    const per = new Map<string, number>();
    let authored = 0;
    for (const r of kept) { authored += r.clusters.length; for (const c of r.clusters) per.set(c, (per.get(c) ?? 0) + 1); }
    let violated: string | null = null;
    for (const [c, n] of per)
      if (n + (c === 'head' ? FACE_PRIMS : 0) > DRAFT_BUDGET_CLUSTER) { violated = c; break; }
    const derived = derivedEstimate(kept);
    if (violated === null && authored + FACE_PRIMS > DRAFT_BUDGET_TOTAL) violated = 'total';
    if (violated === null && authored + FACE_PRIMS + derived > MAX_PRIMS) violated = 'total';
    if (violated === null) return { kept, trimmedN, over: false };

    let victim = -1;
    for (let i = 0; i < kept.length; i++) {
      const r = kept[i]!;
      if (!r.interior) continue;
      if (violated !== 'total' && !r.clusters.includes(violated)) continue;
      if (victim === -1 || r.samples <= kept[victim]!.samples) victim = i;
    }
    if (victim === -1) return { kept, trimmedN, over: true };
    kept.splice(victim, 1);
    trimmedN++;
  }
}

/**
 * Mark each cluster's first surviving line `core` — the structural mass the
 * fuse probe (validateBody's connectivity check) starts from. Done AFTER the
 * trim: a core mark on a band that then got trimmed would leave the cluster
 * probing from a heuristic pick, and the minotaur's shoe-core lesson says
 * that is how a leg starts fusing to the pelvis through open air.
 */
function markCores(kept: Rec[]): void {
  const seen = new Set<string>();
  for (const r of kept) {
    let first = false;
    for (const c of r.clusters) if (!seen.has(c)) { seen.add(c); first = true; }
    if (first) r.core = true;
  }
}

/** The `bone`/`root` statement for one bone, angles only where inferDir says
 *  the grammar can actually carry them. */
function boneStatement(b: DraftBone): string {
  const e = extent(b.line, b.name);
  let words: string;
  if (b.parent === null) {
    if (b.at === undefined)
      throw new Error(`emitDraft: root bone "${b.name}" needs at (the height its head hangs from)`);
    words = `root ${b.name} at ${fmt(b.at)} len=${fmt(e)}`;
  } else {
    const d = inferDir(b.line.dir);
    words = `bone ${b.name} parent=${b.parent}`;
    if (b.pairSide !== undefined && b.pairSide !== 0) words += ` side=${fmt(b.pairSide)}`;
    words += ` dir=${d.dir}`;
    if (d.derivable) {
      // Zero angles are the parser's default — emitting `pitch=0` would be a
      // number whose source is "nothing was measured here".
      if (Math.abs(d.pitchDeg!) >= 0.00005) words += ` pitch=${fmt(d.pitchDeg!)}`;
      if (Math.abs(d.tiltDeg!) >= 0.00005) words += ` tilt=${fmt(d.tiltDeg!)}`;
    }
    words += ` len=${fmt(e)}`;
  }
  const bits: string[] = [];
  // The source phrase is the house rule made local: len=/dir= name what they
  // came from. That changed with chain drift — the rig's segment for mapped
  // bones, the cloud's axis only for the unmapped leaves.
  const source = b.chain
    ? `rig ${b.chain.rigBone} (${b.chain.head}->${b.chain.tail}) joint-to-joint × scale ${fmt(b.chain.scale)} (the chain: overlapping clouds do not compose, the rig does)`
    : b.axisFromParent
      ? `the ${b.name} cloud measured along its parent's rig axis (the hair's principal axis is not the head's)`
      : `medial axis of the ${b.name} cloud`;
  if (b.parent === null) {
    bits.push(`fit: ${source}, extent ${fmt(e)} m`);
  } else {
    const d = inferDir(b.line.dir);
    // On a rig line the residual is the cloud's spread about the RIG axis
    // (rigLine's contract) — say so, or the number reads as a fit residual.
    const residual = b.chain
      ? `residual ${fmt(b.line.residual)} RMS of the cloud about the rig axis`
      : b.axisFromParent
        ? `residual ${fmt(b.line.residual)} RMS of the cloud about the parent rig axis`
        : `residual ${fmt(b.line.residual)} RMS`;
    bits.push(`fit: ${source}, extent ${fmt(e)} m, ${residual}`);
    bits.push(d.derivable
      ? `dir err ${fmt(d.errDeg)}°`
      : `angles not expressible on a ${d.dir} base — the bare base errs ${fmt(d.errDeg)}°`);
    if (b.asym && !b.asym.mirrorable)
      bits.push(`pair NOT mirrored (asym ${fmt(b.asym.score)}) — prims emitted per side`);
    // The old >45° handling substituted the axis and told nobody; now the
    // axis IS the rig's and the disagreement is the report.
    const dis: string[] = [];
    if (b.shared?.axisDisagreeDeg !== undefined) dis.push(`${fmt(b.shared.axisDisagreeDeg)}°`);
    if (b.l?.axisDisagreeDeg !== undefined) dis.push(`l ${fmt(b.l.axisDisagreeDeg)}°`);
    if (b.r?.axisDisagreeDeg !== undefined) dis.push(`r ${fmt(b.r.axisDisagreeDeg)}°`);
    if (dis.length > 0) bits.push(`cloud axis ${dis.join(', ')} off the rig chain — reported, not corrected`);
  }
  return `${words}  # ${bits.join('; ')}`;
}

/**
 * Face block from the unmapped Head cloud: the cranium's size is the cloud's
 * median radial distance, and the per-axis scales put the p98 half-extent of
 * the cloud along each WORLD axis — the face ellipsoid is world-axis-aligned
 * at a point on the skull bone, so its axes are world axes, not the medial
 * line's. Only these four are derivable; jaw/nose/brow keep the defaults and
 * the header says the author owns them.
 */
function faceLines(cloud: Vec3[]): string[] {
  if (cloud.length < 8) return [];
  const n = cloud.length;
  let sx = 0, sy = 0, sz = 0;
  for (const p of cloud) { sx += p[0]!; sy += p[1]!; sz += p[2]!; }
  const c: Vec3 = [sx / n, sy / n, sz / n];
  const R = median(cloud.map((p) => Math.hypot(p[0]! - c[0]!, p[1]! - c[1]!, p[2]! - c[2]!)));
  if (!(R > 1e-6)) return [];
  const p98 = (k: 0 | 1 | 2): number => {
    const ds = cloud.map((p) => Math.abs(p[k]! - c[k]!)).sort((a, b) => a - b);
    return ds[Math.floor(0.98 * (n - 1))]!;
  };
  return [
    `  headRadius ${fmt(R)}  # fit: median radial distance of the Head cloud (${n} verts)`,
    `  headWidth ${fmt(p98(0) / R)}  # fit: p98 half-extent along world x / median radius`,
    `  headHeight ${fmt(p98(1) / R)}  # fit: p98 half-extent along world y / median radius`,
    `  headDepth ${fmt(p98(2) / R)}  # fit: p98 half-extent along world z / median radius`,
  ];
}

/** Palette from the whole-body paint: base colour as LINEAR rgb (the same
 *  sRGB→linear the parser applies to `color=`, inlined here because the
 *  parser keeps its copy private), mottle amplitude off the colour spread. */
function paletteLines(paint: BodyPaint | null): string[] {
  if (!paint?.mean || paint.samples === 0) return [];
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = paint.mean;
  return [
    `  baseColor ${fmt(toLinear(r))} ${fmt(toLinear(g))} ${fmt(toLinear(b))}`
      + `  # fit: mean texel colour of ${paint.samples} samples (sRGB ${Math.round(r)},${Math.round(g)},${Math.round(b)})`,
    `  mottleAmp ${fmt(Math.min(1, paint.spread / 200))}`
      + `  # fit: texel spread RMS ${fmt(paint.spread)} over ${paint.samples} samples`,
  ];
}

/**
 * Emits the draft. The input is the Tasks 5-8 measurement surface — see
 * {@link DraftInput}; the output is .blob text that parses, compiles, builds
 * and validates, with a source on every number and the budget enforced
 * before it leaves this function rather than discovered (or, at the shader's
 * per-cluster ceiling, never discovered) at render time.
 */
export function emitDraft(input: DraftInput): string {
  validateInput(input);

  // —— the body's prim lines, in bone order, sides stacked ——
  const recs: Rec[] = [];
  for (const b of input.bones) {
    if (b.l && b.r) {
      b.l.bands.forEach((band, i) => recs.push(bandRec(b, b.l!, 'l', i, band, b.l!.paint[i] ?? { split: 0, bimodal: false, samples: 0 })));
      b.r.bands.forEach((band, i) => recs.push(bandRec(b, b.r!, 'r', i, band, b.r!.paint[i] ?? { split: 0, bimodal: false, samples: 0 })));
    } else if (b.shared) {
      b.shared.bands.forEach((band, i) => recs.push(bandRec(b, b.shared!, null, i, band, b.shared!.paint[i] ?? { split: 0, bimodal: false, samples: 0 })));
    }
  }

  const { kept, trimmedN, over } = trimToBudget(recs);
  markCores(kept);

  // —— GROUNDING: the chain's one free placement (chain-drift spec, the `root
  // —— ... at` row) — derived so the sole lands at y = 0. Render once with
  // —— the raw rig anchor, BUILD it (the real pipeline, not a re-derivation),
  // —— measure the built body's lowest surface point, and shift the root by
  // —— exactly that error: a root shift moves every prim rigidly (placement
  // —— is parent-relative all the way down), so the grounded body's sole is
  // —— 0 to float precision. A draft whose build fails cannot be measured —
  // —— emit ungrounded and say so; the CLI's own build report names the
  // —— errors, and an unmeasured grounding must never masquerade as a
  // —— measured one.
  const at0 = input.bones[0]!.at;
  let soleShift = 0;
  let extent = NaN;
  if (typeof at0 === 'number') {
    try {
      const first = renderDoc({ ...input }, kept, trimmedN, over, at0, { soleShift: 0, extent: NaN });
      const doc = parseBlob(first);
      const body = buildBody(compileBlob(doc, compileFace(doc)));
      let minY = Infinity, maxY = -Infinity;
      for (const p of body.prims) {
        const r = Math.max(p.radius, p.radiusB ?? p.radius);
        minY = Math.min(minY, p.a[1] - r, p.b[1] - r);
        maxY = Math.max(maxY, p.a[1] + r, p.b[1] + r);
      }
      if (Number.isFinite(minY)) {
        soleShift = -minY; // the root shift that lands the sole at 0
        extent = maxY - minY; // shift-invariant, so the first build's value stands
      }
    } catch { /* unbuildable draft: emitted ungrounded, header says so */ }
  }

  return renderDoc(
    input, kept, trimmedN, over,
    typeof at0 === 'number' ? at0 + soleShift : at0,
    { soleShift, extent },
  );
}

function renderDoc(
  input: DraftInput, kept: Rec[], trimmedN: number, over: boolean,
  rootAt: number | undefined,
  chain: { soleShift: number; extent: number },
): string {

  // —— header: what this is, what it did not attempt, the budget, the debts ——
  const head: string[] = [];
  // The root statement reads `at` off bones[0]; thread the (possibly
  // grounded) height through a copy rather than mutating the caller's input.
  const bones: DraftBone[] = rootAt === undefined
    ? input.bones
    : input.bones.map((b, i) => (i === 0 ? { ...b, at: rootAt } : b));
  input = { ...input, bones };
  head.push('# ' + '='.repeat(76));
  head.push(`# ${input.name} — FIRST-DRAFT .blob generated from the reference mesh's vertex`);
  head.push('# clouds. Every number is measured; its line\'s `# fit:` comment names the');
  head.push('# source. Bone axes are cloud medial lines, never rig joints (they sit 9-13');
  head.push('# cm off the skin); bands split at radial-profile inflections; radii are band');
  head.push('# medians; angles exist only where dirVector is invertible.');
  head.push('#');
  head.push('# NOT attempted — not derivable from a Meshy reference; add by hand:');
  head.push('#   fingers (the rig lumps each hand into one joint), bend= on any bone,');
  head.push('#   angles on side/fwd bones, mottle colour, jaw/nose/brow shaping.');
  head.push('#');

  const per = new Map<string, number>();
  let authored = 0;
  for (const r of kept) { authored += r.clusters.length; for (const c of r.clusters) per.set(c, (per.get(c) ?? 0) + 1); }
  let worst = 'torso', worstN = 0;
  for (const [c, n] of per) {
    const total = n + (c === 'head' ? FACE_PRIMS : 0);
    if (total > worstN) { worstN = total; worst = c; }
  }
  head.push(`# Budget: ${authored + FACE_PRIMS}/${DRAFT_BUDGET_TOTAL} prims (${authored} authored + ${FACE_PRIMS} face),`);
  head.push(`# worst cluster ${worst} at ${worstN}/${DRAFT_BUDGET_CLUSTER}. The shader's hard ceilings are`);
  head.push(`# ${MAX_PRIMS} prims total — which derived wound bones SHARE — and 64 per cluster,`);
  head.push('# where the fold SILENTLY stops; half of each is left for refinement.');
  if (trimmedN === 0) {
    head.push('# Nothing was trimmed.');
  } else {
    head.push(`# TRIMMED ${trimmedN} least-evidenced band(s) to stay inside. Re-run the draft after`);
    head.push('# refining so any cut you undo is re-measured, not silently restored.');
  }
  if (over) {
    head.push('# WARNING: the fit could not be brought inside budget even trimming every');
    head.push('# expendable band — delete bands BY HAND before building, or geometry will be');
    head.push('# lost silently at the fold.');
  }
  head.push('#');
  // The acceptance numbers, on the artifact itself: the chain closed, and a
  // reader can see it without running a test (chain-drift plan, task 3).
  // `soleShift` 0 with a finite extent means the raw anchor already landed
  // the soles at 0 — reported as measured, not suppressed.
  if (Number.isFinite(chain.extent)) {
    const pct = (chain.extent / input.height - 1) * 100;
    head.push(`# Chain: grounded — the root shifted ${fmt(chain.soleShift)} m so the built body's`);
    head.push(`# lowest surface sits at y = 0; built extent ${fmt(chain.extent)} m against the`);
    head.push(`# ${fmt(input.height)} m height line (${pct >= 0 ? '+' : ''}${fmt(pct)}%).`);
  } else {
    head.push('# Chain: NOT grounded — the draft did not build, so the sole could not be');
    head.push('# measured; at= is the raw rig anchor. See the build report below/at the CLI.');
  }
  head.push('#');

  // The hand pass owed: bent axes, turned cross-sections, split paints.
  head.push('# Hand pass owed:');
  let owed = 0;
  for (const b of input.bones) {
    if (b.line.residual > RESIDUAL_BAR) {
      head.push(`#   ${b.name}: cloud residual ${fmt(b.line.residual)} m RMS about its axis — wants a bend=`);
      owed++;
    }
  }
  for (const r of kept) {
    if (r.rotated) {
      head.push(`#   ${r.boneKey} band ${r.bandNo}: rotated cross-section — the axes cannot say it`);
      owed++;
    }
    if (r.splitPaint) {
      head.push(`#   ${r.boneKey} band ${r.bandNo}: paint splits mid-band — colour boundary owed`);
      owed++;
    }
  }
  if (owed === 0) head.push('#   none — every cloud fit its axis and its paint');
  head.push('#');
  head.push(`# Then bake the face:  # run: npm run blob:face-bake -- ${input.name}`);
  head.push(`# Refine with npm run blob:rings -- ${input.name}; judge with blob:measure and`);
  head.push(`# npm run blob:depth -- ${input.name} (the instrument that sees inside the outline).`);
  head.push('# ' + '='.repeat(76));

  // —— the document ——
  const out: string[] = [...head, '', `model ${input.name}`];
  out.push(`  height ${fmt(input.height)}  # fit: requested authored height`);
  if (input.stance) {
    const fo = input.stance.forwardOffset;
    out.push(`  stance ${input.stance.stance}  # fit: knee ${fmt(Math.abs(fo))} m ${fo >= 0 ? 'forward of' : 'behind'} the hip-ankle line`);
  }

  out.push('', 'skeleton');
  const unpaired = input.bones.filter((b) => b.pairSide === undefined);
  const paired = input.bones.filter((b) => b.pairSide !== undefined);
  for (const b of unpaired) out.push('  ' + boneStatement(b));
  if (paired.length > 0) {
    out.push('  mirror');
    for (const b of paired) out.push('    ' + boneStatement(b));
    out.push('  end');
  }

  out.push('', 'body');
  for (const r of kept) {
    out.push(`  ${r.words}${r.core ? ' core' : ''}${r.comment ? '  # ' + r.comment : ''}`);
  }

  const face = faceLines(input.headCloud ?? []);
  if (face.length > 0) out.push('', 'face', ...face);

  // The draft never paints a face (three dispatches proved agents cannot);
  // it wires the sheet so the author's one step is running the bake.
  out.push('', `# run: npm run blob:face-bake -- ${input.name}`, 'sheet');
  out.push(`  image ${input.name}-face.png  # fit: pre-wired — the bake writes this file`);
  out.push('  decal 1  # fit: pre-wired — pastes the baked sheet onto the cranium');

  const palette = paletteLines(input.paint);
  if (palette.length > 0) out.push('', 'palette', ...palette);

  return out.join('\n').trimEnd() + '\n';
}
