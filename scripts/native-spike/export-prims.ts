// scripts/native-spike/export-prims.ts
//
// NATIVE-RENDERER SPIKE (ray tracing): write a character's built, rest-posed
// primitives as JSON for native/march-replay's `rt-spike` binary.
//
//   npx tsx scripts/native-spike/export-prims.ts <character> <out.json>
//
// Only the plain fold is exported — `add` capsules/round-cones with scale,
// orientation and blend. Carves, grooves, bone and organ prims are dropped,
// and shells, boxes, strands and bends are flattened to their base capsule;
// the counts of each are printed so nobody mistakes the result for the real
// character.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';

const name = process.argv[2] ?? 'zombie';
const out = process.argv[3] ?? `.scratch/native-spike/${name}.prims.json`;
const doc = parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));

const dropped: Record<string, number> = {};
const flattened: Record<string, number> = {};
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
const prims = [];
for (const c of body.clusters) {
  if (!c.alive) continue;
  for (const p of body.prims.slice(c.start, c.start + c.count)) {
    if (p.dead) continue;
    if (p.op && p.op !== 'add') { bump(dropped, p.op); continue; }
    for (const k of ['shell', 'box', 'strand', 'bend'] as const) if (p[k] !== undefined) bump(flattened, k);
    prims.push({
      a: p.a, b: p.b, radius: p.radius, radiusB: p.radiusB ?? p.radius, scale: p.scale,
      orient: p.orient ?? [0, 0, 0, 1], blendK: p.blendK, chamfer: p.blendProfile === 'chamfer',
      cluster: p.cluster,
    });
  }
}
writeFileSync(out, JSON.stringify({ name, prims }));
console.log(`${name}: ${prims.length} prims -> ${out}; dropped ${JSON.stringify(dropped)}, flattened ${JSON.stringify(flattened)}`);
