// The instrument that sees INSIDE the outline: front and side surface-depth
// diffs between a compiled .blob and its reference mesh.
//
//   npm run blob:depth -- minotaur
//   npm run blob:depth -- minotaur --json
//   npm run blob:depth -- minotaur --glb path/to/mesh.glb
//   npm run blob:depth -- minotaur --bands 24
//
// WHY THIS EXISTS. blob:measure scores a silhouette and blob:rings fits a
// radial average per bone, and between them they own every check the
// minotaur passed before it was rejected on sight — nine test pins green,
// rings converged, IoU fine — with a torso that was a featureless drum. A
// smooth cylinder and a heavily muscled torso of equal average girth are the
// same outline and the same radial average; the pecs, the waist and the
// traps live strictly inside the outline, where neither tool looks. This one
// does: both rasters from silhouette.ts carry the per-pixel hit depth the
// silhouette path always computed and threw away, and depth-diff.ts is the
// comparison. It reports only where BOTH sides occupy the outline — a pixel
// one side fills alone is a silhouette difference, which blob:measure
// reports and reports better, and double-reporting it here would drown the
// relief signal this tool exists for.
//
// READING signedErr. Depth is re-zeroed at each side's own depth midpoint
// (the depth analogue of normalise mapping each mask to its own box — raw
// metres would report every band a fake constant equal to wherever the GLB's
// exporter put the z origin). So a band's signed error is a SHAPE statement:
// positive = the body's surface bulges nearer the camera than the mesh's;
// negative = the mesh has depth the body lacks — the missing pecs, the waist
// the drum ignored. Absolute surface position is deliberately unmeasurable.
//
// NO KIT IS PASSED, and that is a measured choice, not an omission: a kit is
// a polygon overlay with no SDF field behind it, so its pixels carry NaN
// depth and diffDepth's both-finite rule would skip them — passing the kit
// would narrow the report to bare-flesh pixels. Without it, a dressed
// character's clothed regions compare the body's field surface against the
// mesh's cloth surface, and that cloth thickness reads as error in exactly
// the bands the clothing covers. Read those bands with that in mind; the
// minotaur — the case this tool was built for — has no kit at all.
//
// REFERENCE RESOLUTION and EXIT CODES, matching blob-rings exactly: --glb,
// else docs/dev-notes/refs/<name>-mesh/<name>.glb, else the first .glb in
// that directory with a stderr warning. Exit 0 whenever it RAN, however bad
// the numbers — a bad score is information. Exit 2 for "did not run": no
// .blob, no reference mesh (a plate cannot stand in — this tool diffs depth,
// and a plate has none), unreadable mesh. An agent must never be able to
// read a failure to run as a perfect surface.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { parseGlb, gltfTriangles, depthFromBody, depthFromTriangles } from '../src/lab/sdf-zombie/silhouette';
import { diffDepth } from '../src/lab/sdf-zombie/depth-diff';
import type { BuiltBody } from '../src/lab/sdf-zombie/types';
import type { DepthDiffBand, DepthDiffOpts } from '../src/lab/sdf-zombie/depth-diff';

/** Print the reason and exit 2 — "did not run", never a score. */
function fail(msg: string): never { console.error(msg); process.exit(2); }

/**
 * Warn past this mesh:body DEPTH-SPAN ratio (either direction). The whole
 * diff is whole-figure — unlike blob:rings it has no per-bone alignment to
 * absorb the reference's pose — so a reference posed differently from the
 * body (arms out in a T/A-pose is the common case) puts its mass where the
 * body has none along the depth axis, and the per-band offsets become about
 * the pose, not the sculpt. Schoolgirl measures 3.3x in side view (arms out
 * along x) and 0.94 in front; the mouse, blob:measure's own pose-dominated
 * case, reads ~1.8 in both. 1.25 sits below those and above the front views
 * of characters whose poses agree, where the span disagreement costs each
 * pixel less than the relief errors being reported. It is an honesty label,
 * not a gate: the numbers still print (exit 0), each with the warning.
 */
