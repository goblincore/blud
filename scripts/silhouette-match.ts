// Score a .blob character's OUTLINE against a reference plate.
//
// Superseded by scripts/blob-measure.ts for day-to-day use; kept because its
// --bands/--side plate comparisons are referenced in
// docs/dev-notes/2026-08-22-silhouette-matching.md.
//
//   npx tsx scripts/silhouette-match.ts <character> [reference.png] [--side] [--range lo:hi]
//   npx tsx scripts/silhouette-match.ts mouse
//   npx tsx scripts/silhouette-match.ts mouse --range 0.75:1      # legs + shoes only
//   npx tsx scripts/silhouette-match.ts mouse --bands 40           # finer profile
//   npx tsx scripts/silhouette-match.ts clown docs/dev-notes/refs/clown-1-ref.png
//
// Reads src/lab/sdf-zombie/characters/<character>.blob, builds it with the
// same compile path the lab uses, rasterises an orthographic silhouette off
// sdBody, and compares it to the plate. Both sides are normalised to their own
// subject bounding box first, so the score is about PROPORTION only — size and
// position in frame cannot affect it.
//
// Read the BANDS, not just the score. IoU tells you whether it is broadly the
// right shape; the per-band width deltas tell you WHERE it is wrong, which is
// the part you can act on. `at` runs 0 at the top of the head to 1 at the
// soles, and widths are fractions of the subject's own height.
//
// READ THE CAVEAT IN silhouette.ts BEFORE TRUSTING A NUMBER. Reference plates
// pose their arms; a .blob rasterises in its authored rest pose, and that gap
// dominates the score — the owner-APPROVED clown scores worse than the
// owner-REJECTED mouse. Use `--range` to score a height window where the poses
// actually agree (the mouse's legs and shoes at 0.75:1), and otherwise treat
// the numbers as a before/after gradient for ONE character against ONE plate.
//
// This does not replace looking at the render — it has no idea about colour,
// features inside the outline, or depth. It catches the class of error that is
// obvious in a thumbnail and invisible to a check that measures one primitive
// at a time. See src/lab/sdf-zombie/silhouette.ts for the full caveat.
import { readFileSync, existsSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { decodePng } from '../src/lab/sdf-zombie/png-decode';
import {
  maskFromRgba, maskFromBody, compareSilhouette, renderMask, gltfTriangles,
} from '../src/lab/sdf-zombie/silhouette';

const args = process.argv.slice(2);
const side = args.includes('--side');
const rest = args.filter((a, i) => !a.startsWith('--')
  && !args[i - 1]?.startsWith('--range') && !args[i - 1]?.startsWith('--bands'));
const name = rest[0];
if (!name) {
  console.error('usage: npx tsx scripts/silhouette-match.ts <character> [reference.png] [--side]');
  process.exit(2);
}
const refPath = rest[1] ?? `docs/dev-notes/refs/${name}-reference.png`;
const bandsArg = args.find((a) => a.startsWith('--bands'));
const bandsVal = bandsArg?.includes('=') ? bandsArg.split('=')[1] : args[args.indexOf(bandsArg ?? '') + 1];
const bands = bandsVal ? Number(bandsVal) : undefined;
const rangeArg = args.find((a) => a.startsWith('--range'));
const rangeVal = rangeArg?.includes('=') ? rangeArg.split('=')[1] : args[args.indexOf(rangeArg ?? '') + 1];
const range: [number, number] | undefined = rangeVal && rangeVal.includes(':')
  ? [Number(rangeVal.split(':')[0]), Number(rangeVal.split(':')[1])] as [number, number]
  : undefined;
const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
for (const p of [blobPath, refPath])
  if (!existsSync(p)) { console.error(`missing: ${p}`); process.exit(2); }

const doc = parseBlob(readFileSync(blobPath, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
if (body.errors.length) console.error('build errors:', body.errors);

// The kit is part of the silhouette. A plate shows a DRESSED character, so
// comparing bare flesh against it blames the sculpt for the clothes' bulk.
const kitPath = `public/assets/lab/${name}-kit.gltf`;
const kit = existsSync(kitPath)
  ? gltfTriangles(JSON.parse(new TextDecoder().decode(readFileSync(kitPath))))
  : undefined;

const started = Date.now();
const got = maskFromBody(body, { view: side ? 'side' : 'front', heightPx: 256, kit });
const png = decodePng(readFileSync(refPath));
const ref = maskFromRgba(png.rgba, png.width, png.height);

console.log(`${name}  vs  ${refPath}   (${side ? 'side' : 'front'} view, ${Date.now() - started} ms)`);
console.log(kit
  ? `kit ${kitPath} — ${kit.length / 9} triangles unioned into the silhouette`
  : `no kit at ${kitPath}; scoring bare flesh against a plate that may be dressed`);
console.log(`reference ${png.width}x${png.height}  blobs=${ref.components}  coverage=${(ref.coverage * 100).toFixed(1)}%  backdrop=rgb(${ref.background})`);
if (ref.components > 1)
  console.log(`  note: ${ref.components} disconnected blobs found; kept the largest. Check the plate has no watermark or detached shadow.`);

console.log('\n  reference' + ' '.repeat(36) + 'built');
// Same row count for both, or the two columns sit at different vertical
// scales and the rows stop corresponding — see renderMask's note.
const ROWS = 26;
const a = renderMask(ref.mask, 44, ROWS).split('\n');
const b = renderMask(got, 44, ROWS).split('\n');
for (let i = 0; i < Math.max(a.length, b.length); i++)
  console.log('  ' + (a[i] ?? ' '.repeat(44)) + '   ' + (b[i] ?? ''));

const rep = compareSilhouette(ref.mask, got, { ...(range ? { range } : {}), ...(bands ? { bands } : {}) });
const window = range ? ` over height ${range[0]}-${range[1]}` : ' over the WHOLE figure';
console.log(`\nIoU ${rep.iou.toFixed(3)}    mean width error ${rep.meanWidthError.toFixed(3)}${window}`);
if (!range)
  console.log('  (whole-figure scores conflate POSE with proportion and do not compare across\n   characters — see the caveat in src/lab/sdf-zombie/silhouette.ts)');
console.log(`aspect (w/h)   reference ${rep.refAspect.toFixed(3)}   built ${rep.gotAspect.toFixed(3)}`);

console.log('\n  at      ref     built   delta');
for (const bd of rep.bands) {
  const bar = bd.delta < 0 ? 'too narrow' : bd.delta > 0 ? 'too wide' : '';
  const flag = Math.abs(bd.delta) > 0.05 ? `  <-- ${bar}` : '';
  console.log(`  ${bd.at.toFixed(3)}   ${bd.refWidth.toFixed(3)}   ${bd.gotWidth.toFixed(3)}   ${bd.delta >= 0 ? '+' : ''}${bd.delta.toFixed(3)}${flag}`);
}

console.log('\nworst bands:');
for (const bd of rep.worst.slice(0, 4))
  console.log(`  at ${bd.at.toFixed(2)}  ${bd.delta >= 0 ? '+' : ''}${bd.delta.toFixed(3)}  (ref ${bd.refWidth.toFixed(3)}, built ${bd.gotWidth.toFixed(3)})`);
