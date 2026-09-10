import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';
import { sdPrimitive } from '../../src/lab/sdf-zombie/validate';
import type { Vec3 } from '../../src/lab/sdf-zombie/types';

const src = readFileSync('src/lab/sdf-zombie/characters/cyberbride.blob', 'utf8');
const doc = parseBlob(src);
const b = buildBody(compileBlob(doc, compileFace(doc)));
const torso = b.clusters.find(c => c.limb === 'torso')!;
const slice = b.prims.slice(torso.start, torso.start + torso.count);
const p: Vec3 = [-0.197, 0.902, 0.070];
slice.forEach((prim, i) => {
  const d = sdPrimitive(p, prim);
  if (d < 0.06) console.log(`prim ${i} kind=${prim.kind} limb=${prim.limb} bone=${(prim as any).bone ?? ''} d=${d.toFixed(4)} a=(${prim.a.map(v=>v.toFixed(3))}) b=(${prim.b.map(v=>v.toFixed(3))}) r=${prim.radius.toFixed(3)} scale=(${prim.scale.map((v:number)=>v.toFixed(2))})`);
});