const SPAN_RATIO_WARN = 1.25;
/** Where the low-res span probe rasters — 1/4 the real pass's linear size,
 *  ~1/100 the pixels, since the probe only needs the subject's extent. */
const SPAN_PROBE_PX = 64;

/**
 * RAW world depth spans (before normalise maps each subject to its own box)
 * at probe resolution, and their ratio. Both rasters' depth axes are the
 * view's depth axis (front: world z, side: world x), so a span is literally
 * how deep the subject sits in the world — the quantity a pose mismatch
 * inflates.
 */
function spanProbe(body: BuiltBody, tris: Float32Array, view: 'front' | 'side') {
  const span = (d: Float32Array): number => {
    let min = Infinity, max = -Infinity;
    for (const v of d) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    return max - min;
  };
  const b = span(depthFromBody(body, { view, heightPx: SPAN_PROBE_PX }).depth);
  const m = span(depthFromTriangles(tris, { view, heightPx: SPAN_PROBE_PX }).depth);
  return { body: b, mesh: m, ratio: m / b, poseSuspect: Math.max(m / b, b / m) > SPAN_RATIO_WARN };
}

// --- flags ------------------------------------------------------------------
interface Flags { name: string; json: boolean; bands?: number; glb?: string }

const VALUE_FLAGS = ['--glb', '--bands'];
const USAGE = 'usage: npm run blob:depth -- <character> [--json] [--bands n] [--glb <path>]';

/**
 * argv -> Flags, rejecting a band count that cannot be measured. Same shape
 * as blob-measure's parser: a positional is not a flag and not the value of
 * a value-taking flag, so `--glb x.glb mouse` still resolves the name right
 * (blob-rings' `first non--- token` rule picks the glb path up as the name
 * when the flags come first).
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

  const flags: Flags = { name, json: argv.includes('--json') };

  const bandsVal = value('--bands');
  if (bandsVal !== undefined) {
    const n = Number(bandsVal);
    if (!Number.isInteger(n) || n < 1)
      fail(`--bands must be a positive integer, got "${bandsVal}"`);
    flags.bands = n;
  }

  const glb = value('--glb');
  if (glb !== undefined) flags.glb = glb;
  return flags;
}

// --- reference --------------------------------------------------------------
/**
 * The canonical mesh for a character is `refs/<name>-mesh/<name>.glb`, then
 * the first .glb sorted with a loud stderr note, then nothing — this tool
 * has no plate fallback because a plate has no depth to diff.
 */
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
      console.error(`warning: ${canonical} is missing; scoring against ${dir}/${first}`);
      return `${dir}/${first}`;
    }
  }
  fail(`no reference mesh for ${name}. blob:depth needs a MESH — a reference plate `
    + 'has no depth to diff. Expected it under docs/dev-notes/refs/<name>-mesh/.');
}

// --- output -----------------------------------------------------------------
const mm = (v: number) => `${(v * 1000).toFixed(1)}mm`;
const signed = (v: number) => `${v >= 0 ? '+' : ''}${(v * 1000).toFixed(1)}mm`;

/**
 * One band row: height span, magnitudes, sample count, and the `.blob` line
 * that owns the band's height — printed the way blob:rings names its blocks
 * (`<name>.blob:<line>`), so the report is a list of lines to edit without a
 * lookup step. A band with no owner is said so out loud: silence there would
 * read as an unnamed culprit rather than "the field has no say at this
 * height" (a TS-authored face prim, or nobody — an unsampled band).
 */
