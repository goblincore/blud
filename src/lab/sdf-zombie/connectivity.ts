// src/lab/sdf-zombie/connectivity.ts
//
// Wound-driven limb detachment: "visually cut => actually cut". After each
// wound lands, every live non-torso limb checks whether a blast/pellet wound's
// carve sphere fully engulfs a cross-section. Pure sphere math against the
// wound list — no field evaluation, deterministic, conservative (a nick can
// never fire).
//
// Two cut kinds:
//  - cutLimbs:  the ATTACHMENT neck (limb root to torso). A full-limb sever.
//  - cutChains: the JOINTS ALONG a limb chain (knee, elbow…). Everything
//               distal to the first engulfed joint detaches as its own chunk —
//               before this, carving mid-forearm left the hand floating.
import type { BuildResult } from './build-body';
import type { ClusterInfo, LimbId, Primitive, Vec3 } from './types';
import { woundWorldPos, type Wound } from './damage';
import { add, len, normalize, scale, sub } from './vec';

/** Samples along the attachment neck. */
const NECK_SAMPLES = 4;
/** How far past the limb root, toward the torso, the neck extends (m). */
const NECK_LEN = 0.1;

/** Two endpoints closer than this are the same joint (limb chains touch). */
export const JOINT_EPS = 0.06;

/** Girth at a point: radius of the nearest live add-prim endpoint to it. */
export function endpointGirth(prims: Primitive[], at: Vec3): number {
  let best = Infinity; let girth = 0.05;
  for (const p of prims) {
    if (p.op === 'sub' || p.dead) continue;
    const g = p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]);
    for (const e of [p.a, p.b]) {
      const d = len(sub(e, at));
      if (d < best) { best = d; girth = g; }
    }
  }
  return girth;
}

/** The shared joint of two chained prims: midpoint of their closest endpoints. */
export function jointPoint(p: Primitive, q: Primitive): Vec3 {
  let best = Infinity;
  let mid: Vec3 = p.b;
  for (const e of [p.a, p.b]) for (const f of [q.a, q.b]) {
    const d = len(sub(e, f));
    if (d < best) {
      best = d;
      mid = [(e[0] + f[0]) / 2, (e[1] + f[1]) / 2, (e[2] + f[2]) / 2];
    }
  }
  return mid;
}

/**
 * A cluster's live add-prims ordered root→tip, as body.prims indices.
 * The root is the prim with an endpoint nearest the torso centre; the walk
 * then hops shared endpoints (JOINT_EPS), the same joint logic gibAllPieces
 * uses for torn points. Dead prims are not part of the chain.
 */
export function chainOrder(
  body: BuildResult, cluster: ClusterInfo, torsoCentre: Vec3,
): number[] {
  const idxs: number[] = [];
  for (let i = cluster.start; i < cluster.start + cluster.count; i++) {
    const p = body.prims[i]!;
    if (p.op === 'sub' || p.dead) continue;
    idxs.push(i);
  }
  if (idxs.length === 0) return [];

  // Root: the prim owning the endpoint nearest the torso.
  let root = idxs[0]!; let best = Infinity;
  for (const i of idxs) {
    const p = body.prims[i]!;
    for (const e of [p.a, p.b]) {
      const d = len(sub(e, torsoCentre));
      if (d < best) { best = d; root = i; }
    }
  }

  const order: number[] = [root];
  const rest = new Set(idxs.filter(i => i !== root));
  // Walk out along the chain from the root's TIP-side endpoint.
  const rootPrim = body.prims[root]!;
  let end: Vec3 = len(sub(rootPrim.a, torsoCentre)) >= len(sub(rootPrim.b, torsoCentre))
    ? rootPrim.a
    : rootPrim.b;
  while (rest.size > 0) {
    let next = -1; let matched: Vec3 | null = null; let bd = JOINT_EPS;
    for (const i of rest) {
      const p = body.prims[i]!;
      for (const e of [p.a, p.b]) {
        const d = len(sub(e, end));
        if (d < bd) { bd = d; next = i; matched = e; }
      }
    }
    if (next < 0 || matched === null) break; // chain exhausted
    order.push(next);
    rest.delete(next);
    const p = body.prims[next]!;
    // Continue from the prim's FAR endpoint (the one that did not match).
    end = len(sub(p.a, matched)) > len(sub(p.b, matched)) ? p.a : p.b;
  }
  return order;
}

