// One command, every number an agent needs to decide what to change next.
//
//   npm run blob:measure -- mouse
//   npm run blob:measure -- mouse --json           # machine-readable, for agents
//   npm run blob:measure -- mouse --side
//   npm run blob:measure -- mouse --range 0.75:1   # legs + shoes only
//   npm run blob:measure -- mouse --bands 24
//   npm run blob:measure -- goblin --plate docs/dev-notes/refs/goblin-reference.png
//   npm run blob:measure -- mouse --glb path/to/mesh.glb
//
// WHY THIS EXISTS. silhouette-match scores a .blob against ONE plate and
// prints a band table; reading it, you still have to guess which line of the
// .blob owns a bad band, and guessing is where the last three passes went
// wrong. This is its successor: the same raster, but it names the OWNER of
// every band it complains about, so the output is literally a list of lines to
// edit, worst first. That list is the point — the IoU is only there to tell
// you whether the list is worth working through.
//
// REFERENCE RESOLUTION, in order: 1. --glb  2. the canonical
// docs/dev-notes/refs/<name>-mesh/<name>.glb, falling back to the first .glb
// sorted if that exact file is missing (and saying so)  3. --plate, else
// docs/dev-notes/refs/<name>-reference.png. When both exist, both are reported.
//
// A MESH IS PREFERRED, BUT NOT BECAUSE IT SCORES BETTER. It is preferred
// because it can be measured LOCALLY — a width at a named height, a head
// profile, a real 3D extent — and because it carries no drawing distortion,
// no foreshortening and no artist's licence. What it does NOT do is escape
// pose: a mesh is sculpted in SOME pose just as a plate is drawn in one, and
// the maus mesh holds its arms straight out while the .blob rests them at
// ~47 degrees. Whenever the arm poses differ, the whole-figure score is
// dominated by that difference and says almost nothing about the sculpt —
// exactly the trap the plate sets (see the caveat in silhouette.ts).
//
// SO: score a `--range` window where the poses agree (`--range 0.75:1` is legs
// and shoes, where nothing is posed) and act on THOSE bands. Read a
// whole-figure IoU only as a before/after gradient for one character against
// one reference, never as a target to optimise and never across characters.
// This command says so out loud when it detects the mismatch.
//
// EXIT CODES. 0 whenever it ran, however bad the score — a bad score is
// information. 2 for "did not run": no .blob, no reference, or build errors.
// An agent must never be able to read a failure to run as a score of zero.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import type { BuildResult } from '../src/lab/sdf-zombie/build-body';
import { decodePng } from '../src/lab/sdf-zombie/png-decode';
import {
  maskFromRgba, maskFromBody, maskFromTriangles, compareSilhouette, bandOwners,
  renderMask, parseGlb, gltfTriangles,
} from '../src/lab/sdf-zombie/silhouette';
import type {
  BandOwner, BandReport, Mask, SilhouetteReport,
} from '../src/lab/sdf-zombie/silhouette';

/** Print the reason and exit 2 — "did not run", never a score. */
function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

// --- flags ------------------------------------------------------------------
interface Flags {
  name: string;
  view: 'front' | 'side';
  json: boolean;
  bands?: number;
  range?: [number, number];
  glb?: string;
  plate?: string;
}

const VALUE_FLAGS = ['--range', '--bands', '--plate', '--glb'];
const USAGE = 'usage: npm run blob:measure -- <character> [--json] [--side] '
  + '[--range lo:hi] [--bands n] [--plate ref.png] [--glb ref.glb]';

/**
 * argv -> Flags, REJECTING a window that cannot be measured.
 *
 * A NaN range is the dangerous input: `--range 0.75:` parses to [0.75, NaN],
 * compareSilhouette clamps it into some window anyway, and the command happily
 * prints a confident score for rows nobody asked about. An agent acting on that
 * number edits the wrong lines. Every bad window exits 2 instead.
 */
