// Writes assets-source/chair-kit/scars.json: the skin paths of the chair's scars (a Y-incision down his chest,
// stitched across, and two welts), for make_throne.py's `scars` part, which lays a thin raised welt and dark
// stitches along each as KIT mesh riding `chest`.
//
// WHY KIT, NOT PRIMS: as painted SDF bars (the twinhead's recipe) the paint goes to the prim NEAREST the surface,
// and this torso's wide blends put the skin ~7 mm outside its own prims, so a scar near the skin painted a ~2 cm
// band; sunk 9 mm it painted ragged dashes through the skin noise. A line this thin is a mesh's job.
//
// PLACED BY PROBE: each sample is found by marching the rest body's field along a ray from the front (-z) to the
// skin. Points are blob coords on the surface.
//
//   npx tsx scripts/chair-scars.ts      (then rebuild the kit: make_throne.py:scars)
//
// Rerun whenever the torso masses move.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
import type { Vec3 } from '../src/lab/sdf-zombie/types';

const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/chair.blob', 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));
const B = (body as unknown as { body?: typeof body }).body ?? body;

/** The skin point at (x, y), found from the front. */
function skin(x: number, y: number): Vec3 | null {
  let z = 0.6;
  for (let i = 0; i < 400; i++) {
    const d = sdBody([x, y, z], B as never);
    if (d < 1e-4) return [x, y, z];
    z -= Math.max(d * 0.8, 5e-4);
    if (z < -0.3) return null;
  }
  return null;
}

/** Skin points along a 2-D (x, y) path, `n` samples. */
function path(pts: [number, number][], n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n * (pts.length - 1);
    const k = Math.min(Math.floor(u), pts.length - 2);
    const t = u - k;
    const p = skin(pts[k]![0] + (pts[k + 1]![0] - pts[k]![0]) * t, pts[k]![1] + (pts[k + 1]![1] - pts[k]![1]) * t);
    if (p) out.push(p.map(v => +v.toFixed(4)) as Vec3);
  }
  return out;
}

const scars = {
  // the Y-incision: from each shoulder in to the sternum, then down the belly to the navel; stitched
  stitched: [
    path([[0.135, 1.020], [0.070, 0.975], [0.000, 0.935]], 24),
    path([[-0.135, 1.020], [-0.070, 0.975], [0.000, 0.935]], 24),
    path([[0.000, 0.935], [0.004, 0.840], [-0.004, 0.760]], 30),
  ],
  // welts: a cut across the right of his chest and one under the left ribs
  welts: [
    path([[-0.115, 0.960], [-0.075, 0.900], [-0.060, 0.860]], 16),
    path([[0.095, 0.860], [0.125, 0.820], [0.130, 0.780]], 16),
  ],
};
writeFileSync('assets-source/chair-kit/scars.json', JSON.stringify(scars));
console.error(`scars.json: ${scars.stitched.length + scars.welts.length} paths`);
