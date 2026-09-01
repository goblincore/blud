// Fit a .blob's primitives to a skinned reference mesh, worst-first.
//
//   npm run blob:rings -- mouse
//   npm run blob:rings -- mouse --json
//   npm run blob:rings -- mouse --glb path/to/mesh.glb
//
// SUGGESTS, NEVER APPLIES. .blob comments carry design intent a fit cannot
// see — mouse.blob's `deep 1.15, not 1.30` exists because the reference mesh
// is DRESSED and the flesh must sit a fabric's thickness inside it. A person
// reads these numbers and decides.
//
// A PRIMITIVE'S SUGGESTIONS ARE ONE EDIT, AND THIS FILE'S LAYOUT IS THE POINT.
// Only the world semi-axes `A_k = r * s_k` are measurable: `r` and a uniform
// scale are the SAME edit, so `fitPrims` returns one representative of a gauge
// family rather than four independent findings. Measured on a 45-degree
// fixture, a single `wide=1.3` error comes back as `r 0.1 -> 0.0939`, `wide ->
// 1.226`, `tall -> 0.909`, `deep -> 1.057` — and `deep`'s semi-axis is already
// right to 0.7%, its whole 5.7% ratio change existing only to offset the
// change in `r`. An a-la-carte menu of those four lines would invite an author
// to apply the `deep` one alone and make the character worse. So every block
// is printed as one apply-together unit, every scale line carries the
// SEMI-AXIS in millimetres that was actually measured beside the ratio that
// gets typed, and a pair of axes the bone's direction cannot separate is named
// as jointly unmeasurable instead of being printed as two numbers.
//
// EXIT CODES, matching blob-measure: 0 whenever it RAN, however bad the
// numbers; 2 for "did not run". An agent must never be able to read a failure
// to run as a perfect fit.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { readRefSkin } from '../src/lab/sdf-zombie/ref-skin';
import { detectRig, groupByBone, refBones, ringBasis, globalScale, refToBody } from '../src/lab/sdf-zombie/ref-align';
import { binResiduals, fitPrims, mergeMirrored, TAPER_T_MIN, TAPER_T_MAX } from '../src/lab/sdf-zombie/ring-fit';
import type { Vec3 } from '../src/lab/sdf-zombie/types';

function fail(msg: string): never { console.error(msg); process.exit(2); }

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
if (!name) fail('usage: npm run blob:rings -- <character> [--json] [--glb <path>]');
const asJson = args.includes('--json');
const glbFlag = args.indexOf('--glb') >= 0 ? args[args.indexOf('--glb') + 1] : undefined;

const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
if (!existsSync(blobPath)) fail(`no such character: ${blobPath}`);

let glbPath = glbFlag;
if (!glbPath) {
  const dir = `docs/dev-notes/refs/${name}-mesh`;
  const canonical = `${dir}/${name}.glb`;
  if (existsSync(canonical)) glbPath = canonical;
  else if (existsSync(dir)) {
    const first = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort()[0];
    if (first) {
      glbPath = `${dir}/${first}`;
      console.error(`warning: ${canonical} is missing; scoring against ${glbPath}`);
    }
  }
}
if (!glbPath) fail(`no reference mesh for ${name}. blob:rings needs a SKINNED mesh; a reference plate cannot be used.`);

const doc = parseBlob(readFileSync(blobPath, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
if (body.errors.length) console.error(`warning: body has ${body.errors.length} build error(s); numbers may be meaningless`);

// fail() returns never, so this narrows to RefSkin without a mutable binding.
const skin = (() => {
  try { return readRefSkin(new Uint8Array(readFileSync(glbPath))); }
  catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
})();

// THE RIG IS SELECTED HERE, LOUDLY. A reference whose joints no rig table
// names once produced an empty report instead of an error — every joint was
// "unmapped" and the fit measured nothing. Detection failure is a `fail()`
// (exit 2), naming the reference's joints and every known rig.
const rig = (() => {
  try { return detectRig([...skin.jointWorld.keys()]); }
  catch (e) { fail(`${glbPath}: ${(e as Error).message}`); }
})();

const ref = refBones(skin.jointWorld, rig);
const g = globalScale(ref, body.bones);
const { byBone, unmapped } = groupByBone(skin, rig);

const inBody = new Map<string, Vec3[]>();
for (const [bone, pts] of byBone) {
  const r = ref.get(bone), o = body.bones.get(bone);
  if (!r || !o) continue;
  const rB = ringBasis(r.head, r.tail), oB = ringBasis(o.head, o.tail);
  inBody.set(bone, pts.map((p) => refToBody(p, rB, oB, g.scale)));
}

const suggestions = mergeMirrored(fitPrims(binResiduals(inBody, body, body.bones), body));

/** Reference vertices that reached a bone this tool can actually measure. */
let inScope = 0;
for (const pts of inBody.values()) inScope += pts.length;

if (asJson) {
  console.log(JSON.stringify({ character: name, mesh: glbPath, rig: rig.name, scale: g, coverage: {
    total: skin.total, dropped: skin.dropped, inScope, unmapped: Object.fromEntries(unmapped),
  }, suggestions }, null, 2));
  process.exit(0);
}

const mm = (v: number) => `${(v * 1000).toFixed(1)}mm`;
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Greedy word wrap, `indent` spaces on the first line and two more after it. */
function wrap(text: string, indent: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line === '') { line = word; continue; }
    if (line.length + 1 + word.length > width) { out.push(line); line = word; continue; }
    line += ` ${word}`;
  }
  if (line !== '') out.push(line);
  return out.map((l, i) => ' '.repeat(i === 0 ? indent : indent + 2) + l);
}

