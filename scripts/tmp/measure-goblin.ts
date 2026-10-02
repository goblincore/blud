// Ad-hoc: march the goblin's .blob field outward from bone axes so the kit's
// rings are MEASURED, not eyeballed (goblin-kit.wam's rule). Prints metres.
// Torso/arm/leg sections use LIMB-ISOLATED cluster fields — marching the whole
// body from the spine runs straight into the merged arm/fist field and reads
// 0.49 where the torso is 0.24.
//   npx tsx scripts/tmp/measure-goblin.ts
import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';
import { sdBody } from '../../src/lab/sdf-zombie/validate';
import { smin } from '../../src/lab/sdf-zombie/validate';
import { sdPrimitive } from '../../src/lab/sdf-zombie/validate';
import type { Body, Vec3 } from '../../src/lab/sdf-zombie/types';

const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/goblin.blob', 'utf8'));
const body: Body = buildBody(compileBlob(doc, compileFace(doc)));
if (body.errors.length) console.log('BUILD ERRORS:', body.errors);

/** sdBody restricted to the named clusters (additive prims only; no carves here). */
function sdClusters(p: Vec3, limbs: string[]): number {
  let d = 1e9;
  for (const c of body.clusters) {
    if (!c.alive || !limbs.includes(c.limb)) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub' || prim.op === 'groove' || prim.op === 'bone'
        || prim.op === 'organ' || prim.dead) continue;
      d = smin(d, sdPrimitive(p, prim), prim.blendK);
    }
  }
  return d;
}

type Field = (p: Vec3) => number;

