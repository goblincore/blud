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
// REFERENCE RESOLUTION, in order: 1. --glb  2. the first .glb under
// docs/dev-notes/refs/<name>-mesh/  3. --plate, else
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
import { decodePng } from '../src/lab/sdf-zombie/png-decode';
import {
  maskFromRgba, maskFromBody, maskFromTriangles, compareSilhouette, bandOwners,
  renderMask, parseGlb, gltfTriangles,
} from '../src/lab/sdf-zombie/silhouette';
import type { BandOwner, BandReport, Mask } from '../src/lab/sdf-zombie/silhouette';

const args = process.argv.slice(2);
const flagValue = (flag: string): string | undefined => {
  const a = args.find((x) => x === flag || x.startsWith(`${flag}=`));
  if (a === undefined) return undefined;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[args.indexOf(a) + 1];
};
const VALUE_FLAGS = ['--range', '--bands', '--plate', '--glb'];
// Positional = not a flag, and not the value of a value-taking flag.
const positional = args.filter((a, i) => !a.startsWith('--')
  && !VALUE_FLAGS.some((f) => args[i - 1] === f));

const json = args.includes('--json');
const side = args.includes('--side');
const view: 'front' | 'side' = side ? 'side' : 'front';
const name = positional[0];
if (!name) {
  console.error('usage: npm run blob:measure -- <character> [--json] [--side] '
    + '[--range lo:hi] [--bands n] [--plate ref.png] [--glb ref.glb]');
  process.exit(2);
}

const bandsVal = flagValue('--bands');
const bands = bandsVal ? Number(bandsVal) : undefined;
const rangeVal = flagValue('--range');
const range: [number, number] | undefined = rangeVal && rangeVal.includes(':')
  ? [Number(rangeVal.split(':')[0]), Number(rangeVal.split(':')[1])] as [number, number]
  : undefined;

const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
if (!existsSync(blobPath)) { console.error(`missing: ${blobPath}`); process.exit(2); }

// --- references -------------------------------------------------------------
interface RefSource { kind: 'mesh' | 'plate'; path: string }
const sources: RefSource[] = [];
const glbFlag = flagValue('--glb');
const meshDir = `docs/dev-notes/refs/${name}-mesh`;
if (glbFlag) {
  if (!existsSync(glbFlag)) { console.error(`missing: ${glbFlag}`); process.exit(2); }
  sources.push({ kind: 'mesh', path: glbFlag });
} else if (existsSync(meshDir)) {
  const glb = readdirSync(meshDir).filter((f) => f.endsWith('.glb')).sort()[0];
  if (glb) sources.push({ kind: 'mesh', path: `${meshDir}/${glb}` });
}
const plateFlag = flagValue('--plate');
if (plateFlag) {
  if (!existsSync(plateFlag)) { console.error(`missing: ${plateFlag}`); process.exit(2); }
  sources.push({ kind: 'plate', path: plateFlag });
} else {
  const plate = `docs/dev-notes/refs/${name}-reference.png`;
  if (existsSync(plate)) sources.push({ kind: 'plate', path: plate });
}
if (!sources.length) {
  console.error(`no reference for ${name}: expected a .glb under ${meshDir}/ or a plate at `
    + `docs/dev-notes/refs/${name}-reference.png (or pass --glb/--plate)`);
  process.exit(2);
}

// --- build ------------------------------------------------------------------
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

const refMask = (src: RefSource): { mask: Mask; note: string } => {
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
};

/**
 * How a band's owner reads in one line.
 *
 * A `.blob` primitive carries no NAME of its own — only the bone it rides and
 * the limb it belongs to — so the fullest thing that can honestly be printed
 * is `bone (limb)`. A band the KIT owns says so (there is no primitive to
 * blame for the width of a shoe), and an empty band says that too rather than
 * pointing at whatever prim happens to be nearest.
 */
const ownerText = (o: BandOwner | undefined): string => {
  if (!o) return '(no owner)';
  if (o.limb === 'kit') return 'kit';
  if (o.index < 0 && !o.bone) return '(empty)';
  const where = o.line === null ? 'line   —' : `line ${String(o.line).padStart(4)}`;
  return `${where}  ${o.bone || '?'} (${o.limb || '?'})`;
};

