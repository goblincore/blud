// scripts/deadeye-bandolier-path.ts
//
// The deadeye's bandolier runs diagonally round the torso, right shoulder to left hip, so its path is probed off the
// skin rather than guessed (the detail generators' method: march the torso-only body along a ray from the torso axis).
// Writes assets-source/deadeye-kit/bandolier-path.json: blob rest coords, `out` metres outside the skin, which
// make_bandolier.py lofts the strap along. Re-run if the torso masses move:
//   npx tsx scripts/deadeye-bandolier-path.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/deadeye.blob', 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));
const torso = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'torso' })) } as typeof built;
const AXIS_Z = 0.03, N = 72, OUT = 0.007;
const pts: V[] = [];
for (let i = 0; i < N; i++) {
  const th = (2 * Math.PI * i) / N;                       // 0 faces +z, +pi/2 is the body's left (+x)
  const y = 1.30 - 0.18 * Math.sin(th);                   // high over the right shoulder (th -90), low at the left hip
  const dir: V = [Math.sin(th), 0, Math.cos(th)];
  let t = 0.6;
  for (let k = 0; k < 300; k++) {
    const p: V = [dir[0] * t, y, AXIS_Z + dir[2] * t];
    const d = sdBody(p, torso);
    if (d < 1e-4) break;
    t -= Math.max(d * 0.9, 2e-4);
  }
  pts.push([dir[0] * (t + OUT), y, AXIS_Z + dir[2] * (t + OUT)].map(v => +v.toFixed(4)) as V);
}
writeFileSync('assets-source/deadeye-kit/bandolier-path.json', JSON.stringify({ out: OUT, points: pts }) + '\n');
console.log(`bandolier: ${pts.length} points, y ${Math.min(...pts.map(p => p[1])).toFixed(3)}..${Math.max(...pts.map(p => p[1])).toFixed(3)}`);
