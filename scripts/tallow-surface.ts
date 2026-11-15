// scripts/tallow-surface.ts
//
// Probes tallow.blob's skin for the kit (assets-source/tallow-kit/): the boiler, the belly ports, the hoses and the
// feeding mask sit ON his surface, and a body this fat is nothing like a cylinder round a bone (biomech-style.md,
// "Lay the kit on the PROBED skin"). Writes assets-source/tallow-kit/surface.json in BLOB coords (x, y, z; +z front):
//   bones   every bone's head and tail
//   torso   a radial table of the torso + head skin: for each height `ys[j]` and angle `angs[i]` (degrees, 0 = front,
//           90 = +x, his left) the distance from the vertical axis through (0, y, ZC) to the skin; 0 where the axis
//           is outside the flesh
// tallow_common.py's `tp(y, ang, off)` reads it. Re-run whenever the torso or head masses move, then rebuild the kit.
//
//   npx tsx scripts/tallow-surface.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
import type { Vec3 } from '../src/lab/sdf-zombie/types';

const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/tallow.blob', 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
// Torso + head only: an arm or a leg must not catch a ray meant for the flank.
const keep = new Set(['torso', 'head']);
const field = { ...body, prims: body.prims.filter(p => keep.has(p.limb)) } as typeof body;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

const ZC = 0.0;
const ys: number[] = []; for (let y = 0.80; y <= 2.0601; y += 0.02) ys.push(r4(y));
const angs: number[] = []; for (let a = 0; a < 360; a += 5) angs.push(a);
const R = ys.map(y => angs.map(a => {
  if (sdBody([0, y, ZC], field) > 0) return 0;
  const d: Vec3 = [Math.sin(a * Math.PI / 180), 0, Math.cos(a * Math.PI / 180)];
  let t = 0;
  for (; t < 1.0; t += 0.002) if (sdBody([d[0] * t, y, ZC + d[2] * t], field) > 0) break;
  return r4(t);
}));
const bones = Object.fromEntries([...body.bones].map(([n, b]) => [n, { head: b.head.map(r4), tail: b.tail.map(r4) }]));
writeFileSync('assets-source/tallow-kit/surface.json', JSON.stringify({ bones, torso: { zc: ZC, ys, angs, R } }));
console.log('wrote assets-source/tallow-kit/surface.json', ys.length, 'x', angs.length);
for (const y of [0.9, 1.1, 1.3, 1.5, 1.7, 1.86, 2.0]) {
  const j = ys.findIndex(v => Math.abs(v - y) < 0.011);
  console.log(`y ${y}: front ${R[j]![0]} left ${R[j]![18]} back ${R[j]![36]}`);
}