function parseFlags(argv: string[]): Flags {
  const value = (flag: string): string | undefined => {
    const a = argv.find((x) => x === flag || x.startsWith(`${flag}=`));
    if (a === undefined) return undefined;
    return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[argv.indexOf(a) + 1];
  };
  // Positional = not a flag, and not the value of a value-taking flag.
  const positional = argv.filter((a, i) => !a.startsWith('--')
    && !VALUE_FLAGS.some((f) => argv[i - 1] === f));
  const name = positional[0];
  if (!name) fail(USAGE);

  const flags: Flags = {
    name,
    view: argv.includes('--side') ? 'side' : 'front',
    json: argv.includes('--json'),
  };

  const bandsVal = value('--bands');
  if (bandsVal !== undefined) {
    const n = Number(bandsVal);
    if (!Number.isInteger(n) || n < 1)
      fail(`--bands must be a positive integer, got "${bandsVal}"`);
    flags.bands = n;
  }

  const rangeVal = value('--range');
  if (rangeVal !== undefined) {
    const parts = rangeVal.split(':');
    const lo = Number(parts[0]), hi = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(lo) || !Number.isFinite(hi)
      || lo < 0 || hi > 1 || lo >= hi)
      fail(`--range must be lo:hi with 0 <= lo < hi <= 1, got "${rangeVal}"`);
    flags.range = [lo, hi];
  }

  const glb = value('--glb');
  if (glb !== undefined) flags.glb = glb;
  const plate = value('--plate');
  if (plate !== undefined) flags.plate = plate;
  return flags;
}

// --- references -------------------------------------------------------------
interface RefSource { kind: 'mesh' | 'plate'; path: string }

/**
 * The canonical mesh for a character is `refs/<name>-mesh/<name>.glb` — the
 * one every measurement (head-profile.ts included) is meant to be taken
 * against. Fall back to the first .glb sorted only when that exact file is
 * missing, and say which one was picked: silently landing on a texture-only
 * or animation-merge export (extra files the README says stay untracked
 * anyway) produces numbers nobody asked for.
 */
function resolveMeshPath(name: string, meshDir: string): string | undefined {
  const canonical = `${meshDir}/${name}.glb`;
  if (existsSync(canonical)) return canonical;
  if (!existsSync(meshDir)) return undefined;
  const glb = readdirSync(meshDir).filter((f) => f.endsWith('.glb')).sort()[0];
  if (!glb) return undefined;
  console.error(`no ${name}.glb under ${meshDir}/ — falling back to ${glb}`);
  return `${meshDir}/${glb}`;
}

/** The references to score against, in the order documented at the top. */
function resolveSources(name: string, flags: Flags): RefSource[] {
  const sources: RefSource[] = [];
  const meshDir = `docs/dev-notes/refs/${name}-mesh`;
  if (flags.glb) {
    if (!existsSync(flags.glb)) fail(`missing: ${flags.glb}`);
    sources.push({ kind: 'mesh', path: flags.glb });
  } else {
    const mesh = resolveMeshPath(name, meshDir);
    if (mesh) sources.push({ kind: 'mesh', path: mesh });
  }
  // A plate is a FRONT drawing. Scored as a side view it is nonsense (the
  // mouse plate read 0.363 "side" IoU against a sculpt that matched its mesh
  // at 0.856), so --side skips plates and says so — pass --glb for a profile.
  if (flags.plate) {
    if (!existsSync(flags.plate)) fail(`missing: ${flags.plate}`);
    if (flags.view === 'side') console.error(`--side ignores the plate ${flags.plate}: plates are front views`);
    else sources.push({ kind: 'plate', path: flags.plate });
  } else if (flags.view !== 'side') {
    const plate = `docs/dev-notes/refs/${name}-reference.png`;
    if (existsSync(plate)) sources.push({ kind: 'plate', path: plate });
  }
  if (!sources.length)
    fail(`no reference for ${name}: expected a .glb under ${meshDir}/ or a plate at `
      + `docs/dev-notes/refs/${name}-reference.png (or pass --glb/--plate)`);
  return sources;
}

/** A reference's silhouette, plus the one-line provenance the text output shows. */
function refMask(src: RefSource, view: 'front' | 'side'): { mask: Mask; note: string } {
  if (src.kind === 'mesh') {
    const { json: gltf, bin } = parseGlb(readFileSync(src.path));
    const tris = gltfTriangles(gltf as Parameters<typeof gltfTriangles>[0], bin);
    return {
      mask: maskFromTriangles(tris, { view, heightPx: 256 }),
      note: `${tris.length / 9} triangles`,
    };
  }
  const png = decodePng(readFileSync(src.path));
  const r = maskFromRgba(png.rgba, png.width, png.height);
  return {
    mask: r.mask,
    note: `${png.width}x${png.height}  blobs=${r.components}  `
      + `coverage=${(r.coverage * 100).toFixed(1)}%  backdrop=rgb(${r.background})`,
  };
}

// --- scoring ----------------------------------------------------------------
interface JsonWorst extends BandReport { band: number; owner: BandOwner | null }
interface JsonRef {
  kind: 'mesh' | 'plate'; path: string; view: string;
  iou: number; meanWidthError: number; poseMismatch: boolean; worst: JsonWorst[];
  /** Mean row-to-row outline width change (fraction of height): ours vs the
   *  reference. `stacked` when ours jumps more than twice the reference's —
   *  the bands cannot tell a stack of discs from a smooth taper; this can. */
  rowJerk: { ref: number; got: number; stacked: boolean };
}