function bandLine(name: string, b: DepthDiffBand): string {
  const span = `y ${b.y0.toFixed(3)}-${b.y1.toFixed(3)}`;
  const stats = `mean ${mm(b.meanErr).padStart(9)}   signed ${signed(b.signedErr).padStart(9)}   n ${String(b.samples).padStart(6)}`;
  // Unpadded, exactly as blob-rings names its blocks (mouse.blob:538) —
  // agents grep this format.
  const owner = b.owner
    ? `${name}.blob:${b.owner.line}  ${b.owner.label}`
    : '(no .blob line — a TS-authored prim owns this height, or nobody does)';
  return `    ${span}   ${stats}   ${owner}`;
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const { name, json } = flags;

  const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
  if (!existsSync(blobPath)) fail(`no such character: ${blobPath}`);
  const glbPath = resolveMesh(name, flags.glb);

  const doc = parseBlob(readFileSync(blobPath, 'utf8'));
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  // blob-rings' convention, not blob-measure's: a body with build errors
  // still compiles to prims and still measures — the numbers warn about
  // themselves in the report rather than costing the run.
  if (body.errors.length) console.error(`warning: body has ${body.errors.length} build error(s); numbers may be meaningless`);

  // fail() returns never, so this narrows without a mutable binding.
  const tris = (() => {
    try {
      const { json: gltf, bin } = parseGlb(readFileSync(glbPath));
      return gltfTriangles(gltf as Parameters<typeof gltfTriangles>[0], bin);
    } catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
  })();

  // Both views, every time: the torso relief this tool exists to see is a
  // front-view story, but a blade, a tail or a prosthetic strut is often
  // visible from the side alone — one view would half-blind the report.
  const opts = (view: 'front' | 'side'): DepthDiffOpts =>
    ({ view, ...(flags.bands ? { bands: flags.bands } : {}) });
  const front = diffDepth(body, tris, opts('front'));
  const side = diffDepth(body, tris, opts('side'));
  const views = [
    { view: 'front' as const, ...front, ...spanProbe(body, tris, 'front') },
    { view: 'side' as const, ...side, ...spanProbe(body, tris, 'side') },
  ];

  if (json) {
    console.log(JSON.stringify({
      character: name,
      mesh: glbPath,
      triangles: tris.length / 9,
      bands: flags.bands ?? 16,
      errors: body.errors,
      views: views.map(({ body: bodySpan, mesh: meshSpan, ratio, poseSuspect, ...rest }) =>
        ({ ...rest, depthSpan: { body: bodySpan, mesh: meshSpan, ratio }, poseSuspect })),
    }, null, 2));
    process.exit(0);
  }

  console.log(`=== mesh ${glbPath}   (${(tris.length / 9).toLocaleString()} triangles)`);
  console.log(`${name}   built from ${blobPath}`);
  console.log();
  console.log('  Scores the pixels where BOTH the body and the mesh agree the outline exists,');
  console.log('  on DEPTH: the relief an outline (blob:measure) and a radial average');
  console.log('  (blob:rings) cannot see. One-sided pixels are silhouette, not depth, and are');
  console.log('  skipped. Each side is re-zeroed at its own depth midpoint, so signedErr is a');
  console.log('  SHAPE statement, not a position: positive = the body bulges nearer the camera');
  console.log('  than the mesh; negative = the mesh has depth the body lacks — the missing');
  console.log('  pecs, the waist a drum ignored. No kit is passed: clothed bands read the');
  console.log('  cloth thickness as error (see the header of scripts/blob-depth.ts).');
  for (const v of views) {
    console.log();
    console.log(`=== ${v.view} view   mean ${mm(v.meanErr)}   signed ${signed(v.signedErr)}   `
      + `over ${v.samples.toLocaleString()} both-occupied pixels`);
    if (v.poseSuspect) {
      console.log(`  POSE-DOMINATED: the mesh's depth extent here is ${v.ratio.toFixed(1)}x the body's — a reference`);
      console.log('  posed differently from the body (arms out is the common case) puts its mass where the body');
      console.log('  has none along the depth axis, and these bands are about the POSE, not the sculpt. Read the');
      console.log('  other view first; in this one, trust a band only as a before/after for one edit.');
    }
    console.log('  worst height bands, worst first (band = fraction of subject height, 0 = crown):');
    for (const b of v.bands) console.log(bandLine(name, b));
  }
  process.exit(0);
}

main();