/**
 * Limbs whose attachment neck is fully carved through by the wounds.
 * The neck runs from the limb's closest endpoint to the torso centre,
 * NECK_LEN toward the torso. A sample is cut when a single blast/pellet
 * wound sphere covers the whole local cross-section:
 * dist(sample, wound) + girth < wound.radius (the shader's carve depth).
 */
export function cutLimbs(
  body: BuildResult, wounds: Wound[], torsoCentre: Vec3,
): LimbId[] {
  const carves = wounds.filter(w => w.type !== 'burn');
  if (carves.length === 0) return [];
  const out: LimbId[] = [];

  for (const c of body.clusters) {
    if (!c.alive || c.limb === 'torso') continue;
    const prims = body.prims.slice(c.start, c.start + c.count);

    let root: Vec3 | null = null; let bd = Infinity;
    for (const p of prims) {
      if (p.op === 'sub' || p.dead) continue;
      for (const e of [p.a, p.b]) {
        const d = len(sub(e, torsoCentre));
        if (d < bd) { bd = d; root = e; }
      }
    }
    if (!root) continue;

    const girth = endpointGirth(prims, root);
    const dir = normalize(sub(torsoCentre, root));

    let cut = false;
    for (let k = 0; k < NECK_SAMPLES && !cut; k++) {
      const sample = add(root, scale(dir, (k / (NECK_SAMPLES - 1)) * NECK_LEN));
      for (const w of carves) {
        const centre = woundWorldPos(body.prims, w);
        if (len(sub(sample, centre)) + girth < w.radius) { cut = true; break; }
      }
    }
    if (cut) out.push(c.limb);
  }
  return out;
}

export interface ChainCut {
  limb: LimbId;
  /** Index into body.prims of the FIRST dead prim — the distal side of the cut joint. */
  fromPrim: number;
}

/**
 * Joints along each live limb chain whose cross-section a wound engulfs.
 * Returns the outermost cut per limb (everything distal to it detaches).
 *
 * Same engulfing test as cutLimbs — dist(joint, wound) + girth < radius,
 * blast/pellet only — applied at each JOINT between consecutive chain prims
 * instead of at the attachment neck. The most proximal engulfed joint wins.
 * The torso never chain-cuts (it anchors the fold) and neither does the head:
 * the head stays whole (face carves + the intact bouncing head are Blood
 * signatures, gore-feel spec §1).
 */
export function cutChains(body: BuildResult, wounds: Wound[]): ChainCut[] {
  const carves = wounds.filter(w => w.type !== 'burn');
  if (carves.length === 0) return [];
  const torso = body.clusters.find(c => c.limb === 'torso');
  if (!torso) return [];
  const out: ChainCut[] = [];

  for (const c of body.clusters) {
    if (!c.alive || c.limb === 'torso' || c.limb === 'head') continue;
    const order = chainOrder(body, c, torso.center);
    if (order.length < 2) continue;
    const prims = body.prims.slice(c.start, c.start + c.count);

    // First (most proximal) engulfed joint wins: everything past it detaches.
    for (let j = 0; j + 1 < order.length; j++) {
      const prox = body.prims[order[j]!]!;
      const distal = body.prims[order[j + 1]!]!;
      const joint = jointPoint(prox, distal);
      const girth = endpointGirth(prims, joint);
      let cut = false;
      for (const w of carves) {
        const centre = woundWorldPos(body.prims, w);
        if (len(sub(joint, centre)) + girth < w.radius) { cut = true; break; }
      }
      if (cut) { out.push({ limb: c.limb, fromPrim: order[j + 1]! }); break; }
    }
  }
  return out;
}