/**
 * Is this score about the SCULPT, or about the pose?
 *
 * Two symptoms, either of which is enough. A whole-figure aspect ratio that
 * disagrees by more than 15% means the two silhouettes occupy differently
 * shaped boxes, which arms out versus arms down does and a proportion error
 * inside a limb does not. A single band off by more than a quarter of the
 * subject's height is the same thing seen locally: no sculpting mistake
 * survives review at that magnitude, but a raised arm produces it instantly.
 */
const POSE_ASPECT_TOL = 0.15;
const POSE_BAND_TOL = 0.25;

interface ScoreOpts {
  view: 'front' | 'side';
  got: Mask;
  kit?: Float32Array;
  bands?: number;
  range?: [number, number];
}
interface Scored { record: JsonRef; rep: SilhouetteReport; owners: BandOwner[]; ref: Mask; note: string }

/** Everything measurable about one reference, and NOTHING printed — so the
 *  text and the JSON are two renderings of one result rather than two paths
 *  that can drift. */
function scoreRef(body: BuildResult, src: RefSource, opts: ScoreOpts): Scored {
  const { mask: ref, note } = refMask(src, opts.view);
  const rep = compareSilhouette(ref, opts.got, {
    ...(opts.range ? { range: opts.range } : {}), ...(opts.bands ? { bands: opts.bands } : {}),
  });
  // Same kit, same range, same band count — that is what makes band i mean the
  // same height in both, and the pairing below a fact rather than a guess.
  const owners = bandOwners(body, {
    view: opts.view, bands: rep.bands.length,
    ...(opts.kit ? { kit: opts.kit } : {}), ...(opts.range ? { range: opts.range } : {}),
  });
  // The aspects are WHOLE-figure whatever window was scored, so the aspect
  // symptom only speaks for a whole-figure score; inside a `--range` the band
  // symptom is the only one that is about the rows actually being compared.
  const aspectOff = rep.refAspect > 0
    ? Math.abs(rep.refAspect - rep.gotAspect) / rep.refAspect : 0;
  const poseMismatch = (!opts.range && aspectOff > POSE_ASPECT_TOL)
    || rep.bands.some((b) => Math.abs(b.delta) > POSE_BAND_TOL);
  const worst = rep.worst.slice(0, 3).map((b) => {
    const i = rep.bands.indexOf(b);
    return { ...b, band: i, owner: owners[i] ?? null };
  });
  return {
    record: {
      kind: src.kind, path: src.path, view: opts.view,
      iou: rep.iou, meanWidthError: rep.meanWidthError, poseMismatch, worst,
      rowJerk: { ref: rep.rowJerk.ref, got: rep.rowJerk.got,
        stacked: rep.rowJerk.got > STACK_RATIO * rep.rowJerk.ref && rep.rowJerk.got - rep.rowJerk.ref > STACK_MIN },
    },
    rep, owners, ref, note,
  };
}

// --- text output ------------------------------------------------------------
/**
 * How a band's owner reads in one line.
 *
 * A `.blob` primitive carries no NAME of its own — only the bone it rides and
 * the limb it belongs to — so the fullest thing that can honestly be printed
 * is `bone (limb)`. A band the KIT owns says so (there is no primitive to
 * blame for the width of a shoe), and an empty band says that too rather than
 * pointing at whatever prim happens to be nearest.
 */
function ownerText(o: BandOwner | null | undefined): string {
  if (!o) return '(no owner)';
  if (o.limb === 'kit') return 'kit';
  if (o.index < 0 && !o.bone) return '(empty)';
  const where = o.line === null ? 'line   —' : `line ${String(o.line).padStart(4)}`;
  return `${where}  ${o.bone || '?'} (${o.limb || '?'})`;
}

/** Row jerk this much above the reference's reads as stacked discs IN THE
 *  OUTLINE. Ratio AND an absolute floor, so a reference that is itself
 *  perfectly smooth (jerk ~0) cannot flag a sculpt that is merely not
 *  identical. HONEST LIMIT (schoolgirl, 2026-08-23): her torso was a collar
 *  plate, two rings and a cylinder — and both front and side row jerk read
 *  SMOOTH (0.006 vs the mesh's 0.008), because the rings were grooves INSIDE
 *  the silhouette, not steps in it. No silhouette number sees interior
 *  creases. Only the pictures do: ask vision-ask whether the torso is one
 *  smooth mass or a stack of rings. */
const STACK_RATIO = 2.0;
const STACK_MIN = 0.004;

