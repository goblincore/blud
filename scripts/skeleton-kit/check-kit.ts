// Holds the built kit against the body it was built for: every piece is a segment of the body as it now is, and
// every vertex is inside the rest flesh. Prints, per piece, the vertex that comes nearest the skin (or leaves it).
// Usage: npx tsx scripts/skeleton-kit/check-kit.ts [character] [kit.glb]
import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../src/lab/sdf-zombie/build-body';
import { bindRig } from '../../src/lab/sdf-zombie/rig-bind';
import { sdBody } from '../../src/lab/sdf-zombie/validate';
import { createSkeletonSources } from '../../src/lab/sdf-zombie/webgpu/skeleton-spike/contract';
import { kitRevisionOf, parseSkeletonKit } from '../../src/lab/sdf-zombie/webgpu/skeleton-spike/skeleton-kit';

const name = process.argv[2] ?? 'zombie', file = process.argv[3] ?? 'public/assets/lab/skeleton-kit.glb';
const body = buildBody(compileBlob(parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'))), DEFAULT_BUILD_OPTS);
const sources = createSkeletonSources(body, bindRig(body), { character: name });
const live = new Set(sources.map(kitRevisionOf));
const pieces = parseSkeletonKit(readFileSync(file));
let verts = 0, tris = 0, bad = 0;
for (const p of pieces) {
  let worst = -Infinity, at = [0, 0, 0], out = 0;
  for (let i = 0; i < p.positions.length; i += 3) {
    const q: [number, number, number] = [p.positions[i]!, p.positions[i + 1]!, p.positions[i + 2]!];
    const d = sdBody(q, body);
    if (d > -0.004) out++;
    if (d > worst) { worst = d; at = q; }
  }
  verts += p.positions.length / 3; tris += p.index.length / 3;
  const stale = !live.has(p.revision);
  if (stale || out) bad++;
  console.log(`${p.segment.padEnd(18)} ${String(p.positions.length / 3).padStart(5)} v ${String(p.index.length / 3).padStart(5)} t  nearest skin ${(worst * 1000).toFixed(1).padStart(6)} mm at (${at.map(v => v.toFixed(3)).join(', ')})  ${out ? `${out} verts within 4 mm of the skin or outside` : 'ok'}${stale ? '  STALE: no such segment revision' : ''}`);
}
const uncovered = sources.filter(s => s.segment !== 'head' && !pieces.some(p => p.revision === kitRevisionOf(s))).map(s => s.segment);
console.log(`TOTAL ${pieces.length} pieces ${verts} verts ${tris} tris; segments with no piece: ${uncovered.join(', ') || 'none'}`);
process.exit(bad ? 1 : 0);
