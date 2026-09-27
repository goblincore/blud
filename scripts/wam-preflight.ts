// scripts/wam-preflight.ts
//
// Pre-flight a WAM kit against its .blob WITHOUT WAM (scripts/wam-shadow.ts):
//   npx tsx scripts/wam-preflight.ts <name> [part-prefix]
// Prints every kit bone's distance from its .blob bone head, then per part:
// the deepest vertex under the flesh (negative mm = sunk), how many vertices
// are inside, and the farthest/nearest distance from the surface. Use it to
// size parts before the owner builds; the kit's *-kit.test.ts is the gate.
import { readFileSync } from 'node:fs';
import { shadow } from './wam-shadow';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
import { boneFrames } from '../src/lab/sdf-zombie/rig-frames';
import { bindRig } from '../src/lab/sdf-zombie/rig-bind';
const name = process.argv[2] ?? 'warbull';
const d = parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'));
const body = buildBody(compileBlob(d, compileFace(d)));
const { verts, bones, H } = shadow(`src/lab/sdf-zombie/characters/${name}-kit.wam`);
const frames = boneFrames(body, bindRig(body), 0);
let worstBone = 0;
for (const [n, b] of bones) { const f = frames.get(n); if (!f) continue; const e = Math.max(...b.head.map((v, k) => Math.abs(v - f.pos[k]!))); worstBone = Math.max(worstBone, e); if (e > 1e-3) console.log('BONE OFF', n, (e * 1000).toFixed(1), 'mm'); }
console.log('bones checked', [...bones.keys()].filter(n => frames.has(n)).length, '/', body.bones.size, 'worst', (worstBone * 1000).toFixed(3), 'mm');
const byPart = new Map<string, typeof verts>();
for (const v of verts) { if (!byPart.has(v.part)) byPart.set(v.part, []); byPart.get(v.part)!.push(v); }
const only = process.argv[3];
for (const [p, vs] of byPart) {
  if (only && !p.startsWith(only)) continue;
  let worst = Infinity, at = vs[0]!.p, far = -Infinity; let inside = 0;
  for (const v of vs) { const dd = sdBody(v.p, body); if (dd < worst) { worst = dd; at = v.p; } if (dd < 0) inside++; far = Math.max(far, dd); }
  const minD = Math.min(...vs.map(v => sdBody(v.p, body)));
  const nearest = Math.min(...vs.map(v => Math.abs(sdBody(v.p, body))));
  console.log(`${p.padEnd(16)} ${vs[0]!.mat.padEnd(7)} ${vs[0]!.bone.padEnd(11)} n=${String(vs.length).padStart(4)} deepest ${(worst * 1000).toFixed(0).padStart(5)}mm at (${at.map(x => x.toFixed(3)).join(',')}) inside ${inside} farthest ${(far * 1000).toFixed(0)}mm nearest ${(nearest * 1000).toFixed(0)}mm`); void minD;
}
const low = verts.reduce((a, b) => (b.p[1] < a.p[1] ? b : a)); console.log('lowest', low.part, low.p.map(x => x.toFixed(4)).join(','));