/** Distance from c along dir to the first surface crossing (bisected). NaN if none. */
function march(field: Field, c: Vec3, dir: Vec3, max = 0.6): number {
  const at = (s: number): Vec3 => [c[0] + dir[0] * s, c[1] + dir[1] * s, c[2] + dir[2] * s];
  if (field(at(0)) > 0) return NaN; // start outside flesh
  let lo = 0, hi = 0.004;
  while (field(at(hi)) < 0 && hi < max) hi *= 1.6;
  if (hi >= max) return NaN;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (field(at(mid)) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const X: Vec3 = [1, 0, 0], Z: Vec3 = [0, 0, 1], Y: Vec3 = [0, 1, 0];
const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
const f = (n: number) => (Number.isNaN(n) ? '  --  ' : n.toFixed(4));

function section(label: string, field: Field, c: Vec3) {
  const xp = march(field, c, X), xm = march(field, c, neg(X));
  const zp = march(field, c, Z), zm = march(field, c, neg(Z));
  const yp = march(field, c, Y), ym = march(field, c, neg(Y));
  console.log(
    `${label}  c=(${c.map(n => n.toFixed(3)).join(',')})  ` +
    `w=${f(xp + xm)} (+x ${f(xp)} / -x ${f(xm)})  d=${f(zp + zm)} (+z ${f(zp)} / -z ${f(zm)})` +
    `  up=${f(yp)} dn=${f(ym)}`);
}

function boneAt(name: string, t: number): Vec3 {
  const b = body.bones.get(name);
  if (!b) throw new Error(`no bone ${name}`);
  return [b.head[0] + (b.tail[0] - b.head[0]) * t,
          b.head[1] + (b.tail[1] - b.head[1]) * t,
          b.head[2] + (b.tail[2] - b.head[2]) * t];
}

const H = 1.30; // goblin height; WAM wants height fractions
const TORSO: Field = p => sdClusters(p, ['torso']);
const ARML: Field = p => sdClusters(p, ['armL']);
const LEGL: Field = p => sdClusters(p, ['legL']);
const ALL: Field = p => sdBody(p, body);

console.log(`# goblin.blob flesh, marched from bone axes (metres; divide by ${H} for WAM height fractions)`);
console.log('--- TORSO cluster only ---');
for (const t of [0.0, 0.25, 0.5, 0.75, 1.0]) section(`pelvis t${t.toFixed(2)}`, TORSO, boneAt('pelvis', t));
for (const t of [0.0, 0.25, 0.5, 0.75, 1.0]) section(`spine1 t${t.toFixed(2)}`, TORSO, boneAt('spine1', t));
for (const t of [0.0, 0.25, 0.5, 0.75, 0.95]) section(`chest  t${t.toFixed(2)}`, TORSO, boneAt('chest', t));

console.log('\n--- ARML cluster only: shoulder orb + arm ---');
section('clavicle t1.00 (orb)', ARML, boneAt('clavicle.l', 1.0));
for (const t of [0.0, 0.1, 0.25, 0.5, 0.75, 0.9]) section(`upperarm.l t${t.toFixed(2)}`, ARML, boneAt('upperarm.l', t));
for (const t of [0.0, 0.5, 1.0]) section(`forearm.l  t${t.toFixed(2)}`, ARML, boneAt('forearm.l', t));

console.log('\n--- LEGL cluster only ---');
for (const t of [0.0, 0.25, 0.5, 0.75, 0.9, 1.0]) section(`thigh.l t${t.toFixed(2)}`, LEGL, boneAt('thigh.l', t));
for (const t of [0.0, 0.25, 0.5, 0.75, 1.0]) section(`shin.l  t${t.toFixed(2)}`, LEGL, boneAt('shin.l', t));

console.log('\n--- FOOT (legL) ---');
{
  const a = boneAt('shin.l', 1.0);
  console.log('ankle (shin tail) =', a.map(n => n.toFixed(4)).join(','));
  for (const t of [-0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]) {
    const c = boneAt('foot.l', t);
    section(`foot t${t.toFixed(2)}`, LEGL, c);
  }
  console.log('flesh top above ankle: sd along shin axis');
  for (const t of [0.8, 0.9, 1.0]) { const c = boneAt('shin.l', t); console.log(`shin t${t.toFixed(2)} y=${c[1].toFixed(3)} sd=${ALL(c).toFixed(4)}`); }
}

console.log('\n--- WHOLE BODY at belt height (thigh tops widen the hips: cluster-isolated torso numbers under-measure here) ---');
for (const t of [0.5, 0.66, 0.84, 1.0]) section(`ALL pelvis t${t.toFixed(2)}`, ALL, boneAt('pelvis', t));
for (const t of [0.1, 0.25]) section(`ALL spine1 t${t.toFixed(2)}`, ALL, boneAt('spine1', t));

console.log('\n--- HEAD (whole body field), x half-width and front surface by height and z ---');
{
  const sk = boneAt('skull', 0.45);
  console.log('skull t0.45 =', sk.map(n => n.toFixed(4)).join(','));
  for (const y of [1.20, 1.24, 1.28]) {
    for (const z of [0.09, 0.06, 0.03, 0.0, -0.03]) {
      const c: Vec3 = [0, y, z];
      const xp = march(ALL, c, X, 0.3);
      console.log(`y=${y.toFixed(2)} z=${z.toFixed(2)}  x half-width=${f(xp)}`);
    }
    // front surface at the centreline and at x=0.045
    for (const x of [0, 0.045, 0.07]) {
      const c: Vec3 = [x, y, -0.02];
      console.log(`y=${y.toFixed(2)} x=${x.toFixed(3)}  front z=${f(march(ALL, c, Z, 0.4) - 0.02)}`);
    }
  }
}

console.log('\n--- NECK (head-limb cluster only: the shoulders are another cluster) ---');
{
  const HEADF: Field = p => sdClusters(p, ['head']);
  for (const t of [0.0, 0.15, 0.3, 0.45, 0.6, 0.8]) section(`neck t${t.toFixed(2)}`, HEADF, boneAt('neck', t));
  const n0 = boneAt('neck', 0), n1 = boneAt('neck', 1);
  console.log('neck base', n0.map(v => v.toFixed(4)).join(','), ' neck top', n1.map(v => v.toFixed(4)).join(','));
}
