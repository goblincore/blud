// src/lab/sdf-zombie/sever.ts
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import type { Wound } from './damage';
import { chainOrder, endpointGirth, JOINT_EPS, jointPoint, type ChainCut } from './connectivity';
import { basisFromAxis, dot, len, lerp, sub } from './vec';

export interface ChunkGroup {
  limb: LimbId;
  prims: Primitive[];
  /** Source slots before severing; copied distal prims cannot use identity. */
  sourceIndices?: number[];
  sourceBoneIndices?: number[];
  /** The severed limb's BONE prims (gore r3 refinement 6). Chunks shipped
   *  bone-free — the separate-array design's safe default — so a torn-off
   *  forearm was solid meat. Filtered by cluster exactly as `prims` is. */
  bones: Primitive[];
  /** World-space centre at the moment of detachment. */
  origin: Vec3;
  /** World points where this piece tore away (joints/attachment) — torn-end wounds. */
  tornAt: Vec3[];
}

export interface SeverResult {
  body: BuildResult;
  chunk: ChunkGroup;
  /** Marks the stump as exposed meat. Null when nothing was severed. */
  stumpWound: Wound | null;
}

/**
 * Severs a limb by clearing its cluster's alive flag.
 *
 * It deliberately does NOT remove primitives from the array. The shader's
 * smooth-min is non-associative, so re-packing would change the fold order and
 * silently reshape the rest of the body. Alive flags keep the sequence fixed.
 */
export function severLimb(body: BuildResult, limb: LimbId): SeverResult {
  if (limb === 'torso') throw new Error('cannot sever the torso — it anchors the fold order');

  const cluster = body.clusters.find(c => c.limb === limb);
  if (!cluster || !cluster.alive)
    return { body, chunk: { limb, prims: [], bones: [], origin: [0, 0, 0], tornAt: [] }, stumpWound: null };

  const prims = body.prims.slice(cluster.start, cluster.start + cluster.count)
    .filter(p => !p.dead); // mid-limb-severed prims already left as chunks
  // Bone leaves with its limb. Bones live in their own array and carry the
  // cluster INDEX they belong to, so this is a filter rather than a slice.
  const clusterIdx = body.clusters.findIndex(c => c.limb === limb);
  const bones = (body.bonePrims ?? []).filter(b => b.cluster === clusterIdx && !b.dead);
  const clusters = body.clusters.map(c => (c.limb === limb ? { ...c, alive: false } : c));
  const next: BuildResult = { ...body, clusters };

  // Anchor the stump on the nearest LIVE primitive to the removed cluster,
  // so the wound rides flesh that still exists.
  const live = body.prims
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.op !== 'sub'   // a stump must anchor to flesh, not a hole
      && !p.dead
      && p.limb !== limb
      && clusters.find(c => c.limb === p.limb)?.alive);

  let primIdx = -1, best = Infinity;
  for (const { p, i } of live) {
    const d = len(sub(p.a, cluster.center));
    if (d < best) { best = d; primIdx = i; }
  }

  const anchor = primIdx < 0 ? null : body.prims[primIdx]!;
  const stumpWound: Wound | null = anchor === null ? null : {
    injuryIgnored: true,
    primIdx,
    // Place it on the segment between the anchor and the removed cluster's centre.
    local: toLocalApprox(anchor, lerp(anchor.a, cluster.center, 0.6)),
    radius: cluster.radius * 0.45,
    type: 'blast',
    ageSec: 0,
  };

  return { body: next, chunk: { limb, prims, bones,
    sourceIndices: prims.map(p => body.prims.indexOf(p)),
    sourceBoneIndices: bones.map(p => body.bonePrims.indexOf(p)),
    origin: cluster.center, tornAt: [] }, stumpWound };
}

/** Local-frame offset from a primitive's head, matching damage.ts's convention. */
function toLocalApprox(prim: Primitive, world: Vec3): Vec3 {
  // Same basis as damage.ts's frame(): w along the capsule axis, u/v perpendicular.
  // There is no import cycle — sever.ts → vec.ts is one-way.
  const axis = sub(prim.b, prim.a);
  const { u, v, w } = basisFromAxis(len(axis) === 0 ? [0, 1, 0] : axis);
  const rel = sub(world, prim.a);
  return [dot(rel, u), dot(rel, v), dot(rel, w)];
}

/**
 * Blows the whole body apart: every live cluster becomes a chunk and the body
 * is left with nothing alive.
 *
 * Unlike `severLimb` this DOES release the torso — there is no body left to
 * anchor, so the fold-order argument for protecting it no longer applies. It
 * still never removes or reorders primitives; every cluster just goes dead,
 * so the invariant holds by the same mechanism.
 *
 * Chunks are seeded from the CURRENT primitive set, so gibs reflect damage
 * already dealt — an arm shot off earlier is simply not in the pile.
 */
