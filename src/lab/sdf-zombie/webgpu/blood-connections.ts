// src/lab/sdf-zombie/webgpu/blood-connections.ts
//
// OPTIONAL connected blood for the goo layer (blood-surface comparison task,
// 2026-09-13). The screen-space density field already fuses droplets whose
// blobs overlap, but a fast, sparse stream leaves GAPS between consecutive
// trail droplets — each one beads into its own oval, which is the owner's
// recurring "little oval drops" complaint. This module derives a bounded,
// deterministic set of EXTRA density blobs from the droplets that already
// exist, so the same wet surface pass draws tapered strands through a
// coherent emission stream and sparse ragged sheets where several streams
// run together.
//
// THREE RULES SHAPE THE WHOLE FILE:
//
//   1. NO NEW PARTICLES, NO NEW RNG. Everything here is a pure function of
//      the droplet array the sim already owns. Nothing is pushed back into
//      `BloodSim`, so the baseline simulation stays bit-identical; and the
//      builder draws no random numbers, so a seeded replay reproduces the
//      connection geometry exactly.
//   2. SAME EMITTER, PROVEN BY A STABLE STREAM ID. A connection is only ever
//      made between droplets that carry the same `stream` tag. The tag is
//      stamped at the emission site (wound / impact / trail source) and is
//      never rolled, inferred or unioned by proximity: two wounds that happen
//      to be close in space and age NEVER share a stream, because proximity is
//      exactly the signal that "these two adjacent wounds are one rope" is
//      wrong about. Untagged droplets are skipped outright rather than guessed
//      at, so a lab burst with no emitter identity can never contaminate a
//      tagged game stream.
//   3. BUDGETED AND DEGENERACY-REJECTED. Every output is clamped by a named
//      budget (nodes, strand length, strand count, sheet patches, total
//      blobs) and anything degenerate (zero-length, collinear, no remaining
//      life, non-finite) is dropped rather than emitted as a stretched quad.
//   4. HOLE TOPOLOGY RIDES THE MATERIAL GRID, NOT THE WORLD. Sheet holes and
//      radius noise are indexed by (stream id, grid col, grid row), and the
//      patch itself is laid out in a stream-local frame built from the flow
//      direction — never from the sorted world AABB. A sheet therefore moves
//      WITH the stream and its holes do not swim frame to frame as the blood
//      travels or as the AABB's widest axis happens to cross.
//
// The output is a list of GooDensityBlob placements, not meshes: feeding
// them through goo-layer's density instancer is what keeps them shaded by
// the real wet goo material instead of a flat unlit ribbon colour. Strands
// and sheets are independently toggleable for attribution.

import type { Droplet } from '../blood-sim';
import type { GooDensityBlob } from './goo-layer';

export interface ConnectionTuning {
  /** Only droplets at/above this sim size can be connection nodes. */
  minDropletSize: number;
  /** Hard cap on nodes considered per frame (keeps the O(n^2) union cheap). */
  maxNodes: number;
  /** Max world-space gap between two nodes in one stream, metres. */
  maxLinkDist: number;
  /** Max age difference between two nodes in one stream, seconds. */
  maxAgeDelta: number;
  /** Nodes past this age are ignored even if still alive. */
  maxNodeAge: number;
  /** Per-strand node budget and world length budget, metres. */
  maxStrandNodes: number;
  maxStrandLength: number;
  /** Reject a strand shorter than this (two blobs at the same point). */
  minStrandLength: number;
  /** Global strand, per-strand blob and total blob budgets. */
  maxStrands: number;
  maxStrandBlobs: number;
  maxTotalBlobs: number;
  /** World half-extent cap/floor for a strand blob, metres. */
  minRadius: number;
  maxRadius: number;
  /** Blob half-extent as a fraction of the droplet's own sim size. */
  strandRadiusScale: number;
  /** Spacing between blobs along a strand, as a fraction of blob radius. */
  strandSpacingScale: number;
  /** Taper: the newest end is this fraction narrower than the oldest end. */
  strandTaper: number;
  /** Sheets. */
  maxSheetPatches: number;
  maxSheetBlobs: number;
  /** Minimum nodes in a stream before a sheet is considered. */
  sheetMinNodes: number;
  /** Grid resolution of a sheet patch. */
  sheetCols: number;
  sheetRows: number;
  /** Base sheet blob half-extent, metres. */
  sheetRadiusScale: number;
  /** Patch spans this fraction of the stream's bounding box. */
  sheetSpanScale: number;
  /** Seeded chance a grid cell is a hole (0..1). */
  holeChance: number;
  /** A cell with no node within this multiple of the grid pitch is skipped,
   *  so a sheet cannot become a rectangle floating over empty space. */
  sheetAttachFactor: number;
  /** Remaining-life window over which a sheet fades out (seconds). 0 disables
   *  the fade. Keeps a dying sheet from popping between two frames. */
  sheetLifeFadeSec: number;
  /** Seed for the deterministic edge/hole noise. */
  noiseSeed: number;
}

