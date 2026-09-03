// The tool that starts a body FROM the mesh: fit a skinned reference's vertex
// clouds and emit a first-draft .blob on stdout.
//
//   npm run blob:draft -- minotaur > /tmp/minotaur-draft.blob
//   npm run blob:draft -- minotaur --height 1.9
//   npm run blob:draft -- minotaur --glb path/to/mesh.glb
//
// WHY THIS EXISTS. Every character so far was hand-derived, one prim per rig
// bone, exactly as the one before it — the minotaur round that produced this
// plan included, and it was rejected on sight. There was no start-from-mesh
// anywhere in the toolchain. This one reads the reference through the
// existing ref-skin/ref-align path and hands the measurements to
// draft-fit/draft-paint/draft-emit (Tasks 5-9): bone axes are the CLOUDS'
// medial lines, never rig joints (they sit 9-13 cm off the skin); bands
// split at radial inflections; every emitted number carries its `# fit:`
// source. The output is a body you REFINE, not a scaffold you rebuild.
//
// STDOUT IS THE ARTIFACT — pure .blob text, redirect it into
// characters/<name>.blob. Provenance and coverage go to STDERR, which is the
// one deliberate break from blob:rings/blob:depth: those print reports, where
// the `=== mesh` header belongs on stdout; this prints a document a parser
// owns, and the plan's own invocation redirects stdout into a file.
//
// REFERENCE RESOLUTION and EXIT CODES, matching blob-rings exactly: --glb,
// else docs/dev-notes/refs/<name>-mesh/<name>.glb, else the first .glb in
// that directory with a stderr warning. Exit 0 whenever it RAN — the draft
// prints its own debts (bent bones, rotated cross-sections, thin evidence)
// in its header, and a crude draft is information. Exit 2 for "did not run":
// no name, no reference mesh (a plate cannot stand in — there is nothing to
// fit), unreadable mesh or texture, bad --height, or a fit with no root/head
// surface to hang a body from. An agent must never be able to read a failure
// to run as a finished draft.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import type { Vec3 } from '../src/lab/sdf-zombie/types';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { validateBody } from '../src/lab/sdf-zombie/validate';
import { readRefSkin } from '../src/lab/sdf-zombie/ref-skin';
import { detectRig, type RigDef } from '../src/lab/sdf-zombie/ref-align';
import { medialLine, bandCloud, type MedialLine } from '../src/lab/sdf-zombie/draft-fit';
import {
  readRefImage, bandColour, bodyPaint, inferStance, pairAsymmetry,
  type PaintedPt, type RgbImage, type PairAsym,
} from '../src/lab/sdf-zombie/draft-paint';
import { emitDraft, type DraftInput, type DraftBone, type DraftSideFit } from '../src/lab/sdf-zombie/draft-emit';
import { add, dot, normalize, scale as vscale, sub } from '../src/lab/sdf-zombie/vec';

function fail(msg: string): never { console.error(msg); process.exit(2); }

// --- flags ------------------------------------------------------------------
interface Flags { name: string; height?: number; glb?: string }

const VALUE_FLAGS = ['--glb', '--height'];
const USAGE = 'usage: npm run blob:draft -- <name> [--height metres] [--glb <path>]';

/**
 * argv -> Flags. Same shape as blob-depth's parser: a positional is not a
 * flag and not the value of a value-taking flag.
 */
function parseFlags(argv: string[]): Flags {
  const value = (flag: string): string | undefined => {
    const a = argv.find((x) => x === flag || x.startsWith(`${flag}=`));
    if (a === undefined) return undefined;
    return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[argv.indexOf(a) + 1];
  };
  const positional = argv.filter((a, i) => !a.startsWith('--')
    && !VALUE_FLAGS.some((f) => argv[i - 1] === f));
  const name = positional[0];
  if (!name) fail(USAGE);

  const flags: Flags = { name };
  const h = value('--height');
  if (h !== undefined) {
    const n = Number(h);
    // 0 and negatives are scales a body cannot carry; NaN/Infinity are parse
    // noise. All fail here rather than emitting a draft every number of
    // which is silently scaled by them.
    if (!Number.isFinite(n) || n <= 0) fail(`--height must be a positive number of metres, got "${h}"`);
    flags.height = n;
  }
  const glb = value('--glb');
  if (glb !== undefined) flags.glb = glb;
  return flags;
}

