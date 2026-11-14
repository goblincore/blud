// scripts/organ-skin.ts
//
// Write assets-source/organ-kit/skin.json: the organ's marched TORSO + HEAD skin seen from ABOVE (the gorehound's
// gorehound-skin.ts pointed at organ.blob), so the Blender kit seats the pipes' saddle on the bellows' real top instead
// of on guessed heights. Re-run after any edit to organ.blob's torso or head:
//   npx tsx scripts/organ-skin.ts
// Grid: x -0.46..0.46, z -0.40..1.70 (blob rest metres) every STEP. Each sample marches DOWN from y 1.8 to the first
// surface and records its height and normal (null where the ray misses).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/organ.blob', 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));
const body = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'torso' || c.limb === 'head' })) } as typeof built;
const STEP = 0.02;
const xs: number[] = [], zs: number[] = [];
for (let x = -0.46; x <= 0.4601; x += STEP) xs.push(+x.toFixed(3));
for (let z = -0.40; z <= 1.7001; z += STEP) zs.push(+z.toFixed(3));
const Y: (number | null)[][] = [], N: (V | null)[][] = [];
for (const x of xs) {
  const yr: (number | null)[] = [], nr: (V | null)[] = [];
  for (const z of zs) {
    let y = 1.8, hit = false;
    for (let i = 0; i < 800 && y > 0.3; i++) { const s = sdBody([x, y, z], body); if (s < 2e-4) { hit = true; break; } y -= Math.max(s * 0.9, 2e-4); }
    if (!hit) { yr.push(null); nr.push(null); continue; }
    const e = 6e-4, s0 = sdBody([x, y, z], body);
    const n: V = [sdBody([x + e, y, z], body) - s0, sdBody([x, y + e, z], body) - s0, sdBody([x, y, z + e], body) - s0];
    const l = Math.hypot(...n) || 1;
    yr.push(+y.toFixed(4)); nr.push(n.map(v => +(v / l).toFixed(4)) as V);
  }
  Y.push(yr); N.push(nr);
}
writeFileSync('assets-source/organ-kit/skin.json', JSON.stringify({ step: STEP, xs, zs, Y, N }));
console.log(`organ-skin: ${xs.length}x${zs.length}`);