function printRef(scored: Scored, got: Mask, range?: [number, number]): void {
  const { record, rep, ref, note } = scored;
  const window = range ? `height ${range[0]}-${range[1]}` : 'the WHOLE figure';
  console.log(`\n=== ${record.kind}  ${record.path}   (${note})`);
  console.log(`IoU ${rep.iou.toFixed(3)}    mean width error ${rep.meanWidthError.toFixed(3)}`
    + `   over ${window}   ${rep.bands.length} bands`);
  if (record.poseMismatch)
    console.log(`POSE MISMATCH: reference aspect ${rep.refAspect.toFixed(3)} vs built `
      + `${rep.gotAspect.toFixed(3)} — the whole-figure score is dominated by pose; `
      + 'score a --range window where the poses agree.');
  console.log(`aspect (w/h)   reference ${rep.refAspect.toFixed(3)}   built ${rep.gotAspect.toFixed(3)}`);
  console.log(`row jerk       reference ${rep.rowJerk.ref.toFixed(4)}   built ${rep.rowJerk.got.toFixed(4)}`
    + '   (outline jumps between rows; creases INSIDE the outline are invisible here — look)');
  if (record.rowJerk.stacked)
    console.log(`STACKED: the outline changes width between rows ${(rep.rowJerk.got / Math.max(rep.rowJerk.ref, 1e-6)).toFixed(1)}x `
      + 'more than the reference — it reads as a stack of discs even though every band is the right width. '
      + 'Blend the masses (bigger blend=, fewer rings, one tapered prim where there are three) before chasing bands.');

  console.log('\nworst bands — the lines to edit, in order:');
  if (record.poseMismatch)
    console.log('  (pose-dominated — these bands may be the pose, not the sculpt)');
  for (const b of record.worst)
    console.log(`  band ${String(b.band).padStart(2)}  at ${b.at.toFixed(2)}  `
      + `ours ${b.gotWidth.toFixed(3)}  ref ${b.refWidth.toFixed(3)}  `
      + `delta ${b.delta >= 0 ? '+' : ''}${b.delta.toFixed(3)}   ${ownerText(b.owner)}`);

  console.log('\n  reference' + ' '.repeat(36) + 'built');
  // One row count for both columns, or the two sit at different vertical
  // scales and the rows stop corresponding — see renderMask's note.
  const ROWS = 26;
  const a = renderMask(ref, 44, ROWS).split('\n');
  const b = renderMask(got, 44, ROWS).split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    console.log('  ' + (a[i] ?? ' '.repeat(44)) + '   ' + (b[i] ?? ''));
}

// --- main -------------------------------------------------------------------
function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const { name, view, json } = flags;

  const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
  if (!existsSync(blobPath)) fail(`missing: ${blobPath}`);
  const sources = resolveSources(name, flags);

  const doc = parseBlob(readFileSync(blobPath, 'utf8'));
  const body = buildBody(compileBlob(doc, compileFace(doc)));

  // The kit is part of the silhouette — a reference shows a DRESSED character,
  // so scoring bare flesh against it blames the sculpt for the clothes' bulk.
  // bandOwners gets the SAME kit, or its bands stop meaning the same heights.
  const kitPath = `public/assets/lab/${name}-kit.gltf`;
  const kit = existsSync(kitPath)
    ? gltfTriangles(JSON.parse(new TextDecoder().decode(readFileSync(kitPath))))
    : undefined;

  if (body.errors.length) {
    if (json) console.log(JSON.stringify({ character: name, errors: body.errors, refs: [] }, null, 2));
    console.error(`build errors in ${blobPath}:`);
    for (const e of body.errors) console.error(`  ${e}`);
    process.exit(2);
  }

  const got = maskFromBody(body, { view, heightPx: 256, kit });
  const out: { character: string; errors: string[]; refs: JsonRef[] } =
    { character: name, errors: body.errors, refs: [] };

  if (!json) {
    console.log(`${name}   built from ${blobPath}   (${view} view)`);
    console.log(kit
      ? `kit ${kitPath} — ${kit.length / 9} triangles unioned into the silhouette`
      : `no kit at ${kitPath}; the outfit is paint or absent`);
  }

  for (const src of sources) {
    const scored = scoreRef(body, src, {
      view, got, ...(kit ? { kit } : {}),
      ...(flags.bands ? { bands: flags.bands } : {}),
      ...(flags.range ? { range: flags.range } : {}),
    });
    out.refs.push(scored.record);
    if (!json) printRef(scored, got, flags.range);
  }

  if (json) console.log(JSON.stringify(out, null, 2));
}

main();