// --- reference --------------------------------------------------------------
/** Same ladder as blob-rings/blob-depth (see the header: a plate has no
 *  surface to fit, so there is no plate fallback). */
function resolveMesh(name: string, glbFlag?: string): string {
  if (glbFlag) {
    if (!existsSync(glbFlag)) fail(`missing: ${glbFlag}`);
    return glbFlag;
  }
  const dir = `docs/dev-notes/refs/${name}-mesh`;
  const canonical = `${dir}/${name}.glb`;
  if (existsSync(canonical)) return canonical;
  if (existsSync(dir)) {
    const first = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()[0];
    if (first) {
      console.error(`warning: ${canonical} is missing; drafting against ${dir}/${first}`);
      return `${dir}/${first}`;
    }
  }
  fail(`no reference mesh for ${name}. blob:draft needs a SKINNED mesh to fit — a reference plate `
    + 'has no surface. Expected it under docs/dev-notes/refs/<name>-mesh/.');
}

// --- the draft's bone structure ---------------------------------------------
/**
 * The .blob tree this tool builds, in chain order (parents first). The RIG
 * supplies which joints group each bone's vertices and which way the bone
 * runs; this table supplies only what the rig cannot: the .blob NAMES, the
 * limb cluster each folds into, the tree's parentage, and the order the
 * statements emit in. It carries no measurements.
 *
 * `skull` is not a rig bone (MESHY_BIPED leaves Head unmapped — that is the
 * whole point of draft-paint's unmapped clouds): its cloud is the Head
 * joint's surface, oriented by the rig's neck bone's head->tail joints.
 * `hand` has no joint pair beyond the wrist (Meshy lumps the whole hand into
 * one joint — no fingers are derivable), so its axis is oriented away from
 * the forearm's tail joint instead.
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
}

const SPECS: DraftBoneSpec[] = [
  { name: 'pelvis', parent: null, limb: 'torso', cloud: { kind: 'rig', base: 'pelvis' }, orientBy: 'pelvis' },
  { name: 'spine1', parent: 'pelvis', limb: 'torso', cloud: { kind: 'rig', base: 'spine1' }, orientBy: 'spine1' },
  { name: 'chest', parent: 'spine1', limb: 'torso', cloud: { kind: 'rig', base: 'chest' }, orientBy: 'chest' },
  { name: 'spine2', parent: 'chest', limb: 'torso', cloud: { kind: 'rig', base: 'spine2' }, orientBy: 'spine2' },
  { name: 'neck', parent: 'spine2', limb: 'torso', cloud: { kind: 'rig', base: 'neck' }, orientBy: 'neck' },
  { name: 'skull', parent: 'neck', limb: 'head', cloud: { kind: 'unmapped', joint: 'Head' }, orientBy: 'neck' },
  { name: 'clavicle', parent: 'spine2', limb: 'arm', cloud: { kind: 'rig', base: 'clavicle' }, orientBy: 'clavicle' },
  { name: 'upperarm', parent: 'clavicle', limb: 'arm', cloud: { kind: 'rig', base: 'upperarm' }, orientBy: 'upperarm' },
  { name: 'forearm', parent: 'upperarm', limb: 'arm', cloud: { kind: 'rig', base: 'forearm' }, orientBy: 'forearm' },
  { name: 'hand', parent: 'forearm', limb: 'arm', cloud: { kind: 'unmappedHands' } },
  { name: 'thigh', parent: 'pelvis', limb: 'leg', cloud: { kind: 'rig', base: 'thigh' }, orientBy: 'thigh' },
  { name: 'shin', parent: 'thigh', limb: 'leg', cloud: { kind: 'rig', base: 'shin' }, orientBy: 'shin' },
  { name: 'foot', parent: 'shin', limb: 'leg', cloud: { kind: 'rig', base: 'foot' }, orientBy: 'foot' },
];

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
 * When a cloud's fitted axis sits more than this far from the rig's own
 * growth direction, the cloud is not a LIMB — it is a mass whose principal
 * axis is lateral or fore-aft (a skirt's cone, hair down the back, bilateral
 * hips wider than tall) — and its principal axis is not a bone axis. The
 * axis then falls back to the rig chain's direction, while extent, radii and
 * residual stay the cloud's, and the substitution is noted on stderr.
 *
 * NOT TUNED TO LOOK RIGHT — measured on the two references this tool ships
 * with, where the angle-to-rig distribution has a wide gap:
 *
 *   schoolgirl  chest 41° (ribcage, keeps its cloud axis)
 *   schoolgirl  skull 75°, pelvis 82°, spine1 86°, spine2 88°, neck 89°
 *               (hair, skirt, hips — all fall back)
 *
 * Anything in [42°, 74°] classifies every measured bone identically; 45 is
 * its lower edge ("no more than half-turned"). The joint trap does not
 * apply to the SIGN/DIRECTION the rig encodes in its chain — the trap is
 * about joint POSITIONS sitting 9-13 cm off the skin, and no prim position
 * comes from a joint here. A cloud within the bar keeps its own axis, so
 * ordinary limbs never touch this path (T-pose arms included: their cloud
 * and rig directions agree).
 */
