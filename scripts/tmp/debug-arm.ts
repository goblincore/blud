import { readFileSync } from 'node:fs';
const src = readFileSync('src/lab/sdf-zombie/characters/cyberbride.blob', 'utf8');
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';
import { sdBody } from '../../src/lab/sdf-zombie/validate';
import type { Vec3 } from '../../src/lab/sdf-zombie/types';

const doc = parseBlob(src);
const b = buildBody(compileBlob(doc, compileFace(doc)));
const torso = b.clusters.find(c => c.limb === 'torso')!;
const slice = b.prims.slice(torso.start, torso.start + torso.count);
const field = { prims: slice, clusters: [{ ...torso, start: 0, count: slice.length }] };
const arm = b.clusters.find(c => c.limb === 'armL')!;
const join = b.bones.get('clavicle.l')!.tail;
const sub = (a: Vec3, c: Vec3): Vec3 => [a[0]-c[0], a[1]-c[1], a[2]-c[2]];
const len = (v: Vec3) => Math.hypot(...v);
for (const prim of b.prims.slice(arm.start, arm.start + arm.count)) {
  const eff = prim.radius * Math.min(...prim.scale);
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p: Vec3 = [
      prim.a[0] + (prim.b[0] - prim.a[0]) * t,
      prim.a[1] + (prim.b[1] - prim.a[1]) * t,
      prim.a[2] + (prim.b[2] - prim.a[2]) * t,
    ];
    if (len(sub(p, join)) < 0.135) continue;
    const d = sdBody(p, field as never) - eff;
    if (d < 0.02) console.log(`d=${d.toFixed(4)} eff=${eff.toFixed(3)} p=(${p.map(v=>v.toFixed(3))}) r=${prim.radius.toFixed(3)} blend=${prim.blendK.toFixed(3)}`);
  }
}
