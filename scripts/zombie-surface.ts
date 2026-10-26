// scripts/zombie-surface.ts
//
// Probe zombie.blob's skin for the Blender kit (assets-source/zombie-kit/): straps, cuffs, trousers and boots are
// laid on the PROBED skin, not round a bone (biomech-style.md, "Lay the kit on the PROBED skin").
//
//   npx tsx scripts/zombie-surface.ts [name]  ->  assets-source/zombie-kit/surface.json
//
// torso: rings[y] of skin points at 6 deg steps (0 = +z front, +90 = the body's left, +x), torso cluster alone.
// limbs: per bone, rings at t steps of 0.04 of skin RADII round the bone at 15 deg steps in the bake's frame
//        (f = rest +z off the bone axis, s = f x axis; ph 0 front, +90 outward), its limb's clusters alone.
// Coordinates are the .blob's rest frame (metres, Y up, +Z forward); the Blender side converts with bv().
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = process.argv[2] ?? 'zombie';
const doc = parseBlob(readFileSync(resolve(ROOT, `src/lab/sdf-zombie/characters/${NAME}.blob`), 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;
const only = (limbs: string[]) => ({ ...built, clusters: built.clusters.map(c => ({ ...c, alive: limbs.includes(c.limb) })) }) as typeof built;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V): V => mul(a, 1 / Math.hypot(...a));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** March from `o + dir * r0` inward along -dir to the field's surface; the distance from o, or -1. */
function radius(field: typeof built, o: V, dir: V, r0 = 0.6) {
  let r = r0;
  for (let i = 0; i < 500; i++) {
    const d = sdBody(add(o, mul(dir, r)), field);
    if (Math.abs(d) < 1e-4) return r;
    r -= Math.max(Math.abs(d) * 0.9, 2e-4) * Math.sign(d);
    if (r < 0) return -1;
  }
  return r;
}

const torsoField = only(['torso']);
const torso: { y: number; pts: V[] }[] = [];
for (let y = 0.84; y <= 1.481; y += 0.01) {
  const pts: V[] = [];
  for (let th = 0; th < 360; th += 6) {
    const a = th * Math.PI / 180, dir: V = [Math.sin(a), 0, Math.cos(a)], o: V = [0, y, 0.02];
    const r = radius(torsoField, o, dir);
    pts.push((r < 0 ? o : add(o, mul(dir, r))).map(r4) as V);
  }
  torso.push({ y: r4(y), pts });
}

const limbs: Record<string, { head: V; tail: V; t: number[]; ph: number[]; r: number[][] }> = {};
for (const b of ['upperArm', 'foreArm', 'thigh', 'shin', 'foot']) for (const sd of ['l', 'r']) {
  const name = `${b}.${sd}`, { head, tail } = bones.get(name)!;
  const field = only(b === 'upperArm' || b === 'foreArm' ? [sd === 'l' ? 'armL' : 'armR'] : [sd === 'l' ? 'legL' : 'legR']);
  const u = norm(sub(tail, head));
  // The bake's frame; a foot points along +z, so take its front as down (-y) instead.
  const fw = Math.abs(u[2]) > 0.9 ? [0, -1, 0] as V : norm(sub([0, 0, 1], mul(u, u[2])));
  const s = cross(fw, u), o = sd === 'r' ? -1 : 1;
  const T: number[] = [], PH: number[] = [], R: number[][] = [];
  for (let ph = 0; ph < 360; ph += 15) PH.push(ph);
  for (let t = -0.12; t <= 1.121; t += 0.04) {
    T.push(r4(t));
    const axis = add(head, mul(sub(tail, head), t));
    R.push(PH.map(ph => { const a = ph * Math.PI / 180; return r4(radius(field, axis, norm(add(mul(fw, Math.cos(a)), mul(s, o * Math.sin(a)))), 0.3)); }));
  }
  limbs[name] = { head: head.map(r4) as V, tail: tail.map(r4) as V, t: T, ph: PH, r: R };
}

const path = resolve(ROOT, 'assets-source/zombie-kit/surface.json');
writeFileSync(path, JSON.stringify({ name: NAME, torso, limbs }) + '\n');
console.log(`zombie-surface: ${path} (${torso.length} torso rings, ${Object.keys(limbs).length} limbs)`);
