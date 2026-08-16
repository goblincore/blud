// src/lab/sdf-zombie/translate.ts
import type { BuildResult } from './build-body';
import type { Vec3 } from './types';

/**
 * A copy of `body` with every primitive endpoint and cluster centre shifted.
 *
 * This is how a raymarched body MOVES. The shader marches in world space and
 * the packed primitives ARE the field, so setting mesh.position shifts only the
 * proxy BOX — the flesh stays put and the displaced box then clips it into
 * slices. Shared by both renderer paths so the mistake is only possible once.
 */
export function translateBody(body: BuildResult, offset: Vec3): BuildResult {
  const sh = (v: Vec3): Vec3 => [v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]];
  return {
    ...body,
    prims: body.prims.map(p => ({ ...p, a: sh(p.a), b: sh(p.b) })),
    clusters: body.clusters.map(c => ({ ...c, center: sh(c.center) })),
  };
}