/** The shipped defaults. Deliberately small: connections are a sparse
 *  addition on top of the existing field, not a second blood system. */
export const CONNECTION_TUNING: ConnectionTuning = {
  minDropletSize: 0.06,
  maxNodes: 192,
  maxLinkDist: 0.55,
  maxAgeDelta: 0.35,
  maxNodeAge: 6,
  maxStrandNodes: 12,
  maxStrandLength: 3.5,
  minStrandLength: 0.05,
  maxStrands: 24,
  maxStrandBlobs: 48,
  maxTotalBlobs: 384,
  minRadius: 0.008,
  maxRadius: 0.1,
  strandRadiusScale: 0.4,
  strandSpacingScale: 0.7,
  strandTaper: 0.45,
  maxSheetPatches: 6,
  maxSheetBlobs: 96,
  sheetMinNodes: 5,
  sheetCols: 4,
  sheetRows: 4,
  sheetRadiusScale: 0.06,
  sheetSpanScale: 0.55,
  holeChance: 0.28,
  sheetAttachFactor: 1.6,
  sheetLifeFadeSec: 0.5,
  noiseSeed: 0x9e3779b9,
};

/** An axis-aligned triple, used instead of computed object keys. */
type Triple = [number, number, number];

export interface ConnectionNode {
  x: number; y: number; z: number;
  /** The droplet's own sim size (scene units, before any view scale). */
  radius: number;
  age: number;
  remaining: number;
  /** Stable emitter id — REQUIRED for a node to take part. */
  stream: number;
  /** Gut node (organs r3) — the strand inherits the mask. */
  gut: number;
  /** Stable index into the input array, for deterministic tie-breaks. */
  index: number;
}

export interface ConnectionStrand {
  /** The stream's stable emitter id. */
  stream: number;
  /** Tapered path, oldest end first. */
  points: { x: number; y: number; z: number; radius: number }[];
  length: number;
  gut: number;
}

export interface ConnectionSheet {
  stream: number;
  centre: { x: number; y: number; z: number };
  halfW: number;
  halfH: number;
  blobs: number;
  holes: number;
  /** Stream-local frame the patch was laid out in (unit vectors). Exposed so
   *  a test can assert the frame is CONTINUOUS across a temporal step (no
   *  abrupt axis flip) rather than only that a patch exists. */
  basis: { axis0: Triple; axis1: Triple };
}

export interface ConnectionResult {
  strands: ConnectionStrand[];
  sheets: ConnectionSheet[];
  /** Ready to hand to GooLayer.setExtraBlobs(). */
  blobs: GooDensityBlob[];
  streamCount: number;
  nodeCount: number;
  /** Nodes dropped for no remaining life, wrong size, non-finite position or
   *  the node cap. */
  nodesRejected: number;
  /** Nodes dropped because they carried no `stream` tag. Kept separate from
   *  the other rejections: an untagged node is not malformed, it simply
   *  cannot be attributed to an emitter. */
  untaggedRejected: number;
  /** Strands/sheets dropped or truncated by a budget. */
  budgetClamped: number;
  /** Strands/sheets dropped by a degeneracy test. */
  degenerateRejected: number;
}

