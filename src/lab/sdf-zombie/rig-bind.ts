// src/lab/sdf-zombie/rig-bind.ts
import type { BuildResult } from './build-body';
import type { ClusterInfo, Primitive, Vec3 } from './types';
import { makeRig, type RigState } from './rig';
import { add, len, scale as vscale, sub } from './vec';

/** Which rig point an endpoint follows, and its fixed offset from that point. */
interface EndpointBind { point: number; offset: Vec3 }
interface PrimBind { a: EndpointBind; b: EndpointBind }

export interface BoundRig {
  rig: RigState;
  binding: PrimBind[];
}

const KEY_EPS = 1e-4;

/**
 * Builds a rig from the body's resolved bone joints and binds every primitive
 * endpoint to its nearest joint.
 *
 * One endpoint follows exactly one point — an SDF primitive is owned by a
 * single bone, so there are no skinning weights to solve and no blend seams.
 */
export function bindRig(body: BuildResult): BoundRig {
  // Deduplicate joints: a bone's tail and its child's head are the same point.
  const positions: Vec3[] = [];
  const indexOf = (p: Vec3): number => {
    for (let i = 0; i < positions.length; i++)
      if (len(sub(positions[i]!, p)) < KEY_EPS) return i;
    positions.push(p);
    return positions.length - 1;
  };

  const constraints: { a: number; b: number; rest: number; stiffness: number }[] = [];
  for (const bone of body.bones.values()) {
    const h = indexOf(bone.head);
    const t = indexOf(bone.tail);
    if (h !== t) constraints.push({ a: h, b: t, rest: len(sub(bone.tail, bone.head)), stiffness: 1 });
  }

  // Pin the lowest joint — without an anchor the whole rig falls under gravity.
  let lowest = 0;
  positions.forEach((p, i) => { if (p[1] < positions[lowest]![1]) lowest = i; });

  const rig = makeRig(
    positions.map((pos, i) => ({ pos, pinned: i === lowest })),
    constraints,
  );

  const bindEnd = (p: Vec3): EndpointBind => {
    let best = 0;
    let bestD = Infinity;
    positions.forEach((q, i) => { const d = len(sub(p, q)); if (d < bestD) { bestD = d; best = i; } });
    return { point: best, offset: sub(p, positions[best]!) };
  };

  return { rig, binding: body.prims.map(p => ({ a: bindEnd(p.a), b: bindEnd(p.b) })) };
}

/**
 * Re-derives primitive endpoints from the current rig pose and RECOMPUTES the
 * cluster bounding spheres.
 *
 * Recomputing bounds is not optional: the shader culls on them, so a stale
 * bound silently discards flesh that has moved outside it — the exact failure
 * `validateBody`'s bounding-sphere check exists to catch. Cluster start/count
 * and ordering are left untouched, preserving the fold order.
 */
export function applyRig(body: BuildResult, bound: BoundRig): BuildResult {
  const pos = bound.rig.points;
  const prims: Primitive[] = body.prims.map((p, i) => {
    const bind = bound.binding[i]!;
    const pa = pos[bind.a.point]!;
    const pb = pos[bind.b.point]!;
    return { ...p, a: add(pa.pos, bind.a.offset), b: add(pb.pos, bind.b.offset) };
  });

  const clusters: ClusterInfo[] = body.clusters.map(c => {
    const members = prims.slice(c.start, c.start + c.count);
    let sum: Vec3 = [0, 0, 0];
    for (const m of members) sum = add(sum, add(m.a, m.b));
    const center = vscale(sum, 1 / (members.length * 2));
    let radius = 0;
    for (const m of members) {
      const maxScale = Math.max(m.scale[0], m.scale[1], m.scale[2]);
      for (const end of [m.a, m.b])
        radius = Math.max(radius, len(sub(end, center)) + m.radius * maxScale);
    }
    return { ...c, center, radius };
  });

  return { ...body, prims, clusters };
}

/** Shoves the rig point nearest a world position — used to make hits push flesh. */
export function impulseAt(bound: BoundRig, world: Vec3, delta: Vec3): BoundRig {
  let best = 0;
  let bestD = Infinity;
  bound.rig.points.forEach((p, i) => {
    const d = len(sub(world, p.pos));
    if (d < bestD && !p.pinned) { bestD = d; best = i; }
  });
  return {
    ...bound,
    rig: {
      ...bound.rig,
      points: bound.rig.points.map((p, i) => i === best ? { ...p, pos: add(p.pos, delta) } : p),
    },
  };
}