interface JsonWorst extends BandReport { band: number; owner: BandOwner | null }
interface JsonRef {
  kind: 'mesh' | 'plate'; path: string; view: string;
  iou: number; meanWidthError: number; poseMismatch: boolean; worst: JsonWorst[];
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
const out: { character: string; errors: string[]; refs: JsonRef[] } =
  { character: name, errors: body.errors, refs: [] };

if (!json) {
  console.log(`${name}   built from ${blobPath}   (${view} view)`);
  console.log(kit
    ? `kit ${kitPath} — ${kit.length / 9} triangles unioned into the silhouette`
    : `no kit at ${kitPath}; the outfit is paint or absent`);
  console.log('build: ok, 0 errors');
}

for (const src of sources) {
  const { mask: ref, note } = refMask(src);
  const rep = compareSilhouette(ref, got, {
    ...(range ? { range } : {}), ...(bands ? { bands } : {}),
  });
  // Same kit, same range, same band count — that is what makes band i mean the
  // same height in both, and the pairing below a fact rather than a guess.
  const owners = bandOwners(body, {
    view, bands: rep.bands.length, ...(kit ? { kit } : {}), ...(range ? { range } : {}),
  });
  // The aspects are WHOLE-figure whatever window was scored, so the aspect
  // symptom only speaks for a whole-figure score; inside a `--range` the band
  // symptom is the only one that is about the rows actually being compared.
  const aspectOff = rep.refAspect > 0
    ? Math.abs(rep.refAspect - rep.gotAspect) / rep.refAspect : 0;
  const poseMismatch = (!range && aspectOff > POSE_ASPECT_TOL)
    || rep.bands.some((b) => Math.abs(b.delta) > POSE_BAND_TOL);
  const worst = rep.worst.slice(0, 3).map((b) => {
    const i = rep.bands.indexOf(b);
    return { ...b, band: i, owner: owners[i] ?? null };
  });
  out.refs.push({
    kind: src.kind, path: src.path, view,
    iou: rep.iou, meanWidthError: rep.meanWidthError, poseMismatch, worst,
  });
  if (json) continue;

  const window = range ? `height ${range[0]}-${range[1]}` : 'the WHOLE figure';
  console.log(`\n=== ${src.kind}  ${src.path}   (${note})`);
  console.log(`IoU ${rep.iou.toFixed(3)}    mean width error ${rep.meanWidthError.toFixed(3)}`
    + `   over ${window}   ${rep.bands.length} bands`);
  if (poseMismatch)
    console.log(`POSE MISMATCH: reference aspect ${rep.refAspect.toFixed(3)} vs built `
      + `${rep.gotAspect.toFixed(3)} — the whole-figure score is dominated by pose; `
      + 'score a --range window where the poses agree.');
  console.log(`aspect (w/h)   reference ${rep.refAspect.toFixed(3)}   built ${rep.gotAspect.toFixed(3)}`);

  console.log('\nworst bands — the lines to edit, in order:');
  if (poseMismatch)
    console.log('  (pose-dominated — these bands may be the pose, not the sculpt)');
  for (const b of worst)
    console.log(`  band ${String(b.band).padStart(2)}  at ${b.at.toFixed(2)}  `
      + `ours ${b.gotWidth.toFixed(3)}  ref ${b.refWidth.toFixed(3)}  `
      + `delta ${b.delta >= 0 ? '+' : ''}${b.delta.toFixed(3)}   ${ownerText(b.owner ?? undefined)}`);

  console.log('\n  reference' + ' '.repeat(36) + 'built');
  // One row count for both columns, or the two sit at different vertical
  // scales and the rows stop corresponding — see renderMask's note.
  const ROWS = 26;
  const a = renderMask(ref, 44, ROWS).split('\n');
  const b = renderMask(got, 44, ROWS).split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    console.log('  ' + (a[i] ?? ' '.repeat(44)) + '   ' + (b[i] ?? ''));
}

if (json) console.log(JSON.stringify(out, null, 2));
