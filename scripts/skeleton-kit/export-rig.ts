// The rig data the Blender kit script builds against: a character's rest joints, its skeleton segments (key, rest
// origin, revision, bone prims in rest world space) and its flesh prims.
// Usage: npx tsx scripts/skeleton-kit/export-rig.ts <character> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../src/lab/sdf-zombie/build-body';
import { bindRig } from '../../src/lab/sdf-zombie/rig-bind';
import { createSkeletonSources } from '../../src/lab/sdf-zombie/webgpu/skeleton-spike/contract';
import { kitRevisionOf } from '../../src/lab/sdf-zombie/webgpu/skeleton-spike/skeleton-kit';

const name = process.argv[2] ?? 'zombie', out = process.argv[3]!;
const body = buildBody(compileBlob(parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'))), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const sources = createSkeletonSources(body, bound, { character: name });
const r = (v: readonly number[]) => v.map(x => Math.round(x * 1e5) / 1e5);
const prim = (p: (typeof body.prims)[number], w: (q: readonly [number, number, number]) => number[]) => ({
  bone: p.bone ?? null, limb: p.limb, a: r(w(p.a)), b: r(w(p.b)), radius: p.radius, radiusB: p.radiusB ?? p.radius, scale: p.scale,
  bend: p.bend ? r(p.bend) : null,
});
writeFileSync(out, JSON.stringify({
  character: name,
  joints: bound.rig.points.map(p => r(p.pos)),
  bones: [...body.bones.entries()].map(([n, b]) => ({ name: n, head: r(b.head), tail: r(b.tail) })),
  segments: sources.map(s => ({
    key: s.segment, revision: kitRevisionOf(s), origin: r(s.pose().origin), rigidity: s.rigidity,
    boundsMin: r(s.toWorld(s.bounds.min)), boundsMax: r(s.toWorld(s.bounds.max)),
    prims: (s.prims ?? []).map(p => prim(p, q => s.toWorld(q))),
  })),
  flesh: body.prims.map(p => prim(p, q => [...q])),
}, null, 1));
console.log(`${out}: ${sources.length} segments, ${body.prims.length} flesh prims`);
