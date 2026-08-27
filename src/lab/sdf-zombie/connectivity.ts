// src/lab/sdf-zombie/connectivity.ts
//
// Wound-driven limb detachment: "visually cut => actually cut". After each
// wound lands, every live non-torso limb checks whether the blast/pellet
// carve spheres — taken as a UNION — fully carve through a cross-section.
// The section is a disc: its centre plus a ring of points at the local
// girth radius, in the plane perpendicular to the chain direction. It is
// cut iff EVERY disc sample lies inside at least one carve sphere, so two
// overlapping wounds that jointly saw through a joint sever it even though
// neither alone engulfs it (playtest 2026-08-16). Pure sphere math against
// the wound list — no field evaluation, deterministic, conservative (a nick
// can never fire).
//
// Two cut kinds:
//  - cutLimbs:  the ATTACHMENT neck (limb root to torso). A full-limb sever.
//  - cutChains: the JOINTS ALONG a limb chain (knee, elbow…). Everything
//               distal to the first engulfed joint detaches as its own chunk —
//               before this, carving mid-forearm left the hand floating.
import type { BuildResult } from './build-body';
import type { ClusterInfo, LimbId, Primitive, Vec3 } from './types';
import { woundWorldPos, type Wound } from './damage';
import { add, basisFromAxis, len, normalize, scale, sub } from './vec';

/** Samples along the attachment neck. */
const NECK_SAMPLES = 4;
/** How far past the limb root, toward the torso, the neck extends (m). */
const NECK_LEN = 0.1;

/** Two endpoints closer than this are the same joint (limb chains touch). */
export const JOINT_EPS = 0.06;

/** Ring sample count around a cross-section disc in the union-coverage test. */
export const DISC_RING_SAMPLES = 8;

/** A carve sphere in world space — blast/pellet wounds only (burns never cut).
 *  The radius is the wound's SEVER calibre (`severRadius`), which defaults
 *  to its crater radius but may exceed it — severing is a damage decision
 *  decoupled from the visual carve (see Wound.severRadius in damage.ts). */
interface CarveSphere {
  centre: Vec3;
  radius: number;
}

/** All cutting wounds of a wound list, resolved to world space, once per call. */
function carveSpheres(prims: Primitive[], wounds: Wound[]): CarveSphere[] {
  const out: CarveSphere[] = [];
  for (const w of wounds) {
    if (w.type === 'burn') continue;
    out.push({ centre: woundWorldPos(prims, w), radius: w.severRadius ?? w.radius });
  }
  return out;
}

/**
 * Is the cross-section disc at `centre` fully carved by the UNION of spheres?
 * The disc is the centre point plus a DISC_RING_SAMPLES ring at `girth`
 * radius in the plane perpendicular to `axis` (the local chain direction).
 * Cut iff EVERY sample is inside at least ONE sphere, so wounds that jointly
 * cover the section sever it. Fast path: a single sphere engulfing the whole
 * disc (dist + girth < radius, the pre-union test) implies union coverage —
 * every sample sits within `girth` of `centre` — and short-circuits the ring.
 */
function sectionCut(
  centre: Vec3, girth: number, axis: Vec3, spheres: CarveSphere[],
): boolean {
  for (const s of spheres) {
    if (len(sub(centre, s.centre)) + girth < s.radius) return true;
  }
  const { u, v } = basisFromAxis(axis);
  const samples: Vec3[] = [centre];
  for (let k = 0; k < DISC_RING_SAMPLES; k++) {
    const t = (k / DISC_RING_SAMPLES) * Math.PI * 2;
    samples.push(add(centre, add(
      scale(u, Math.cos(t) * girth), scale(v, Math.sin(t) * girth))));
  }
  return samples.every(p => spheres.some(s => len(sub(p, s.centre)) < s.radius));
}

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
 * A cluster's live add-prims root→tip, as body.prims indices — which is just
 * AUTHORED order: clusters are built root-first from the bone tree (shoulder
 * ball → upper arm → forearm → hand). The previous version re-derived the
 * chain geometrically from distance-to-torso-centre, and that proxy is wrong
 * for hanging arms — the elbow sits NEARER the torso centre than the
 * shoulder, so the walk went the wrong way, covered 2 of 4 prims, and
 * mid-arm joints were never tested (the 2026-08-16 floating-forearm bug).
 * The optional torsoCentre parameter is retained for signature compatibility
 * and ignored.
 */