// -------------------------------------------------------------------------
// Deterministic noise (NO Math.random anywhere in this module).
// -------------------------------------------------------------------------

/** Stable 32-bit hash of three quantised coordinates and a seed, in [0,1). */
export function hash01(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(Math.round(x * 64) | 0, 374761393)
    ^ Math.imul(Math.round(y * 64) | 0, 668265263)
    ^ Math.imul(Math.round(z * 64) | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Trilinear value noise in [0,1), seeded. Used for sheet edge raggedness. */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const xf = fade(x - xi); const yf = fade(y - yi); const zf = fade(z - zi);
  const c = (dx: number, dy: number, dz: number): number => hash01(xi + dx, yi + dy, zi + dz, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * xf;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * xf;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * xf;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf;
}

// -------------------------------------------------------------------------
// Stream derivation
// -------------------------------------------------------------------------

/**
 * Group nodes STRICTLY by their stable stream id. No union-find, no distance
 * or age heuristic: two nodes are in one stream if and only if their emitter
 * said so. Groups come back ordered by smallest input index, so a seeded
 * replay cannot depend on Map iteration order.
 */
function deriveStreamGroups(nodes: ConnectionNode[]): number[][] {
  const byStream = new Map<number, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const s = nodes[i]!.stream;
    const list = byStream.get(s);
    if (list) list.push(i); else byStream.set(s, [i]);
  }
  return [...byStream.values()].sort((a, b) => a[0]! - b[0]!);
}

/** Collect the droplets that may become connection nodes, deterministically
 *  (input order preserved so a seeded replay is stable).
 *
 *  PROVENANCE IS STRICT. A droplet without a finite `stream` tag is rejected
 *  here — it is never assigned an identity by proximity. `rejected` counts
 *  the malformed/over-budget nodes; `untagged` counts the provenance
 *  rejections separately so the page can say which one happened. */
function collectNodes(droplets: readonly Droplet[], tuning: ConnectionTuning): {
  nodes: ConnectionNode[]; rejected: number; untagged: number;
} {
  const nodes: ConnectionNode[] = [];
  let rejected = 0;
  let untagged = 0;
  for (let i = 0; i < droplets.length; i++) {
    const d = droplets[i]!;
    if (d.kind === 'mist') continue;
    if (nodes.length >= tuning.maxNodes) { rejected++; continue; }
    if (d.size < tuning.minDropletSize) continue;
    const stream = d.stream;
    if (typeof stream !== 'number' || !Number.isFinite(stream)) { untagged++; continue; }
    const remaining = d.life - d.age;
    if (!(remaining > 0) || d.age > tuning.maxNodeAge) { rejected++; continue; }
    const p = d.pos;
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) { rejected++; continue; }
    nodes.push({
      x: p[0], y: p[1], z: p[2],
      radius: d.size,
      age: d.age,
      remaining,
      stream,
      gut: d.kind === 'gut' ? 1 : 0,
      index: i,
    });
  }
  return { nodes, rejected, untagged };
}

// -------------------------------------------------------------------------
// Strands
// -------------------------------------------------------------------------

/** Radius the strand blob at parametric position t (0 = oldest) uses. */
function strandRadius(baseSize: number, t: number, tuning: ConnectionTuning): number {
  const scaled = baseSize * tuning.strandRadiusScale;
  const taper = 1 - tuning.strandTaper * t;
  return Math.min(tuning.maxRadius, Math.max(tuning.minRadius, scaled * taper));
}

