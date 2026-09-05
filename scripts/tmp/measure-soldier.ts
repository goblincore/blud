// Ad-hoc: march the soldier's .blob field outward from bone axes so the kit's
// rings are MEASURED, not eyeballed (goblin-kit.wam's rule). Prints metres.
// Torso/arm/leg sections use LIMB-ISOLATED cluster fields — marching the whole
// body from the spine runs straight into the merged arm/fist field and reads
// 0.49 where the torso is 0.24.
//   npx tsx scripts/tmp/measure-soldier.ts
import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';
import { sdBody } from '../../src/lab/sdf-zombie/validate';
import { smin } from '../../src/lab/sdf-zombie/validate';
import { sdPrimitive } from '../../src/lab/sdf-zombie/validate';
import type { Body, Vec3 } from '../../src/lab/sdf-zombie/types';

const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/soldier.blob', 'utf8'));
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

const TORSO: Field = p => sdClusters(p, ['torso']);
const ARML: Field = p => sdClusters(p, ['armL']);
const LEGL: Field = p => sdClusters(p, ['legL']);
const ALL: Field = p => sdBody(p, body);

console.log('--- TORSO cluster only: belt + cuirass sections ---');
for (const t of [0.0, 0.25, 0.5, 0.75, 1.0]) section(`pelvis t${t.toFixed(2)}`, TORSO, boneAt('pelvis', t));
for (const t of [0.2, 0.4, 0.6, 0.8, 1.0]) section(`spine1 t${t.toFixed(2)}`, TORSO, boneAt('spine1', t));
for (const t of [0.0, 0.25, 0.5, 0.75, 1.0]) section(`chest  t${t.toFixed(2)}`, TORSO, boneAt('chest', t));
for (const t of [0.0, 0.5, 1.0]) section(`spine2 t${t.toFixed(2)}`, TORSO, boneAt('spine2', t));

console.log('\n--- ARML cluster only: deltoid orb + upper arm ---');
for (const t of [0.0, 0.06, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9]) section(`upperarm.l t${t.toFixed(2)}`, ARML, boneAt('upperarm.l', t));
// orb crown: march +y from the orb centre (blob arm at=0.06)
section('orb centre', ARML, boneAt('upperarm.l', 0.06));

console.log('\n--- LEGL cluster only: knee + shin ---');
for (const t of [0.75, 0.85, 0.95, 1.0]) section(`thigh.l t${t.toFixed(2)}`, LEGL, boneAt('thigh.l', t));
for (const t of [0.0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8]) section(`shin.l  t${t.toFixed(2)}`, LEGL, boneAt('shin.l', t));

console.log('\n--- FOOT (legL): sections at foot-flesh height y=0.036 ---');
{
  const fa = boneAt('foot.l', 0);
  for (const t of [-0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4]) {
    const c = boneAt('foot.l', t);
    section(`foot y0.036 t${t.toFixed(2)}`, LEGL, [c[0], 0.036, c[2]]);
  }
  // z extent of the foot flesh: march +z/-z at foot centre height
  const c: Vec3 = [fa[0], 0.036, fa[2] + 0.072];
  section('foot centre   ', LEGL, c);
  console.log('ankle x =', fa[0].toFixed(4), ' ankle y =', fa[1].toFixed(4));
}

console.log('\n--- whole-body sanity: lowest flesh (any cluster) near ankle gap ---');
{
  // confirm the bare-shin gap: sdBody along the shin axis
  for (const t of [0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]) {
    const c = boneAt('shin.l', t);
    console.log(`shin axis t${t.toFixed(2)} y=${c[1].toFixed(3)} sd=${ALL(c).toFixed(4)}`);
  }
}