export function gibAll(body: BuildResult): { body: BuildResult; chunks: ChunkGroup[] } {
  const chunks: ChunkGroup[] = [];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    // Dead prims left the body as mid-limb chunks already — never resurrect
    // them (a full gib after a severed hand must not spawn a second hand).
    const prims = body.prims.slice(c.start, c.start + c.count).filter(p => !p.dead);
    if (prims.length === 0) continue;
    // A gibbed limb takes its bone with it — the cheapest visible payoff of
    // the bone array (gore r3 refinement 6).
    const ci = body.clusters.indexOf(c);
    const cBones = (body.bonePrims ?? []).filter(b => b.cluster === ci && !b.dead);
    chunks.push({ limb: c.limb, prims, bones: cBones, origin: c.center, tornAt: [] });
  }
  return {
    body: { ...body, clusters: body.clusters.map(c => ({ ...c, alive: false })) },
    chunks,
  };
}

/**
 * Blows the body apart into PER-PRIMITIVE pieces — "lots of small chunks".
 *
 * Non-head clusters emit one piece per additive prim; the head stays whole
 * because its face carves and skull sphere don't survive splitting (and the
 * intact bouncing head is a Blood signature). Same alive-flag mechanism as
 * gibAll: nothing is removed or reordered, so the fold-order invariant holds.
 *
 * Each piece's tornAt lists the world points where it tore away: every
 * endpoint it shared with a neighbouring prim of the same cluster (the joint
 * chain), or — for the piece nearest the torso — its attachment end. DEAD
 * prims do not get pieces, but they still count as joint partners: the thigh
 * next to a severed shin is torn at the knee as well as the hip.
 */