function buildStrand(
  members: number[], nodes: ConnectionNode[], streamId: number,
  tuning: ConnectionTuning,
): ConnectionStrand | null {
  // Oldest first, ties by input index: the strand reads from the wound
  // outward, and the order is a pure function of the node set.
  const order = [...members].sort((a, b) => {
    const na = nodes[a]!; const nb = nodes[b]!;
    return (na.age - nb.age) || (na.index - nb.index);
  });
  const path: number[] = [order[0]!];
  const visited = new Set<number>([order[0]!]);
  let current = order[0]!;
  let length = 0;
  const link2 = tuning.maxLinkDist * tuning.maxLinkDist;
  while (path.length < tuning.maxStrandNodes) {
    const c = nodes[current]!;
    let best = -1; let bestD2 = Infinity;
    for (const j of order) {
      if (visited.has(j)) continue;
      const nb = nodes[j]!;
      if (Math.abs(nb.age - c.age) > tuning.maxAgeDelta) continue;
      const dx = nb.x - c.x; const dy = nb.y - c.y; const dz = nb.z - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > link2) continue;
      if (d2 < bestD2) { bestD2 = d2; best = j; }
    }
    if (best < 0) break;
    const step = Math.sqrt(bestD2);
    if (length + step > tuning.maxStrandLength) break; // a budget, not a sail
    length += step;
    path.push(best); visited.add(best);
    current = best;
  }
  if (path.length < 2 || length < tuning.minStrandLength) return null;

  const last = path.length - 1;
  const points = path.map((idx, k) => {
    const node = nodes[idx]!;
    const t = last > 0 ? k / last : 0;
    return { x: node.x, y: node.y, z: node.z, radius: strandRadius(node.radius, t, tuning) };
  });
  return { stream: streamId, points, length, gut: nodes[path[0]!]!.gut };
}

/** Blobs along a tapered strand, oldest end first. Spacing is tied to the
 *  local radius, so a thick section gets more quads and a thin tip fewer —
 *  the taper lives in the geometry, not only the radius. Returns the blobs
 *  emitted and whether a budget truncated the run. */
function strandBlobs(strand: ConnectionStrand, budget: number, tuning: ConnectionTuning): {
  blobs: GooDensityBlob[]; clamped: boolean;
} {
  const blobs: GooDensityBlob[] = [];
  if (budget <= 0) return { blobs, clamped: true };
  for (let k = 0; k < strand.points.length - 1; k++) {
    const p0 = strand.points[k]!; const p1 = strand.points[k + 1]!;
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    const radius = (p0.radius + p1.radius) / 2;
    const steps = Math.max(1, Math.ceil(segLen / Math.max(tuning.minRadius, radius * tuning.strandSpacingScale)));
    for (let s = 0; s < steps; s++) {
      if (blobs.length >= budget) return { blobs, clamped: true };
      const t = s / steps;
      const r = p0.radius + (p1.radius - p0.radius) * t;
      blobs.push({
        x: p0.x + (p1.x - p0.x) * t,
        y: p0.y + (p1.y - p0.y) * t,
        z: p0.z + (p1.z - p0.z) * t,
        halfW: r, halfH: r, roll: 0, gut: strand.gut,
      });
    }
  }
  // The final tip, so the strand does not stop one step short.
  const tip = strand.points[strand.points.length - 1]!;
  if (blobs.length < budget) {
    blobs.push({ x: tip.x, y: tip.y, z: tip.z, halfW: tip.radius, halfH: tip.radius, roll: 0, gut: strand.gut });
  } else {
    return { blobs, clamped: true };
  }
  return { blobs, clamped: false };
}

// -------------------------------------------------------------------------
// Sheets
// -------------------------------------------------------------------------

/**
 * Stable orthonormal STREAM-LOCAL frame. `axis0` is the flow direction
 * (oldest -> newest). `axis1` is the principal direction of the nodes'
 * spread measured in the plane perpendicular to flow, so the patch lies in
 * the plane the stream actually occupies and rotates with the flow.
 *
 * This replaces the old sorted-world-AABB frame, which flipped
 * discontinuously the moment two extents crossed and sent a flat stream's
 * second axis out of its own plane. Nothing here reads absolute world
 * position, so the layout is invariant to a rigid translation.
 */