const AXIS_FALLBACK_DEG = 45;

// --- small helpers ----------------------------------------------------------
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

/** A medial line through `positions` along a GIVEN direction — the fallback
 *  axis's line: same centroid, extent and RMS residual the cloud fit would
 *  report, measured along the substituted axis instead of the cloud's own. */
function fitLineAlong(positions: Vec3[], dir: Vec3): MedialLine {
  const origin = centroid(positions);
  let t0 = Infinity, t1 = -Infinity, sumSq = 0;
  for (const p of positions) {
    const q = sub(p, origin);
    const t = dot(q, dir);
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
    sumSq += Math.max(0, dot(q, q) - t * t);
  }
  return { dir, origin, t0, t1, residual: Math.sqrt(sumSq / positions.length) };
}

/** One side's vertex data: paint-ready points, and the bare positions the
 *  fitters want (the same arrays, so the two can never disagree). */
interface SideData { pts: PaintedPt[]; positions: Vec3[] }

/** One side's axis, or null below the evidence floor — the cheap fit, for
 *  when only the line (a `side=` offset) is needed, not the bands. */
function sideLine(data: SideData, anatomical: Vec3): MedialLine | null {
  if (data.positions.length < MIN_BONE_VERTS) return null;
  return orient(medialLine(data.positions), anatomical);
}

/** One side's fit, or null below the evidence floor, plus the diagnostics
 *  the caller turns into notes (this stays a pure function).
 *  `anatomical` is the rig's growth direction: the fitted axis's SIGN test,
 *  and — past AXIS_FALLBACK_DEG — its replacement. */
function fitSide(
  data: SideData, anatomical: Vec3, image: RgbImage | null,
): { fit: DraftSideFit; degenerate: number; axisFromRig: boolean; axisAngleDeg: number } | null {
  if (data.positions.length < MIN_BONE_VERTS) return null;
  const cloudLine = orient(medialLine(data.positions), anatomical);
  const axisAngleDeg = Math.acos(Math.min(1, Math.max(-1, dot(cloudLine.dir, normalize(anatomical))))) * 180 / Math.PI;
  let line: MedialLine;
  let axisFromRig = false;
  if (axisAngleDeg > AXIS_FALLBACK_DEG) {
    line = fitLineAlong(data.positions, normalize(anatomical));
    axisFromRig = true;
  } else {
    line = cloudLine;
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
  return { fit: { line, bands: usableBands, paint: usablePaint }, degenerate, axisFromRig, axisAngleDeg };
}

function centroid(positions: Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const p of positions) { x += p[0]; y += p[1]; z += p[2]; }
  const n = positions.length || 1;
  return [x / n, y / n, z / n];
}

