// scripts/venus-surface.ts
//
// Probes venus.blob's skin for the kit (assets-source/venus-kit/): the corset
// cage's ribs, the exo-spine and the collar must sit ON her surface (or bite a
// few millimetres into it), and a heavy body's surface is nothing like a
// cylinder round a bone. Writes assets-source/venus-kit/surface.json in BLOB
// coords (x, y, z; +z front); the make_*.py scripts convert with bv().
//
//   npx tsx scripts/venus-surface.ts
//
// Re-run whenever the torso, neck or leg masses move, then rebuild the kit.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
import type { Vec3 } from '../src/lab/sdf-zombie/types';

const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/venus.blob', 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
// Torso + head only: the arms and legs must not catch a ray meant for the waist.
const keep = new Set(['torso', 'head']);
const torsoOnly = { ...body, prims: body.prims.filter(p => keep.has(p.limb)) } as typeof body;
const r3 = (v: Vec3): Vec3 => v.map(x => Math.round(x * 10000) / 10000) as Vec3;

/** First exit from flesh marching from `o` along unit `d` (o must be inside). */
function exit(o: Vec3, d: Vec3, field = torsoOnly): Vec3 {
  let t = 0;
  for (; t < 0.8; t += 0.001) {
    if (sdBody([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], field) > 0) break;
  }
  return r3([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]);
}

/** A horizontal ring of skin points round (0, y, zc), angle 0 = front, +90 = +x (her left). */
function ring(y: number, zc: number, n = 48, field = torsoOnly): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push(exit([0, y, zc], [Math.sin(a), 0, Math.cos(a)], field));
  }
  return out;
}

// The corset: rings over the waist, where the raw lumps swell round it.
const waist: Record<string, Vec3[]> = {};
for (const y of [1.06, 1.09, 1.12, 1.15, 1.18, 1.21]) waist[y.toFixed(2)] = ring(y, -0.01);

// The back's centreline (the exo-spine rides it), pelvis to neck, and a pair
// of paramedian lines 4 cm out for the spine's lateral flanges.
const spine: Vec3[] = []; const spineL: Vec3[] = [];
for (let y = 0.96; y <= 1.47; y += 0.015) {
  spine.push(exit([0, y, 0], [0, 0, -1]));
  spineL.push(exit([0.04, y, 0], [0, 0, -1]));
}

// The neck at the collar heights.
const neck: Record<string, Vec3[]> = {};
for (const y of [1.44, 1.47, 1.50]) {
  const n = body.bones.get('neck')!;
  const t = (y - n.head[1]) / (n.tail[1] - n.head[1]);
  const zc = n.head[2] + (n.tail[2] - n.head[2]) * t;
  neck[y.toFixed(2)] = ring(y, zc, 32);
}

// The OUTER line of each thigh and shin (the knee brace's mounts) and the
// front of the shin (the greave), from the full body.
const leg = (bone: string, ts: number[], dir: Vec3) => ts.map(t => {
  const b = body.bones.get(bone)!;
  const o: Vec3 = [0, 1, 2].map(i => b.head[i]! + (b.tail[i]! - b.head[i]!) * t) as Vec3;
  return exit(o, dir, body);
});
const ts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const legs = {
  thighOuter: leg('thigh.l', ts, [1, 0, 0]), shinOuter: leg('shin.l', ts, [1, 0, 0]),
  shinFront: leg('shin.l', ts, [0, 0, 1]), thighFront: leg('thigh.l', ts, [0, 0, 1]),
};

const bones = Object.fromEntries([...body.bones].map(([n, b]) => [n, { head: r3(b.head), tail: r3(b.tail) }]));
writeFileSync('assets-source/venus-kit/surface.json', JSON.stringify({ bones, waist, spine, spineL, neck, legs }));
console.log('venus-surface: wrote assets-source/venus-kit/surface.json');
for (const [y, pts] of Object.entries(waist)) {
  console.log(`waist y ${y}: front z ${pts[0]![2]}, side x ${pts[12]![0]}, back z ${pts[24]![2]}`);
}