function streamFrame(members: number[], nodes: ConnectionNode[]): {
  centre: Triple; axis0: Triple; axis1: Triple;
} {
  let oldest = members[0]!;
  let newest = members[0]!;
  const centre: Triple = [0, 0, 0];
  for (const i of members) {
    const n = nodes[i]!;
    centre[0] += n.x; centre[1] += n.y; centre[2] += n.z;
    if (n.age < nodes[oldest]!.age || (n.age === nodes[oldest]!.age && i < oldest)) oldest = i;
    if (n.age > nodes[newest]!.age || (n.age === nodes[newest]!.age && i > newest)) newest = i;
  }
  const inv = 1 / Math.max(1, members.length);
  centre[0] *= inv; centre[1] *= inv; centre[2] *= inv;

  let fx = nodes[newest]!.x - nodes[oldest]!.x;
  let fy = nodes[newest]!.y - nodes[oldest]!.y;
  let fz = nodes[newest]!.z - nodes[oldest]!.z;
  let fl = Math.hypot(fx, fy, fz);
  if (fl < 1e-6) { fx = 1; fy = 0; fz = 0; fl = 1; }
  fx /= fl; fy /= fl; fz /= fl;

  // Continuous perpendicular basis: e1 is the world axis least aligned with
  // flow, projected into the flow-perpendicular plane; e2 completes it.
  const ax = Math.abs(fx); const ay = Math.abs(fy); const az = Math.abs(fz);
  const ref: Triple = (ax <= ay && ax <= az) ? [1, 0, 0]
    : (ay <= ax && ay <= az) ? [0, 1, 0] : [0, 0, 1];
  const rd = ref[0] * fx + ref[1] * fy + ref[2] * fz;
  let e1x = ref[0] - rd * fx; let e1y = ref[1] - rd * fy; let e1z = ref[2] - rd * fz;
  let e1l = Math.hypot(e1x, e1y, e1z);
  if (e1l < 1e-6) { e1x = 1; e1y = 0; e1z = 0; e1l = 1; }
  e1x /= e1l; e1y /= e1l; e1z /= e1l;
  const e2x = fy * e1z - fz * e1y;
  const e2y = fz * e1x - fx * e1z;
  const e2z = fx * e1y - fy * e1x;

  // 2x2 covariance of the flow-perpendicular offsets; the principal
  // eigenvector is axis1 (the direction the patch is widest across flow).
  let cxx = 0; let cxy = 0; let cyy = 0;
  for (const i of members) {
    const n = nodes[i]!;
    const dx = n.x - centre[0]; const dy = n.y - centre[1]; const dz = n.z - centre[2];
    const px = dx * e1x + dy * e1y + dz * e1z;
    const py = dx * e2x + dy * e2y + dz * e2z;
    cxx += px * px; cxy += px * py; cyy += py * py;
  }
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const ct = Math.cos(theta); const st = Math.sin(theta);
  const sx = e1x * ct + e2x * st;
  const sy = e1y * ct + e2y * st;
  const sz = e1z * ct + e2z * st;
  const sl = Math.hypot(sx, sy, sz) || 1;
  return { centre, axis0: [fx, fy, fz], axis1: [sx / sl, sy / sl, sz / sl] };
}

/** Deterministic hash of (stream id, material grid col, grid row), in [0,1).
 *  NOT a world position: the hole pattern is attached to the sheet's own
 *  grid, so moving the blood cannot make holes swim, and translating the
 *  whole stream leaves the pattern unchanged. */
