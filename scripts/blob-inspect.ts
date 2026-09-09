// DEPENDENCY-FREE PACKED-FIELD DUMPER for a .blob character.
//
// WHY THIS EXISTS. `blob:shot` is the review path (a Chrome turntable); this
// is the no-GPU companion that prints the COMPILED field — the clusters and
// every packed primitive in fold order — so an author can read the actual
// world-space `a`/`b` endpoints, per-axis scale, carried colour, glow and
// `core` flag that the SDF will build, instead of reasoning about them in the
// .blob's bone-relative `offset=`/`tip=` frame. The two things it is for:
//   * counting prims per cluster against MAX_CLUSTER_PRIMS (64), and
//   * confirming where a primitive ACTUALLY landed after an offset/tip/bend.
//
//   npm run blob:inspect -- bloatmaw     # or directly:
//   npx tsx scripts/blob-inspect.ts bloatmaw
//
// It builds the CPU field the same way the lab does (parseBlob ->
// compileBlob/compileFace -> buildBody), so `errors` is the authoritative
// validate list for the character. No Chromium, no WebGPU — safe in a sandbox
// where Chrome cannot start. Colours print as LINEAR RGB (as parseColorArg
// parses them), not the sRGB hex you typed.
import { readFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';

const name = process.argv[2] ?? 'bloatmaw';
const doc = parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'));
const b = buildBody(compileBlob(doc, compileFace(doc)));
console.log('=== clusters ===');
for (const c of b.clusters) {
  console.log(`limb=${c.limb.padEnd(6)} id=${c.id} start=${c.start} count=${c.count} center=(${c.center.map(v=>v.toFixed(2))}) r=${c.radius.toFixed(2)} alive=${c.alive}`);
}
console.log('=== prims ===');
b.prims.forEach((p, i) => {
  const color = p.color ? `[${p.color.map(v=>v.toFixed(2))}]` : 'none';
  const glow = p.glow ?? 0;
  const bone = p.bone ?? '-';
  console.log(`${i} limb=${p.limb.padEnd(6)} op=${p.op??'add'} r=${p.radius.toFixed(3)} scale=(${p.scale.map(v=>v.toFixed(2))}) a=(${p.a.map(v=>v.toFixed(2))}) b=(${p.b.map(v=>v.toFixed(2))}) bone=${bone} color=${color} glow=${glow} core=${!!p.core}`);
});
console.log('=== errors ===');
console.log(b.errors);
