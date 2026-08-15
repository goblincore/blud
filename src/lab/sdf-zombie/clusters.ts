// src/lab/sdf-zombie/clusters.ts
import { CLUSTER_ORDER, type ClusterInfo, type LimbId, type Primitive, type Vec3 } from './types';
import { add, len, scale as vscale, sub } from './vec';

/**
 * Sorts primitives into the fixed CLUSTER_ORDER fold sequence and computes a
 * bounding sphere per cluster.
 *
 * The fold order is load-bearing: the quadratic smooth-min used by the shader
 * is NOT associative, so a change in fold sequence changes the surface. Sorting
 * here — and severing by clearing a cluster's alive flag rather than removing
 * primitives — keeps the sequence stable for the lifetime of the body.
 */
export function assignClusters(
  prims: Omit<Primitive, 'cluster'>[],
): { prims: Primitive[]; clusters: ClusterInfo[] } {
  const sorted: Primitive[] = prims
    .map(p => ({ ...p, cluster: CLUSTER_ORDER.indexOf(p.limb) }))
    .sort((x, y) => x.cluster - y.cluster);

  const clusters: ClusterInfo[] = [];
  let i = 0;
  while (i < sorted.length) {
    // `!`: i is always < sorted.length here (loop guard), so the index is in bounds.
    const limb: LimbId = sorted[i]!.limb;
    const start = i;
    while (i < sorted.length && sorted[i]!.limb === limb) i++;
    const members = sorted.slice(start, i);

    // Centroid of the capsule endpoints, then the radius that covers them all.
    let sum: Vec3 = [0, 0, 0];
    for (const p of members) sum = add(sum, add(p.a, p.b));
    const center = vscale(sum, 1 / (members.length * 2));

    let radius = 0;
    for (const p of members) {
      const maxScale = Math.max(p.scale[0], p.scale[1], p.scale[2]);
      for (const end of [p.a, p.b])
        radius = Math.max(radius, len(sub(end, center)) + p.radius * maxScale);
    }

    clusters.push({
      id: CLUSTER_ORDER.indexOf(limb), limb,
      start, count: members.length,
      center, radius, alive: true,
    });
  }
  return { prims: sorted, clusters };
}