function gridHash(stream: number, col: number, row: number, seed: number): number {
  let h = seed ^ Math.imul(stream | 0, 374761393)
    ^ Math.imul((col + 1) | 0, 668265263)
    ^ Math.imul((row + 1) | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function buildSheet(
  members: number[], nodes: ConnectionNode[], streamId: number, tuning: ConnectionTuning,
  blobBudget: number,
): { sheet: ConnectionSheet; blobs: GooDensityBlob[] } | null {
  if (members.length < tuning.sheetMinNodes || blobBudget <= 0) return null;
  const { centre, axis0, axis1 } = streamFrame(members, nodes);
  const local0 = (n: ConnectionNode): number =>
    (n.x - centre[0]) * axis0[0] + (n.y - centre[1]) * axis0[1] + (n.z - centre[2]) * axis0[2];
  const local1 = (n: ConnectionNode): number =>
    (n.x - centre[0]) * axis1[0] + (n.y - centre[1]) * axis1[1] + (n.z - centre[2]) * axis1[2];
  let lo0 = Infinity; let hi0 = -Infinity;
  let lo1 = Infinity; let hi1 = -Infinity;
  let remaining = Infinity;
  for (const i of members) {
    const n = nodes[i]!;
    const a = local0(n); const b = local1(n);
    lo0 = Math.min(lo0, a); hi0 = Math.max(hi0, a);
    lo1 = Math.min(lo1, b); hi1 = Math.max(hi1, b);
    remaining = Math.min(remaining, n.remaining);
  }
  const size0 = hi0 - lo0; const size1 = hi1 - lo1;
  // A stream that is essentially a line has a tiny second local extent and is
  // rejected — that is the "no collinear sheet" degeneracy test.
  if (size1 < tuning.minRadius * 4 || size0 < tuning.minRadius * 4) return null;

  const span0 = size0 * tuning.sheetSpanScale;
  const span1 = size1 * tuning.sheetSpanScale;
  const c0 = (lo0 + hi0) / 2; const c1 = (lo1 + hi1) / 2;
  const cols = Math.max(2, tuning.sheetCols);
  const rows = Math.max(2, tuning.sheetRows);
  const pitch0 = span0 / (cols - 1);
  const pitch1 = span1 / (rows - 1);
  const attach = tuning.sheetAttachFactor * Math.max(pitch0, pitch1, tuning.minRadius * 2);
  const attach2 = attach * attach;

  // LIFE FADE: a sheet whose newest material is near the end of its life
  // thins smoothly instead of popping out between two frames.
  const lifeFade = tuning.sheetLifeFadeSec > 0
    ? Math.min(1, Math.max(0, remaining / tuning.sheetLifeFadeSec))
    : 1;

  const blobs: GooDensityBlob[] = [];
  let holes = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (blobs.length >= blobBudget) { holes++; continue; }
      const fx = (c / (cols - 1)) - 0.5;
      const fy = (r / (rows - 1)) - 0.5;
      const l0 = c0 + fx * span0 * 2;
      const l1 = c1 + fy * span1 * 2;
      const p: Triple = [
        centre[0] + axis0[0] * l0 + axis1[0] * l1,
        centre[1] + axis0[1] * l0 + axis1[1] * l1,
        centre[2] + axis0[2] * l0 + axis1[2] * l1,
      ];
      // ATTACHMENT GATE: at least one node must be near the cell, so the
      // patch follows the flow and cannot become a floating giant sail.
      let attached = false;
      for (const i of members) {
        const nd = nodes[i]!;
        const dx = nd.x - p[0]; const dy = nd.y - p[1]; const dz = nd.z - p[2];
        if (dx * dx + dy * dy + dz * dz <= attach2) { attached = true; break; }
      }
      if (!attached) { holes++; continue; }
      // SEEDED HOLES + ragged edge: the hole is a function of the MATERIAL
      // grid cell, and the surviving radius is modulated by smooth value
      // noise on the same local grid — neither reads a world coordinate, so
      // neither swims as the sheet travels.
      if (gridHash(streamId, c, r, tuning.noiseSeed) < tuning.holeChance) { holes++; continue; }
      const n = valueNoise3(c * 0.6, r * 0.6, streamId * 0.37, tuning.noiseSeed ^ 0x5bd1e995);
      const edgeFade = 1 - 0.55 * Math.min(1, Math.hypot(fx, fy) * 2);
      const radius = tuning.sheetRadiusScale * (0.55 + 0.9 * n) * edgeFade * lifeFade;
      if (!(radius > tuning.minRadius)) { holes++; continue; }
      blobs.push({ x: p[0], y: p[1], z: p[2], halfW: radius, halfH: radius, roll: 0 });
    }
  }
  if (blobs.length === 0) return null;
  return {
    sheet: {
      stream: streamId,
      centre: { x: centre[0], y: centre[1], z: centre[2] },
      halfW: span0,
      halfH: span1,
      blobs: blobs.length,
      holes,
      basis: { axis0, axis1 },
    },
    blobs,
  };
}

