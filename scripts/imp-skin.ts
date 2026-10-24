// scripts/imp-skin.ts
//
// Write assets-source/imp-kit/skin.json: the imp's rest skeleton and its marched skin seen from the FRONT, so the
// Blender kit (assets-source/imp-kit/make_*.py) seats the ocular plate, the teeth and the chest spreader ON the flesh
// instead of on guessed numbers. Re-run after any edit to imp.blob's head or torso:
//   npx tsx scripts/imp-skin.ts
// `front.<limb>` is a grid over x and y (blob rest coords, 5 mm steps): the first surface of that limb's clusters met
// by a ray travelling -z from z +1, with its normal; null where the ray misses. `back.<limb>` is the same from behind.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const doc = parseBlob(readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/imp.blob'), 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));
const only = (limb: string) => ({ ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === limb })) }) as typeof built;
const r5 = (v: number[]) => v.map(x => +x.toFixed(5));

function frontGrid(limb: string, x0: number, x1: number, y0: number, y1: number, step = 0.005, dz = -1) {
  const body = only(limb);
  const xs: number[] = [], ys: number[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) xs.push(+x.toFixed(4));
  for (let y = y0; y <= y1 + 1e-9; y += step) ys.push(+y.toFixed(4));
  const P: (number[] | null)[][] = [], N: (number[] | null)[][] = [];
  for (const y of ys) {
    const pr: (number[] | null)[] = [], nr: (number[] | null)[] = [];
    for (const x of xs) {
      let z = -dz, hit = false;
      for (let i = 0; i < 800 && Math.abs(z) <= 1; i++) { const s = sdBody([x, y, z], body); if (s < 2e-4) { hit = true; break; } z += dz * Math.max(s * 0.9, 2e-4); }
      if (!hit) { pr.push(null); nr.push(null); continue; }
      const p: V = [x, y, z], e = 6e-4, s0 = sdBody(p, body);
      const n: V = [sdBody([x + e, y, z], body) - s0, sdBody([x, y + e, z], body) - s0, sdBody([x, y, z + e], body) - s0];
      const l = Math.hypot(...n) || 1;
      pr.push(r5(p)); nr.push(r5(n.map(v => v / l)));
    }
    P.push(pr); N.push(nr);
  }
  return { xs, ys, P, N };
}

const bones: Record<string, { head: number[]; tail: number[] }> = {};
for (const [k, b] of built.bones as unknown as Map<string, { head: V; tail: V }>) bones[k] = { head: r5(b.head), tail: r5(b.tail) };
const out = {
  bones,
  front: {
    head: frontGrid('head', -0.10, 0.10, 1.50, 1.80),
    torso: frontGrid('torso', -0.16, 0.16, 1.10, 1.50),
  },
  // The same from BEHIND (rays travelling +z from z -1): the dorsal spines' seats.
  back: {
    torso: frontGrid('torso', -0.20, 0.20, 1.10, 1.55, 0.005, 1),
    head: frontGrid('head', -0.10, 0.10, 1.50, 1.80, 0.005, 1),
  },
};
writeFileSync(resolve(ROOT, 'assets-source/imp-kit/skin.json'), JSON.stringify(out));
console.log('imp-skin: wrote assets-source/imp-kit/skin.json');
for (const [k, b] of Object.entries(bones)) console.log(k.padEnd(12), b.head, b.tail);
