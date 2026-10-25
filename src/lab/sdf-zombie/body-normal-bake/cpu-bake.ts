// src/lab/sdf-zombie/body-normal-bake/cpu-bake.ts
//
// The CPU backend, and the REFERENCE every other backend is held to: per texel it finds the plain skin along a ray
// toward the region's axis, the detailed skin along the same ray, and stores the detailed normal in the plain
// surface's tangent frame (frame.ts). The field is `sdBody` (validate.ts), the same one the validators and tests
// treat as truth.
import { sdBody } from '../validate';
import { add, colAngle, mul, norm, rayDir, regionFrame, rowAxisPoint, writeFlat, writeTexel, type V } from './frame';
import { nearBody, type Body, type Region } from './regions';

/** First skin along the ray from r0 out toward the axis point P, or null. */
export function skin(body: Body, P: V, dir: V, r0: number): V | null {
  let t = r0;
  for (let i = 0; i < 300 && t > 0; i++) {
    const p = add(P, mul(dir, t));
    const d = sdBody(p, body);
    if (d < 1e-4) return p;
    t -= Math.max(d * 0.9, 2e-4);
  }
  return null;
}

export function grad(body: Body, p: V): V {
  const e = 6e-4;
  return norm([
    sdBody(add(p, [e, 0, 0]), body) - sdBody(add(p, [-e, 0, 0]), body),
    sdBody(add(p, [0, e, 0]), body) - sdBody(add(p, [0, -e, 0]), body),
    sdBody(add(p, [0, 0, e]), body) - sdBody(add(p, [0, 0, -e]), body),
  ]);
}

/** One texel's normals: the plain skin's (nb) and the detailed skin's (nd) along the ray, or null on a miss. `nb0`
 *  and `nd0` are the row's nearBody bodies. */
export function texelNormals(nb0: Body, nd0: Body, P: V, dir: V, r0: number): { nb: V; nd: V } | null {
  const pb = skin(nb0, P, dir, r0);
  if (!pb) return null;
  const pd = skin(nd0, P, dir, r0) ?? pb;
  return { nb: grad(nb0, pb), nd: grad(nd0, pd) };
}

/** Bake region R's band into `rgba` (`width` wide). Returns how many texels hit the plain skin. `takeRow`, given an
 *  IMAGE row, says whether this call bakes it (the CLI's --shards: each shard process bakes every Nth row). */
export function bakeRegionCpu(rgba: Uint8Array, width: number, R: Region, base: Body, detail: Body, takeRow: (imageRow: number) => boolean = () => true): number {
  const F = regionFrame(R.head, R.tail);
  let covered = 0;
  for (let row = 0; row < R.rows; row++) {
    if (!takeRow(R.row0 + row)) continue;
    const P = rowAxisPoint(R.head, R.tail, row, R.rows);
    const nb0 = nearBody(base, R.limb, P, R.r0), nd0 = nearBody(detail, R.limb, P, R.r0);
    for (let col = 0; col < width; col++) {
      const th = colAngle(col, width);
      const o = ((R.row0 + row) * width + col) * 4;
      writeFlat(rgba, o);
      const n = texelNormals(nb0, nd0, P, rayDir(F, th), R.r0);
      if (!n) continue;
      writeTexel(rgba, o, F, th, n.nb, n.nd);
      covered++;
    }
  }
  return covered;
}
