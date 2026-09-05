// src/lab/sdf-zombie/clusters.ts
import { CLUSTER_ORDER, type ClusterInfo, type LimbId, type Primitive, type Vec3 } from './types';
import { add, bendCtrl, len, scale as vscale, sub } from './vec';
import { boxReach, strandReach } from './extent';

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

    // Carves are holes, not surface. Including them in the bound inflates it
    // and defeats the shader's cluster cull for no gain. `start`/`count` still
    // span every member, carves included — the fold order requires that run to
    // stay contiguous.
    const solid = members.filter(p => p.op !== 'sub');
    const fitTo = solid.length > 0 ? solid : members;

    // Centroid of the capsule endpoints (plus each bent prim's control point
    // — the surface swings out there, so a bound fitted on the chord alone
    // lets the shader's cluster cull drop real horn), then the radius that
    // covers them all. Unbent prims contribute nothing extra, so every body
    // without bends gets exactly the centres it has always had.
    let sum: Vec3 = [0, 0, 0];
    let pts = 0;
    for (const p of fitTo) {
      sum = add(sum, add(p.a, p.b));
      pts += 2;
      if (p.bend !== undefined) { sum = add(sum, bendCtrl(p.a, p.b, p.bend)); pts += 1; }
    }
    const center = vscale(sum, 1 / pts);

    let radius = 0;
    for (const p of fitTo) {
      const maxScale = Math.max(p.scale[0], p.scale[1], p.scale[2]);
      const ends = p.bend === undefined
        ? [p.a, p.b] : [p.a, p.b, bendCtrl(p.a, p.b, p.bend)];
      const rMax = Math.max(p.radius, p.radiusB ?? p.radius) * boxReach(p.box) * strandReach(p.strand);
      // A shell rides `thickness` PROUD of its base capsule's surface, so its
      // outermost extent is rMax*maxScale + thickness — the extra term, or the
      // cluster sphere the shader culls with under-covers the sheet.
      const reach = rMax * maxScale + (p.shell ? p.shell.thickness : 0);
      for (const end of ends)
        radius = Math.max(radius, len(sub(end, center)) + reach);
    }

    clusters.push({
      id: CLUSTER_ORDER.indexOf(limb), limb,
      start, count: members.length,
      center, radius, alive: true,
    });
  }
  return { prims: sorted, clusters };
}
