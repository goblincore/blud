// src/lab/sdf-zombie/webgpu/skeleton-spike/head-flesh.ts
//
// THE FLESH OF A HEAD, in the head segment's own frame at rest: what a skull fitted to the head has to stay under
// (skull-fit.ts). Pure: no renderer, no three.
//
// It is the head's OWN flesh: the prims that ride the rigid head (rig-bind.ts HeadRigid.prims) at their bind-time
// places about the neck pivot, which is the frame the head's bone prims are given (contract.ts), folded as
// sdBodyClosed folds a body. Two reasons it is not the whole body's field:
//  - it is closed under the chin, where the body's flesh runs on into the neck, and it is the flesh that turns with
//    the skull: bone held under it is covered in every pose of the head, not only at rest;
//  - it leaves out what is not head: a hair strand and a cloth shell (a hood, a veil) are flesh to the body's field,
//    and a skull that filled a hood would stand outside the scalp. (A shell's clip plane is authored in the rest
//    body's frame besides, and would cut in the wrong place here.)
// Every prim it folds is one the body folds, and a union only grows by what is added to it: a point this far inside
// the head's own flesh is at least as far inside the whole body's, short of a carve authored on another bone (no
// humanoid has one; head-flesh.test.ts pins the inequality on all of them).
import type { BuildResult } from '../../build-body';
import type { BoundRig } from '../../rig-bind';
import { sdBodyClosed, type Body } from '../../validate';
import { boxReach } from '../../extent';
import type { Primitive, Vec3 } from '../../types';
import { bendCtrl } from '../../vec';

export interface HeadFlesh {
  /** The flesh's distance at a point of the head segment's frame, metres: negative inside. */
  distance(p: readonly [number, number, number]): number;
  /** Changes when a float that reaches the field changes: a fit cached against the flesh keys on it. */
  revision: string;
  /** The middle of a box that holds the flesh, in the same frame. */
  centre: Vec3;
}

/**
 * The flesh of `body`'s head, for the rest bind `bound` (bindRig of the same body). Null for a body with no rigid
 * head, or one whose head carries no flesh of its own. The head is read as intact: a dead prim counts as built.
 */
export function headFlesh(body: BuildResult, bound: BoundRig): HeadFlesh | null {
  const head = bound.head;
  if (!head) return null;
  const prims: Primitive[] = [];
  for (const [index, local] of [...head.prims].sort((x, y) => x[0] - y[0])) {
    const pr = body.prims[index]!;
    if (pr.strand !== undefined || pr.shell !== undefined || pr.op === 'bone' || pr.op === 'organ') continue;
    prims.push({ ...pr, a: local.a, b: local.b, dead: undefined, orient: undefined });
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let h = 2166136261 >>> 0;
  const mix = (n: number) => { h ^= n >>> 0; h = Math.imul(h, 16777619) >>> 0; };
  for (const pr of prims) {
    for (const v of [...pr.a, ...pr.b, pr.radius, pr.radiusB ?? -1, ...pr.scale, pr.blendK, ...(pr.bend ?? [0, 0, 0]),
      pr.grooveDepth ?? 0, pr.grooveWidth ?? 0, pr.box?.round ?? -1])
      mix(Math.round(v * 1e6) + 0x8000000);
    mix(['add', 'sub', 'groove'].indexOf(pr.op ?? 'add') + (pr.blendProfile === 'chamfer' ? 8 : 0));
    if (pr.op === 'sub' || pr.op === 'groove') continue;
    // The surface's reach about the prim's points: the bound contract.ts gives a bone prim.
    const reach = Math.max(pr.radius, pr.radiusB ?? pr.radius) * Math.max(pr.scale[0], pr.scale[1], pr.scale[2]) * boxReach(pr.box);
    for (const q of pr.bend === undefined ? [pr.a, pr.b] : [pr.a, pr.b, bendCtrl(pr.a, pr.b, pr.bend)]) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, q[k]! - reach);
      hi[k] = Math.max(hi[k]!, q[k]! + reach);
    }
  }
  if (!Number.isFinite(lo[0]!)) return null;
  const centre: Vec3 = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
  const flesh: Body = { prims, clusters: [{ id: 0, limb: 'head', start: 0, count: prims.length, center: centre, radius: 0, alive: true }] };
  return {
    distance: p => sdBodyClosed([p[0], p[1], p[2]], flesh),
    revision: `${prims.length}:${(h >>> 0).toString(16)}`,
    centre,
  };
}
