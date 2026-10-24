// scripts/teratoma-skin.ts
//
// Write assets-source/teratoma-kit/skin.json: the teratoma's marched TORSO skin (no arms) sampled on a lat/lon grid
// round the ball's centre, so the Blender kit (make_teratoma.py) seats the conversion machinery ON the flesh instead
// of on a guessed ellipsoid. Re-run after any edit to teratoma.blob's torso:
//   npx tsx scripts/teratoma-skin.ts
// Grid: lat -90..90, lon -180..180 (deg; lon 0 faces +z, +90 is the body's left +x), STEP degrees. Each sample is the
// OUTERMOST surface along the ray from the centre (marched inward from 1.4 m) and its normal, in blob rest coords.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const doc = parseBlob(readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/teratoma.blob'), 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));
const body = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'torso' })) } as typeof built;
const C = (built.bones as unknown as Map<string, { head: V }>).get('pelvis')!.head;
const STEP = 3;
const lat: number[] = [], lon: number[] = [];
for (let a = -90; a <= 90; a += STEP) lat.push(a);
for (let a = -180; a <= 180; a += STEP) lon.push(a);
const P: number[][] = [], N: number[][] = [];
for (const la of lat) for (const lo of lon) {
  const a = la * Math.PI / 180, o = lo * Math.PI / 180;
  const d: V = [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)];
  let t = 1.4;
  const at = (t: number): V => [C[0] + d[0] * t, C[1] + d[1] * t, C[2] + d[2] * t];
  for (let i = 0; i < 600 && t > 0; i++) { const s = sdBody(at(t), body); if (s < 2e-4) break; t -= Math.max(s * 0.9, 2e-4); }
  const p = at(t), e = 6e-4, s0 = sdBody(p, body);
  const n: V = [sdBody([p[0] + e, p[1], p[2]], body) - s0, sdBody([p[0], p[1] + e, p[2]], body) - s0, sdBody([p[0], p[1], p[2] + e], body) - s0];
  const l = Math.hypot(...n) || 1;
  P.push(p.map(v => +v.toFixed(5))); N.push(n.map(v => +(v / l).toFixed(4)));
}
writeFileSync(resolve(ROOT, 'assets-source/teratoma-kit/skin.json'), JSON.stringify({ centre: C, step: STEP, lat, lon, P, N }));
console.log(`teratoma-skin: ${P.length} samples`);