// --- main --------------------------------------------------------------------
function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const glbPath = resolveMesh(flags.name, flags.glb);

  const bytes = new Uint8Array(readFileSync(glbPath));
  // fail() returns never, so these narrow without mutable bindings.
  const skin = (() => {
    try { return readRefSkin(bytes); }
    catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
  })();
  const rig = (() => {
    try { return detectRig([...skin.jointWorld.keys()]); }
    catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
  })();
  // A JPEG texture is a loud gap (draft-paint's own rule), not a silent
  // colourless draft — its throw propagates as exit 2.
  const image = (() => {
    try { return readRefImage(bytes); }
    catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
  })();

  // --- authored height --------------------------------------------------------
  // Default: the skinned figure's own extent. The skinned surface is the
  // measurement — parseGlb's raw POSITION would be wrong by the armature
  // scale on these files, the exact bug ref-skin.ts exists to prevent.
  let minY = Infinity, maxY = -Infinity;
  for (const v of skin.verts) {
    if (v.position[1] < minY) minY = v.position[1];
    if (v.position[1] > maxY) maxY = v.position[1];
  }
  const meshExtent = maxY - minY;
  const height = flags.height ?? meshExtent;
  const g = height / meshExtent;

  // --- the one grouping walk --------------------------------------------------
  // skin.verts are already dominant-weight-filtered (the calibrated rule
  // lives in readRefSkin — never re-derived here). This walk only attributes
  // them the way groupByBone does, carrying each vertex's uv along because
  // the paint pass needs the join; groupByBone itself returns bare
  // positions, and widening it for one loop means touching a file Task 10
  // does not own. Positions are scaled into body space HERE, so every fit
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

  // --- fit each spec ----------------------------------------------------------
  interface Built {
    spec: DraftBoneSpec;
    /** The STATEMENT line: the bone's own (unpaired) or the pair's union
     *  axis — what len=, side= children and the emitted statement carry. */
    line: MedialLine;
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
          fail(`${glbPath}: no root surface (pelvis cloud ${data?.positions.length ?? 0} verts) — there is nothing to hang a skeleton from`);
        if (spec.name === 'skull')
          fail(`${glbPath}: no head surface (Head cloud ${data?.positions.length ?? 0} verts) — the face block rides the skull bone unconditionally`);
        // An unorientable or empty mid-chain bone is skippable; its children
        // re-parent below.
        notes.push(`skipped ${spec.name}: ${data?.positions.length ?? 0} verts — no evidence`);
        continue;
      }
      const fitted = fitSide(data, anatomical, image);
      if (!fitted) { notes.push(`skipped ${spec.name}: ${data.positions.length} verts — no evidence`); continue; }
      if (fitted.axisFromRig)
        notes.push(`${spec.name}: cloud axis ${fitted.axisAngleDeg.toFixed(0)}° off the rig's growth direction — the cloud is not a limb (skirt, hair or bilateral mass); axis taken from the rig chain, radii still the cloud's`);
      if (fitted.degenerate > 0)
        notes.push(`${spec.name}: dropped ${fitted.degenerate} degenerate band(s) — cross-section fit pinched through the axis`);
      if (data.positions.length < THIN_BONE_VERTS)
        notes.push(`thin evidence: ${spec.name} carries only ${data.positions.length} verts — its bands are weak`);
      built.set(spec.name, { spec, line: fitted.fit.line, shared: fitted.fit, kept: data.positions.length });
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
      fail(`${glbPath}: ${spec.name} pair is one-sided (${nl} l verts vs ${nr} r) — a single-sided limb `
        + 'cannot be mirrored or emitted per-side; author it by hand after drafting');
    }
    if (!lDir || !rDir) {
      notes.push(`skipped ${spec.name}: the rig offers no honest axis sign`);
      continue;
    }

    const asym = pairAsymmetry(lData!.positions, rData!.positions);
    // The union cloud, mirrored into one side, is what the SHARED prim must
    // cover — fitting it is the honest shared fit (per-side fits would bake
    // each side's quirks into a prim that exists twice). Its statement axis:
    // the mean of the left direction and the MIRRORED right one — the sides'
    // raw rig directions are mirror images, and averaging them unmirrored
    // cancels the lateral component to ~zero, leaving normalize() to pick an
    // arbitrary axis (measured: a T-posed pair's mean was [~0, …], and the
    // fallback axis came out vertical for a horizontal arm).
    const union: SideData = {
      pts: [...lData!.pts, ...rData!.pts.map(mirrorPt)],
      positions: [...lData!.positions, ...rData!.positions.map((p) => [-p[0], p[1], p[2]] as Vec3)],
    };
    const unionDir: Vec3 = [
      (lDir[0] - rDir[0]) / 2, (lDir[1] + rDir[1]) / 2, (lDir[2] + rDir[2]) / 2,
    ];

    if (asym.mirrorable) {
      const fitted = fitSide(union, unionDir, image);
      if (!fitted) { notes.push(`skipped ${spec.name}: union fit under evidentiary floor`); continue; }
      if (fitted.axisFromRig)
        notes.push(`${spec.name}: cloud axis ${fitted.axisAngleDeg.toFixed(0)}° off the rig's growth direction — axis taken from the rig chain, radii still the cloud's`);
      if (fitted.degenerate > 0)
        notes.push(`${spec.name}: dropped ${fitted.degenerate} degenerate band(s) — cross-section fit pinched through the axis`);
      built.set(spec.name, {
        spec, line: fitted.fit.line, shared: fitted.fit, asym,
        pairSide: pairSideOf(sideLine(lData!, lDir), spec),
        kept: nl + nr,
      });
    } else {
      // NOT mirrorable (the minotaur's prosthetic shin is the case): the
      // skeleton stays one statement — the sides genuinely share a chain —
      // but the prims are fitted and emitted per side.
      const lf = fitSide(lData!, lDir, image), rf = fitSide(rData!, rDir, image);
      if (!lf || !rf) { notes.push(`skipped ${spec.name}: a side fell under the evidentiary floor`); continue; }
      if (lf.axisFromRig || rf.axisFromRig)
        notes.push(`${spec.name}: a side's cloud axis sat >${AXIS_FALLBACK_DEG}° off the rig's growth direction — that side's axis taken from the rig chain, radii still the cloud's`);
      if (lf.degenerate + rf.degenerate > 0)
        notes.push(`${spec.name}: dropped ${lf.degenerate + rf.degenerate} degenerate band(s) — cross-section fit pinched through the axis`);
      const unionLine = orient(medialLine(union.positions), unionDir);
      built.set(spec.name, { spec, line: unionLine, l: lf.fit, r: rf.fit, asym, pairSide: pairSideOf(lf.fit.line, spec), kept: nl + nr });
    }
    if (asym.score >= 0.5)
      notes.push(`${spec.name}: NOT mirrored (asym ${asym.score.toFixed(3)}) — prims emitted per side`);
  }

  /** `side=` from the measured lateral offset of the pair's head point past
   *  the parent's tail. The mirror block is symmetric, so the SIGN is
   *  arbitrary — the magnitude is the measurement. `lLine` is the left
   *  side's own axis (the union's head point sits midway between the sides,
   *  on the mirror plane, where it would measure ~0 for every pair). */
  function pairSideOf(lLine: MedialLine | null, spec: DraftBoneSpec): number {
    const parent = built.get(nearestKeptAncestor(spec.parent!));
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
    fail(`${glbPath}: no pelvis was fitted — there is no root to hang the skeleton from`);

  // --- assemble the input -----------------------------------------------------
  const bones: DraftBone[] = [];
  for (const b of built.values()) {
    const parent = nearestKeptAncestor(b.spec.parent);
    bones.push({
      name: b.spec.name, parent, limb: b.spec.limb, line: b.line,
      ...(b.spec.name === 'pelvis'
        ? { at: headPoint(b.line)[1] } // the root hangs from where its cloud starts; x/z are the parser's [0, at, 0]
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

  // --- coverage on stderr, artifact on stdout ---------------------------------
  console.error(`=== mesh ${glbPath}`);
  console.error(`=== drafting ${flags.name} at ${height.toFixed(3)} m`
    + (flags.height === undefined ? ` (the mesh's own extent; pass --height to override)` : ''));
  console.error(`=== ${skin.total - skin.dropped}/${skin.total} verts kept (${skin.dropped} below dominant weight); rig ${rig.name}`);
  if (unmapped.size) {
    const list = [...unmapped.entries()].sort((a, b) => b[1].positions.length - a[1].positions.length)
      .map(([j, d]) => `${j}(${d.positions.length})`);
    console.error(`=== unmapped joints: ${list.join(', ')}`);
  }
  for (const n of notes) console.error(`=== ${n}`);

  let text: string;
  try {
    text = emitDraft({
      name: flags.name,
      height,
      bones,
      headCloud,
      stance,
      paint: bodyPaint(allPainted, image),
    });
  } catch (e) {
    fail(`${glbPath}: the fit could not be emitted: ${(e as Error).message}`);
  }
  process.stdout.write(text);
  // Build what was just emitted and report it — stderr only, never gating:
  // a first draft that does not yet fuse is information the author needs
  // IMMEDIATELY (before refining), and blob:rings/blob:depth set the same
  // convention of building and warning rather than failing.
  const check = (() => {
    try {
      const body = buildBody(compileBlob(parseBlob(text), compileFace(parseBlob(text))));
      return [...body.errors, ...validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 })];
    } catch (e) { return [`${(e as Error).message}`]; }
  })();
  console.error(`=== draft build: ${check.length} error(s)${check.length ? ' — ' + check.join(' | ') : ''}`);
  process.exit(0);
}

main();
