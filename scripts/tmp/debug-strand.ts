import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';
import { strandedOf } from '../../src/lab/sdf-zombie/blob-checks';
import { sdBody } from '../../src/lab/sdf-zombie/validate';
import type { Vec3 } from '../../src/lab/sdf-zombie/types';

const src = readFileSync('src/lab/sdf-zombie/characters/cyberbride.blob', 'utf8');
const b = buildBody(compileBlob(parseBlob(src), compileFace(parseBlob(src))));
const c = b.clusters.find(c => c.limb === 'armL')!;
const gap = strandedOf(b as never, c);
console.log('armL stranded gap:', gap);
if (gap !== null) {
  const all = b.prims.slice(c.start, c.start + c.count);
  const everything = b.prims.filter(p => p.op !== 'sub');
  for (const p of all) {
    if (p.op === 'sub') continue;
    const rest = everything.filter(q => q !== p);
    const restField: any = { prims: rest, clusters: [{ ...c, start: 0, count: rest.length, center: c.center, radius: 1e3 }] };
    let nearest = Infinity, np: Vec3 = [0,0,0];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      for (const s of [[p.radius,0,0],[-p.radius,0,0],[0,p.radius,0],[0,-p.radius,0],[0,0,p.radius],[0,0,-p.radius]] as const) {
        const pt: Vec3 = [
          p.a[0]+(p.b[0]-p.a[0])*t + s[0],
          p.a[1]+(p.b[1]-p.a[1])*t + s[1],
          p.a[2]+(p.b[2]-p.a[2])*t + s[2],
        ];
        const d = sdBody(pt, restField);
        if (d < nearest) { nearest = d; np = pt; }
      }
    }
    if (nearest > 0.012) console.log(`FLOATER r=${p.radius.toFixed(3)} nearest=${nearest.toFixed(4)} a=(${p.a.map(v=>v.toFixed(2))}) b=(${p.b.map(v=>v.toFixed(2))}) scale=(${p.scale.map((v:number)=>v.toFixed(2))})`);
  }
}