/**
 * Our bone length against the reference's, as a percentage, per bone.
 *
 * Computed up here because it belongs BESIDE each suggestion and not only in
 * the table at the bottom. A bone of the wrong LENGTH is a `len=` edit, but
 * the residual it creates is charged to whatever primitive happens to be
 * nearest, and this fit can only spend it on radius, scale and offset. On
 * mouse.blob the foot is 45% shorter than the reference, so reference toe
 * points land tens of millimetres past the end of our foot, and the linear
 * taper fit extrapolates a toe blob's r from 0.043 all the way to 0.205 — a
 * number that is arithmetically what the residual asks for and physically
 * nonsense. The mismatch is already measured; printing it next to the block it
 * distorts is what stops a reader from typing that 0.205 in.
 */
const lengthPct = new Map<string, number>();
for (const [bone, r] of ref) {
  const o = body.bones.get(bone);
  if (!o) continue;
  const rl = Math.hypot(r.tail[0] - r.head[0], r.tail[1] - r.head[1], r.tail[2] - r.head[2]) * g.scale;
  const ol = Math.hypot(o.tail[0] - o.head[0], o.tail[1] - o.head[1], o.tail[2] - o.head[2]);
  if (rl > 1e-9) lengthPct.set(bone, 100 * (ol / rl - 1));
}
/** Past this, the bone's own length dominates whatever the ring fit reports. */
const LENGTH_DOMINATES_PCT = 10;

console.log(`=== mesh ${glbPath}  scale ${g.scale.toFixed(5)} (${g.n} bones, spread ${g.spreadPct.toFixed(1)}%, furthest ${g.worstBone})`);
console.log(`=== ${skin.total - skin.dropped}/${skin.total} verts assigned, ${skin.dropped} below dominant weight`);
// COVERAGE IS PART OF THE RESULT, not a footnote. Only 40% of mouse.glb's
// vertices reach a bone this tool measures — 55% of that mesh is head and
// hands, both deliberately out of scope. A report that showed only the fitted
// list would read as a complete measurement of the character; it is a complete
// measurement of the part of the character in scope, and those differ.
console.log(`=== ${inScope} of ${skin.total} verts (${pct(inScope / skin.total)}) reached a measurable bone; the rest are head, hands or blend-dropped`);
if (unmapped.size) {
  const list = [...unmapped].sort((a, b) => b[1] - a[1]).map(([j, n]) => `${j}(${n})`);
  console.log(`=== unmapped joints: ${list.join(', ')}`);
}
console.log(`=== head skipped — use \`npx tsx scripts/head-profile.ts ${name}\``);
console.log();
console.log('Each numbered block below is ONE edit. Only the world semi-axes (r x scale,');
console.log('shown in mm) are measured — r and a uniform scale are the same change — so');
console.log('applying part of a block moves the surface by an amount nobody measured.');
console.log();

