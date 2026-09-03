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
// draft-fit/draft-skeleton/draft-paint/draft-emit: bone CHAINS come from the
// rig (len= places every descendant, and overlapping clouds do not compose —
// the chain-drift amendment), surfaces (radii, bands, colour, offsets) come
// from the clouds. The output is a body you REFINE, not a scaffold you
// rebuild.
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
//
// The pipeline middle (the grouping walk, per-bone fits, chain assembly)
// lives in src/lab/sdf-zombie/draft-skeleton.ts — this file is flags, IO,
// and the reports. That split is what lets the acceptance properties (soles
// on the floor, height line, len= against the rig) be tested end to end on a
// synthetic rig without shelling this script.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { validateBody } from '../src/lab/sdf-zombie/validate';
import { readRefSkin } from '../src/lab/sdf-zombie/ref-skin';
import { detectRig } from '../src/lab/sdf-zombie/ref-align';
import { assembleDraft } from '../src/lab/sdf-zombie/draft-skeleton';
import { readRefImage } from '../src/lab/sdf-zombie/draft-paint';
import { emitDraft } from '../src/lab/sdf-zombie/draft-emit';
import { len, sub } from '../src/lab/sdf-zombie/vec';

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

// --- main --------------------------------------------------------------------
function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const glbPath = resolveMesh(flags.name, flags.glb);

  const bytes = new Uint8Array((() => {
    try { return readFileSync(glbPath); }
    catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
  })());
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

  const assembled = (() => {
    try { return assembleDraft(skin, rig, image, { name: flags.name, height: flags.height }); }
    catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
  })();
  const { input, notes, height, g } = assembled;

  // --- coverage on stderr, artifact on stdout ---------------------------------
  console.error(`=== mesh ${glbPath}`);
  console.error(`=== drafting ${flags.name} at ${height.toFixed(3)} m`
    + (flags.height === undefined ? ` (the mesh's own extent; pass --height to override)` : ''));
  console.error(`=== ${skin.total - skin.dropped}/${skin.total} verts kept (${skin.dropped} below dominant weight); rig ${rig.name}`);
  for (const n of notes) console.error(`=== ${n}`);

  let text: string;
  try {
    text = emitDraft(input);
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
      return { body, errors: [...body.errors, ...validateBody(body, { silhouetteNoiseAmp: 0.01, stepMultiplier: 0.6 })] };
    } catch (e) { return { body: null, errors: [`${(e as Error).message}`] }; }
  })();

  // --- the acceptance numbers, so an author sees the chain closed without
  // --- running a test (chain-drift plan, task 3): soles vs the floor, the
  // --- built extent vs the requested height, and every mapped len= against
  // --- the rig joint-to-joint distance × the one global scale.
  let sole = NaN, extentY = NaN;
  if (check.body) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of check.body.prims) {
      const r = Math.max(p.radius, p.radiusB ?? p.radius);
      minY = Math.min(minY, p.a[1] - r, p.b[1] - r);
      maxY = Math.max(maxY, p.a[1] + r, p.b[1] + r);
    }
    sole = minY;
    extentY = maxY - minY;
  }
  // len= deviation is read off the ARTIFACT (parse what was emitted, not what
  // was fitted) against the chain metadata's declared rig joints — the same
  // cross-check the source test makes, so the CLI's number and the test's
  // cannot quietly disagree.
  let worstDev = 0, worstBone = '';
  try {
    const doc = parseBlob(text);
    const byName = new Map(input.bones.map((b) => [b.name, b]));
    for (const b of doc.bones) {
      const chain = byName.get(b.name)?.chain;
      if (!chain) continue;
      const head = skin.jointWorld.get(chain.head), tail = skin.jointWorld.get(chain.tail);
      if (!head || !tail) continue;
      const dev = Math.abs(b.len - len(sub(tail, head)) * g);
      if (dev > worstDev) { worstDev = dev; worstBone = b.name; }
    }
  } catch { /* unparseable artifact — the build report above already says so */ }
  console.error(`=== chain: soles ${sole.toFixed(4)} m (floor = 0)`
    + `; extent ${extentY.toFixed(4)} m vs height ${height.toFixed(4)}`
    + ` (${extentY >= 0 ? '+' : ''}${((extentY / height - 1) * 100).toFixed(2)}%)`
    + `; worst len= dev ${worstDev.toFixed(5)} m${worstBone ? ` (${worstBone})` : ''}`);
  console.error(`=== draft build: ${check.errors.length} error(s)${check.errors.length ? ' — ' + check.errors.join(' | ') : ''}`);
  process.exit(0);
}

main();
