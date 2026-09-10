import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';
import { sdBody } from '../../src/lab/sdf-zombie/validate';
import type { Vec3 } from '../../src/lab/sdf-zombie/types';

const src = readFileSync('src/lab/sdf-zombie/characters/cyberbride.blob', 'utf8');
const doc = parseBlob(src);
const b = buildBody(compileBlob(doc, compileFace(doc)));
const torso = b.clusters.find(c => c.limb === 'torso')!;
const slice = b.prims.slice(torso.start, torso.start + torso.count);
const field = { prims: slice, clusters: [{ ...torso, start: 0, count: slice.length }] };
const sub = (a: Vec3, c: Vec3): Vec3 => [a[0]-c[0], a[1]-c[1], a[2]-c[2]];
const len = (v: Vec3) => Math.hypot(...v);
{
  const { strandedOf } = await import('../../src/lab/sdf-zombie/blob-checks');
  const c = b.clusters.find(c => c.limb === 'armL')!;
  for (const prim of b.prims.slice(c.start, c.start + c.count)) {
    const gap = (strandedOf as any).primGap?.(b, prim);
  }
}
for (const side of ['armL', 'armR'] as const) {
  const arm = b.clusters.find(c => c.limb === side)!;
  const join = b.bones.get(side === 'armL' ? 'clavicle.l' : 'clavicle.r')!.tail;
  console.log(side, 'join', join.map(v => v.toFixed(3)).join(','));
  for (const prim of b.prims.slice(arm.start, arm.start + arm.count)) {
    const eff = prim.radius * Math.min(...prim.scale);
    const L = len(sub(prim.b, prim.a));
    const n = Math.min(32, Math.max(2, Math.ceil(L / Math.max(eff, 1e-4))));
    let worst = Infinity, wp: Vec3 = [0,0,0];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p: Vec3 = [prim.a[0]+(prim.b[0]-prim.a[0])*t, prim.a[1]+(prim.b[1]-prim.a[1])*t, prim.a[2]+(prim.b[2]-prim.a[2])*t];
      if (len(sub(p, join)) < 0.135) continue;
      const d = sdBody(p, field as never) - eff;
      if (d < worst) { worst = d; wp = p; }
    }
    console.log(`  r=${prim.radius.toFixed(3)} worst=${worst.toFixed(4)} at (${wp.map(v=>v.toFixed(3))}) a=(${prim.a.map(v=>v.toFixed(2))}) b=(${prim.b.map(v=>v.toFixed(2))})`);
  }
}