export function gibAllPieces(
  body: BuildResult, torsoCentre: Vec3,
): { body: BuildResult; chunks: ChunkGroup[] } {
  const chunks: ChunkGroup[] = [];
  for (const c of body.clusters) {
    if (!c.alive) continue;
    const prims = body.prims.slice(c.start, c.start + c.count).filter(p => !p.dead);
    if (prims.length === 0) continue;
    if (c.limb === 'head') {
      // Whole head; torn at its closest endpoint to the torso (the neck).
      let neck: Vec3 = prims[0]!.a;
      let best = Infinity;
      for (const p of prims) {
        if (p.op === 'sub') continue;
        for (const e of [p.a, p.b]) {
          const d = len(sub(e, torsoCentre));
          if (d < best) { best = d; neck = e; }
        }
      }
      const hi = body.clusters.indexOf(c);
      const hBones = (body.bonePrims ?? []).filter(b => b.cluster === hi && !b.dead);
      chunks.push({ limb: c.limb, prims, bones: hBones, origin: c.center, tornAt: [neck] });
      continue;
    }
    // Joint partners include dead prims — see the doc comment.
    const adds = prims.filter(p => p.op !== 'sub');
    for (const p of adds) {
      if (p.dead) continue;
      const tornAt: Vec3[] = [];
      for (const e of [p.a, p.b]) {
        const isJoint = adds.some(q => q !== p &&
          (len(sub(q.a, e)) < JOINT_EPS || len(sub(q.b, e)) < JOINT_EPS));
        if (isJoint) tornAt.push(e);
      }
      if (tornAt.length === 0) {
        // A single-prim cluster (or an isolated prim): torn where it met the body.
        tornAt.push(len(sub(p.a, torsoCentre)) < len(sub(p.b, torsoCentre)) ? p.a : p.b);
      }
      const origin: Vec3 = [
        (p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2,
      ];
      // A single-prim fragment: bone would have to be split to match it, so
      // this one stays bone-free like the gobs path.
      chunks.push({ limb: c.limb, prims: [p], bones: [], origin, tornAt: tornAt.slice(0, 2) });
    }
  }
  return {
    body: { ...body, clusters: body.clusters.map(c => ({ ...c, alive: false })) },
    chunks,
  };
}

/**
 * Severs a limb FROM a mid-chain prim outward: distal prims go dead (never
 * removed — fold order is sacred), the cluster stays alive with its proximal
 * prims, and the detached prims come back as a chunk group.
 *
 * The distal set is recomputed from the CURRENT body's chain rather than
 * trusted from the cut, so a stale cut can never resurrect or double-take.
 */
export function severDistal(body: BuildResult, cut: ChainCut): SeverResult {
  const empty: SeverResult = {
    body,
    // Mid-limb cuts make SUB-limb pieces; splitting a bone across a cut is
    // its own problem, so these stay bone-free rather than guessing.
    chunk: { limb: cut.limb, prims: [], bones: [], origin: [0, 0, 0], tornAt: [] },
    stumpWound: null,
  };
  const cluster = body.clusters.find(c => c.limb === cut.limb);
  const torso = body.clusters.find(c => c.limb === 'torso');
  if (!cluster || !cluster.alive || !torso) return empty;

  const order = chainOrder(body, cluster, torso.center);
  const pos = order.indexOf(cut.fromPrim);
  // pos 0 would be the attachment end — that is cutLimbs' job, not ours.
  if (pos < 1) return empty;

  const proxIdx = order[pos - 1]!;
  const distalIdxs = order.slice(pos);
  const prox = body.prims[proxIdx]!;
  const joint = jointPoint(prox, body.prims[distalIdxs[0]!]!);

  const distalSet = new Set(distalIdxs);
  const prims = body.prims.map((p, i) => (distalSet.has(i) ? { ...p, dead: true } : p));

  // BONES ACROSS THE CUT (bone tubes, 2026-09-03). Flesh beyond the joint dies,
  // so a bone left spanning it would stick out of the stump into the air —
  // exactly what the tube renderer showed on a mid-arm slug (the field had
  // hidden it inside the stump's wound zone). Split every bone of this cluster
  // against the cut plane through `joint` (normal = toward the distal side):
  // wholly proximal stays, wholly distal moves to the chunk, a spanning bone is
  // cut at the plane — the body keeps the proximal piece, the chunk the distal
  // one — with the radius interpolated at the cut and the bend dropped (a half
  // bone is straight enough). Body bone count is conserved with the chunk.
  const distalFirst = body.prims[distalIdxs[0]!]!;
  const dc: Vec3 = [(distalFirst.a[0] + distalFirst.b[0]) / 2, (distalFirst.a[1] + distalFirst.b[1]) / 2, (distalFirst.a[2] + distalFirst.b[2]) / 2];
  const nRaw = sub(dc, joint);
  const nLen = len(nRaw) || 1;
  const nrm: Vec3 = [nRaw[0] / nLen, nRaw[1] / nLen, nRaw[2] / nLen];
  const clusterIdx = body.clusters.indexOf(cluster);
  const bodyBones: Primitive[] = [];
  const chunkBones: Primitive[] = [];
  const sourceBoneIndices: number[] = [];
  for (const [boneIndex, b] of (body.bonePrims ?? []).entries()) {
    if (b.cluster !== clusterIdx || b.dead) { bodyBones.push(b); continue; }
    const da = dot(sub(b.a, joint), nrm), db = dot(sub(b.b, joint), nrm);
    if (da <= 0 && db <= 0) { bodyBones.push(b); continue; }
    if (da > 0 && db > 0) { bodyBones.push({ ...b, dead: true }); chunkBones.push({ ...b, dead: false }); sourceBoneIndices.push(boneIndex); continue; }
    const t = da / (da - db);
    const cutP = lerp(b.a, b.b, t);
    const r1 = b.radius, r2 = b.radiusB ?? b.radius;
    const rCut = r1 + (r2 - r1) * t;
    const proxHalf: Primitive = da <= 0
      ? { ...b, b: cutP, radiusB: rCut, bend: undefined }
      : { ...b, a: cutP, radius: rCut, bend: undefined };
    const distHalf: Primitive = da <= 0
      ? { ...b, a: cutP, radius: rCut, bend: undefined, dead: false }
      : { ...b, b: cutP, radiusB: rCut, bend: undefined, dead: false };
    bodyBones.push(proxHalf);
    chunkBones.push(distHalf);
    sourceBoneIndices.push(boneIndex);
  }

  // Live copies for the chunk: on the body they are dead, but the chunk is
  // its own standalone piece and must still render (packBody writes w=2 for
  // dead prims — a dead-flagged copy would march as nothing).
  const chunkPrims = distalIdxs.map(i => ({ ...body.prims[i]!, dead: false }));
  let ox = 0, oy = 0, oz = 0;
  for (const p of chunkPrims) {
    ox += (p.a[0] + p.b[0]) / 2;
    oy += (p.a[1] + p.b[1]) / 2;
    oz += (p.a[2] + p.b[2]) / 2;
  }
  const n = chunkPrims.length || 1;
  const origin: Vec3 = [ox / n, oy / n, oz / n];

  const stumpWound: Wound = {
    injuryIgnored: true,
    primIdx: proxIdx,
    local: toLocalApprox(prox, joint),
    radius: endpointGirth(body.prims.slice(cluster.start, cluster.start + cluster.count), joint) * 1.2,
    type: 'blast',
    ageSec: 0,
  };

  return {
    body: { ...body, prims, bonePrims: bodyBones },
    // Distal bone pieces ride the chunk (split above); the body keeps the proximal halves.
    chunk: { limb: cut.limb, prims: chunkPrims, bones: chunkBones, sourceIndices: distalIdxs,
      sourceBoneIndices, origin, tornAt: [joint] },
    stumpWound,
  };
}