let rank = 0;
for (const s of suggestions) {
  if (s.skipped !== undefined) continue;
  // `taperRefused` counts as content: a suppressed finding that looks like an
  // absent one is its own error, so a primitive whose only result is "there is
  // a slope here I refuse to extrapolate" still gets a block.
  if (!s.r && !s.r2 && !s.scales && !s.offset && !s.taperRefused) continue;
  rank++;
  console.log(`  ${rank}. ${name}.blob:${s.src ?? '?'}   ${s.bone ?? '?'}`);
  const flags = [`n=${s.n}`, `blend-dominated ${pct(s.blendDominated)}`];
  if (s.crossBone) flags.push(`cross-bone dropped ${s.crossBone}`);
  // OFF-ENDS IS A DIFFERENT FAILURE FROM CROSS-BONE and must be visible next
  // to `n`. These points are reference surface lying past this primitive's own
  // span — usually because the bone is the wrong LENGTH — and they used to be
  // clamped onto t=0/t=1, where they fabricated the end coverage the taper
  // gate checks for. They are dropped now, so a block whose off-ends count
  // dwarfs its `n` is a primitive the reference barely overlaps.
  if (s.outOfRange) flags.push(`off-ends dropped ${s.outOfRange}`);
  if (s.mirrorDisagreement) flags.push(`L/R disagree ${mm(s.mirrorDisagreement)}`);
  // PRINTED ONLY WHEN COVERAGE IS PARTIAL. A primitive measured end to end is
  // the ordinary case and needs no annotation; one measured over 13% of its
  // own length is a materially weaker claim and the reader cannot tell from
  // `n` alone, because count and coverage are different axes — mouse's
  // `thigh.r` carried 46 samples spanning t 0.000-0.008.
  if (s.tRange && (s.tRange.min > TAPER_T_MIN || s.tRange.max < TAPER_T_MAX)) {
    flags.push(`t ${s.tRange.min.toFixed(2)}-${s.tRange.max.toFixed(2)} only`);
  }
  console.log(`     mean ${mm(s.meanAbs)}    ${flags.join('   ')}`);
  console.log('     apply together:');

  // The radius the scale lines are measured against. When the fit leaves `r`
  // alone the current radius is still what multiplies every ratio, so the
  // semi-axis has to be built from it rather than from the r line existing.
  const prim = body.prims[s.prim];
  const rFrom = s.r?.from ?? prim?.radius ?? 0;
  const rTo = s.r?.to ?? prim?.radius ?? 0;

  // A NON-POSITIVE RADIUS IS NOT A SUGGESTION, and must never be printed as
  // one. The taper fit is a straight line through the residuals, so a bone
  // carrying a large systematic error extrapolates it straight past zero:
  // schoolgirl.blob's foot asks for r2 = -0.187. The arithmetic is sound and
  // the answer is meaningless, which is exactly the combination a reader
  // cannot be expected to spot unaided.
  const impossible = (c?: { to: number }) => (c !== undefined && c.to <= 0
    ? '   <- IMPOSSIBLE, not a measurement: the linear taper has extrapolated past zero'
    : '');
  if (s.r) console.log(`       r      ${s.r.from.toFixed(4)} -> ${s.r.to.toFixed(4)}   ${s.r.why}${impossible(s.r)}`);
  if (s.r2) console.log(`       r2     ${s.r2.from.toFixed(4)} -> ${s.r2.to.toFixed(4)}   ${s.r2.why}${impossible(s.r2)}`);
  for (const sc of s.scales ?? []) {
    const semi = `semi-axis ${mm(rFrom * sc.from)} -> ${mm(rTo * sc.to)}`;
    console.log(`       ${sc.axis.padEnd(6)} ${sc.from.toFixed(3)} -> ${sc.to.toFixed(3)}   ${semi.padEnd(30)} ${sc.why}`);
  }
  if (s.offset) {
    // `why` can carry a whole paragraph now (a mirrored line's x is dropped
    // with its reason attached), so it wraps rather than running off the edge.
    const head = `       offset delta (${s.offset.delta.map((v) => v.toFixed(4)).join(', ')})`;
    const [first, ...rest] = wrap(`${head.trim()}   ${s.offset.why}`, 7, 78);
    console.log(first!);
    for (const line of rest) console.log(line);
  }
  const lp = s.bone === undefined ? undefined : lengthPct.get(s.bone);
  if (lp !== undefined && Math.abs(lp) > LENGTH_DOMINATES_PCT) {
    console.log(`     BONE LENGTH IS OFF BY ${lp.toFixed(1)}% — fix that first. A \`len=\` mismatch this large`);
    console.log(`       puts reference surface where this primitive simply is not, and the numbers`);
    console.log(`       above are the fit spending that on radius and offset instead.`);
  }
  // THE WHOLE REASON COMES FROM `taperRefused` NOW, not from a paragraph
  // printed here. There are two different refusals — the samples did not reach
  // both ends, and the residual is not a line between them — and they call for
  // different actions, so the advice has to travel with the finding rather than
  // being a fixed footer that fits only the first of them.
  if (s.taperRefused) for (const line of wrap(`TAPER REFUSED: ${s.taperRefused}`, 5, 78)) console.log(line);
  if (s.degenerate) {
    const [p, q] = s.degenerate.axes;
    console.log(`     NOT SEPARABLE on this bone: ${p} and ${q} sit ${s.degenerate.angleDeg.toFixed(1)} deg apart,`);
    console.log(`       so only their combined effect was measured. The split shown between them`);
    console.log(`       came from the solver, not the reference — move them as a pair or not at all.`);
  }
  console.log();
}
if (rank === 0) console.log('  (no primitive moved by more than the instrument can resolve)\n');

const skipped = suggestions.filter((s) => s.skipped !== undefined);
if (skipped.length) {
  console.log(`=== ${skipped.length} primitive(s) not fitted:`);
  for (const s of skipped) console.log(`     ${name}.blob:${s.src ?? '?'}  ${s.bone ?? '?'} — ${s.skipped}`);
}

console.log();
console.log('=== bone length ratios (reference : ours) — these are `len=` edits, not radius edits');
for (const [bone, r] of ref) {
  const o = body.bones.get(bone);
  if (!o) continue;
  const rl = Math.hypot(r.tail[0] - r.head[0], r.tail[1] - r.head[1], r.tail[2] - r.head[2]) * g.scale;
  const ol = Math.hypot(o.tail[0] - o.head[0], o.tail[1] - o.head[1], o.tail[2] - o.head[2]);
  console.log(`     ${bone.padEnd(12)} ref ${rl.toFixed(3)}  ours ${ol.toFixed(3)}  ${(100 * (ol / rl - 1)).toFixed(1)}%`);
}
process.exit(0);
