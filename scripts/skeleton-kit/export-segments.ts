// Export a mesh skeleton (rest pose, world space) as one OBJ, one object per segment, and list the segments.
// Usage: npx tsx scripts/skeleton-kit/export-segments.ts <character> <out.obj>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../src/lab/sdf-zombie/build-body';
import { bindRig } from '../../src/lab/sdf-zombie/rig-bind';
import { createSkeletonSources } from '../../src/lab/sdf-zombie/webgpu/skeleton-spike/contract';
import { extractSegmentMesh } from '../../src/lab/sdf-zombie/webgpu/skeleton-spike/mesh';
const name = process.argv[2] ?? 'zombie', out = process.argv[3]!;
const body = buildBody(compileBlob(parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'))), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);
const sources = createSkeletonSources(body, bound, { character: name });
let obj = '', base = 1, tv = 0, tt = 0;
for (const s of sources) {
  const m = extractSegmentMesh(s);
  const pos = m.geometry.getAttribute('position'), idx = m.geometry.getIndex()!;
  obj += `o ${s.segment.replace(/[: ]/g, '_')}\n`;
  for (let i = 0; i < pos.count; i++) { const w = s.toWorld([pos.getX(i), pos.getY(i), pos.getZ(i)]); obj += `v ${w[0].toFixed(5)} ${w[1].toFixed(5)} ${w[2].toFixed(5)}\n`; }
  for (let i = 0; i < idx.count; i += 3) obj += `f ${idx.getX(i) + base} ${idx.getX(i + 1) + base} ${idx.getX(i + 2) + base}\n`;
  base += pos.count; tv += m.verts; tt += m.tris;
  const names = [...new Set((s.prims ?? []).map(p => p.bone ?? '?'))].join(',');
  const lo = s.toWorld(s.bounds.min), hi = s.toWorld(s.bounds.max);
  console.log(s.segment.padEnd(28), String(s.primCount).padStart(3), 'prims', String(m.verts).padStart(5), 'v', String(m.tris).padStart(5), 't', `y ${lo[1].toFixed(3)}..${hi[1].toFixed(3)} x ${lo[0].toFixed(3)}..${hi[0].toFixed(3)}`, names);
}
console.log('TOTAL', sources.length, 'segments', tv, 'verts', tt, 'tris');
console.log('joints', bound.rig.points.map((p, i) => `${i}:${(p as any).name ?? ''}(${p.pos.map(v => v.toFixed(2)).join(',')})`).join(' '));
writeFileSync(out, obj);