// -------------------------------------------------------------------------
// Public builder
// -------------------------------------------------------------------------

export interface ConnectionOptions {
  /** Tapered strands through cohesive streams. Default true. */
  enableStrands?: boolean;
  /**
   * Sparse ragged sheets where several nodes of one stream run together.
   * **Default FALSE.** Sheets are an EXPERIMENTAL candidate: the stream-local
   * frame removed the old world-AABB axis flip and the world-position hole
   * swimming, but whether a density patch reads as a sheet rather than a
   * thicker rope is a question only the deferred visual pass can answer. The
   * game and comparison page therefore leave them off unless asked.
   */
  enableSheets?: boolean;
  /** Override any tuned budget (a copy is merged; the constant is not mutated). */
  tuning?: Partial<ConnectionTuning>;
}

/**
 * Pure, deterministic derivation of connection geometry from the live
 * droplet array. Reads only; draws no RNG; returns a fresh result.
 */
export function buildBloodConnections(
  droplets: readonly Droplet[], options: ConnectionOptions = {},
): ConnectionResult {
  const tuning: ConnectionTuning = { ...CONNECTION_TUNING, ...(options.tuning ?? {}) };
  const enableStrands = options.enableStrands !== false;
  const enableSheets = options.enableSheets === true;
  const { nodes, rejected, untagged } = collectNodes(droplets, tuning);
  const result: ConnectionResult = {
    strands: [], sheets: [], blobs: [],
    streamCount: 0,
    nodeCount: nodes.length,
    nodesRejected: rejected,
    untaggedRejected: untagged,
    budgetClamped: 0,
    degenerateRejected: 0,
  };
  if (nodes.length < 2) return result;

  // Deterministic group iteration order (by smallest input index), so replay
  // cannot depend on Map insertion order.
  const ordered = deriveStreamGroups(nodes);
  result.streamCount = ordered.length;

  if (enableStrands) {
    for (const members of ordered) {
      if (result.strands.length >= tuning.maxStrands) { result.budgetClamped++; continue; }
      const streamId = nodes[members[0]!]!.stream;
      const strand = buildStrand(members, nodes, streamId, tuning);
      if (!strand) { result.degenerateRejected++; continue; }
      const remaining = tuning.maxTotalBlobs - result.blobs.length;
      const budget = Math.min(tuning.maxStrandBlobs, remaining);
      const emitted = strandBlobs(strand, budget, tuning);
      if (emitted.clamped) result.budgetClamped++;
      for (const b of emitted.blobs) result.blobs.push(b);
      result.strands.push(strand);
    }
  }

  if (enableSheets) {
    for (const members of ordered) {
      if (result.sheets.length >= tuning.maxSheetPatches) { result.budgetClamped++; continue; }
      const streamId = nodes[members[0]!]!.stream;
      const budget = Math.min(tuning.maxSheetBlobs, tuning.maxTotalBlobs - result.blobs.length);
      const built = buildSheet(members, nodes, streamId, tuning, budget);
      if (!built) { result.degenerateRejected++; continue; }
      for (const b of built.blobs) result.blobs.push(b);
      result.sheets.push(built.sheet);
    }
  }

  // Total blob budget is a hard ceiling, whatever the per-pass budgets did.
  if (result.blobs.length > tuning.maxTotalBlobs) {
    result.blobs.length = tuning.maxTotalBlobs;
    result.budgetClamped++;
  }
  return result;
}

/** Convenience: just the render-ready blob placements. */
export function connectionBlobsForSim(
  droplets: readonly Droplet[], options: ConnectionOptions = {},
): GooDensityBlob[] {
  return buildBloodConnections(droplets, options).blobs;
}