export function chainOrder(
  body: BuildResult, cluster: ClusterInfo, _torsoCentre?: Vec3,
): number[] {
  const idxs: number[] = [];
  for (let i = cluster.start; i < cluster.start + cluster.count; i++) {
    const p = body.prims[i]!;
    if (p.op === 'sub' || p.dead) continue;
    idxs.push(i);
  }
  return idxs;
}

/**
 * Limbs whose attachment neck is carved through by the UNION of wounds.
 * The neck runs from the limb's closest endpoint to the torso centre,
 * NECK_LEN toward the torso. Each neck sample is a disc centred on the
 * sample, ringed at the root girth, in the plane perpendicular to the
 * root→torso direction; the limb detaches when any sample's disc is fully
 * covered (see sectionCut).
 */
export function cutLimbs(
  body: BuildResult, wounds: Wound[], torsoCentre: Vec3,
): LimbId[] {
  const spheres = carveSpheres(body.prims, wounds);
  if (spheres.length === 0) return [];
  const out: LimbId[] = [];

  for (const c of body.clusters) {
    if (!c.alive || c.limb === 'torso') continue;
    const prims = body.prims.slice(c.start, c.start + c.count);

    // The attachment root is the FIRST authored prim's proximal endpoint —
    // the end that is NOT the joint with the next prim in the chain. Distance
    // to the torso centre anchored arms at the ELBOW (nearer the centre than
    // the shoulder on a hanging arm) and full-limb severs fired mid-limb.
    const order = chainOrder(body, c);
    if (order.length === 0) continue;
    const first = body.prims[order[0]!]!;
    let root: Vec3;
    if (order.length === 1) {
      root = len(sub(first.a, torsoCentre)) <= len(sub(first.b, torsoCentre))
        ? first.a : first.b;
    } else {
      const joint = jointPoint(first, body.prims[order[1]!]!);
      root = len(sub(first.a, joint)) >= len(sub(first.b, joint)) ? first.a : first.b;
    }

    const girth = endpointGirth(prims, root);
    const dir = normalize(sub(torsoCentre, root));

    let cut = false;
    for (let k = 0; k < NECK_SAMPLES && !cut; k++) {
      const sample = add(root, scale(dir, (k / (NECK_SAMPLES - 1)) * NECK_LEN));
      if (sectionCut(sample, girth, dir, spheres)) cut = true;
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
 * Joints along each live limb chain whose cross-section the UNION of wounds
 * carves through. Returns the outermost cut per limb (everything distal to
 * it detaches).
 *
 * Same disc test as cutLimbs — blast/pellet only — applied at each JOINT
 * between consecutive chain prims, with the disc plane perpendicular to
 * the proximal→distal axis of the two chained prims. The most proximal cut
 * joint wins. The torso never chain-cuts (it anchors the fold) and neither
 * does the head: the head stays whole (face carves + the intact bouncing
 * head are Blood signatures, gore-feel spec §1).
 */
export function cutChains(body: BuildResult, wounds: Wound[]): ChainCut[] {
  const spheres = carveSpheres(body.prims, wounds);
  if (spheres.length === 0) return [];
  const torso = body.clusters.find(c => c.limb === 'torso');
  if (!torso) return [];
  const out: ChainCut[] = [];

  for (const c of body.clusters) {
    if (!c.alive || c.limb === 'torso' || c.limb === 'head') continue;
    const order = chainOrder(body, c, torso.center);
    if (order.length < 2) continue;
    const prims = body.prims.slice(c.start, c.start + c.count);

    // First (most proximal) cut joint wins: everything past it detaches.
    for (let j = 0; j + 1 < order.length; j++) {
      const prox = body.prims[order[j]!]!;
      const distal = body.prims[order[j + 1]!]!;
      const joint = jointPoint(prox, distal);
      const girth = endpointGirth(prims, joint);
      // Chain direction: proximal prim midpoint → distal prim midpoint (the
      // hand/foot are degenerate balls, so their own a→b axis would vanish).
      const mid = (p: Primitive): Vec3 => [
        (p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2,
      ];
      const axis = normalize(sub(mid(distal), mid(prox)));
      if (sectionCut(joint, girth, axis, spheres)) {
        out.push({ limb: c.limb, fromPrim: order[j + 1]! });
        break;
      }
    }
  }
  return out;
}
