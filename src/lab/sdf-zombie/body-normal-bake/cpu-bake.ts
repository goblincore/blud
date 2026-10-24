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

/** Bake region R's band into `rgba` (`width` wide). Returns how many texels hit the plain skin. */
export function bakeRegionCpu(rgba: Uint8Array, width: number, R: Region, base: Body, detail: Body): number {
  const F = regionFrame(R.head, R.tail);
  let covered = 0;
  for (let row = 0; row < R.rows; row++) {
    const P = rowAxisPoint(R.head, R.tail, row, R.rows);
    const nb0 = nearBody(base, R.limb, P, R.r0), nd0 = nearBody(detail, R.limb, P, R.r0);
    for (let col = 0; col < width; col++) {
      const th = colAngle(col, width);
      const dir = rayDir(F, th);
      const o = ((R.row0 + row) * width + col) * 4;
      writeFlat(rgba, o);
      const pb = skin(nb0, P, dir, R.r0);
      if (!pb) continue;
      const pd = skin(nd0, P, dir, R.r0) ?? pb;
      writeTexel(rgba, o, F, th, grad(nb0, pb), grad(nd0, pd));
      covered++;
    }
  }
  return covered;
}
