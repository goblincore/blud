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
//   2. SAME EMITTER, NEARBY AGE AND SPACE. A connection is only ever made
//      between droplets the builder has already put in one stream. Streams
//      start from an explicit `stream` tag when the emitter supplied one
//      (wound id / trail-source id), and otherwise fall back to a
//      deterministic union of nodes that are close in space AND close in
//      age. Two clusters that are far apart — the two-wounds case — never
//      union, which is the difference between "a rope" and "a spider web".
//   3. BUDGETED AND DEGENERACY-REJECTED. Every output is clamped by a named
//      budget (nodes, strand length, strand count, sheet patches, total
//      blobs) and anything degenerate (zero-length, collinear, no remaining
//      life, non-finite) is dropped rather than emitted as a stretched quad.
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
  noiseSeed: 0x9e3779b9,
};

/** A droplet that may carry an explicit, stable emitter identity. */
interface StreamTagged { stream?: number }

/** An axis-aligned triple, used instead of computed object keys. */
type Triple = [number, number, number];

export interface ConnectionNode {
  x: number; y: number; z: number;
  /** The droplet's own sim size (scene units, before any view scale). */
  radius: number;
  age: number;
  remaining: number;
  /** Explicit emitter id, or undefined when the emitter did not tag one. */
  stream: number | undefined;
  /** Gut node (organs r3) — the strand inherits the mask. */
  gut: number;
  /** Stable index into the input array, for deterministic tie-breaks. */
  index: number;
}

export interface ConnectionStrand {
  /** Explicit emitter id when known, else the derived group's index. */
  stream: number;
  explicitStream: boolean;
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
}

export interface ConnectionResult {
  strands: ConnectionStrand[];
  sheets: ConnectionSheet[];
  /** Ready to hand to GooLayer.setExtraBlobs(). */
  blobs: GooDensityBlob[];
  streamCount: number;
  nodeCount: number;
  /** Nodes dropped for no remaining life, wrong size or the node cap. */
  nodesRejected: number;
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

/** Union-find over the node array. Returns the group members in a
 *  deterministic order (by smallest input index). */
function deriveStreamGroups(
  nodes: ConnectionNode[], tuning: ConnectionTuning,
): number[][] {
  const n = nodes.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[i] !== r) { const next = parent[i]!; parent[i] = r; i = next; }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const link2 = tuning.maxLinkDist * tuning.maxLinkDist;
  for (let i = 0; i < n; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]!;
      // EXPLICIT emitter identity is authoritative: two differently tagged
      // emitters never connect, whatever their distance.
      if (a.stream !== undefined && b.stream !== undefined && a.stream !== b.stream) continue;
      if (Math.abs(a.age - b.age) > tuning.maxAgeDelta) continue;
      const dx = a.x - b.x; const dy = a.y - b.y; const dz = a.z - b.z;
      if (dx * dx + dy * dy + dz * dz > link2) continue;
      union(i, j);
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = byRoot.get(r);
    if (list) list.push(i); else byRoot.set(r, [i]);
  }
  return [...byRoot.values()].sort((a, b) => a[0]! - b[0]!);
}

/** Collect the droplets that may become connection nodes, deterministically
 *  (input order preserved so a seeded replay is stable). */
function collectNodes(droplets: readonly Droplet[], tuning: ConnectionTuning): {
  nodes: ConnectionNode[]; rejected: number;
} {
  const nodes: ConnectionNode[] = [];
  let rejected = 0;
  for (let i = 0; i < droplets.length; i++) {
    const d = droplets[i]!;
    if (d.kind === 'mist') continue;
    if (nodes.length >= tuning.maxNodes) { rejected++; continue; }
    if (d.size < tuning.minDropletSize) continue;
    const remaining = d.life - d.age;
    if (!(remaining > 0) || d.age > tuning.maxNodeAge) { rejected++; continue; }
    const p = d.pos;
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) { rejected++; continue; }
    const stream = (d as Droplet & StreamTagged).stream;
    nodes.push({
      x: p[0], y: p[1], z: p[2],
      radius: d.size,
      age: d.age,
      remaining,
      stream: typeof stream === 'number' && Number.isFinite(stream) ? stream : undefined,
      gut: d.kind === 'gut' ? 1 : 0,
      index: i,
    });
  }
  return { nodes, rejected };
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
  members: number[], nodes: ConnectionNode[], streamId: number, explicit: boolean,
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
  return { stream: streamId, explicitStream: explicit, points, length, gut: nodes[path[0]!]!.gut };
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

/** Axis index of the largest / second largest / smallest extent. */
function extentAxes(members: number[], nodes: ConnectionNode[]): {
  axes: [number, number, number];
  lo: Triple; hi: Triple; size: Triple;
} {
  const lo: Triple = [Infinity, Infinity, Infinity];
  const hi: Triple = [-Infinity, -Infinity, -Infinity];
  for (const i of members) {
    const n = nodes[i]!;
    lo[0] = Math.min(lo[0], n.x); hi[0] = Math.max(hi[0], n.x);
    lo[1] = Math.min(lo[1], n.y); hi[1] = Math.max(hi[1], n.y);
    lo[2] = Math.min(lo[2], n.z); hi[2] = Math.max(hi[2], n.z);
  }
  const size: Triple = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const axes: [number, number, number] = [0, 1, 2];
  axes.sort((a, b) => size[b]! - size[a]!);
  return { axes, lo, hi, size };
}

function buildSheet(
  members: number[], nodes: ConnectionNode[], streamId: number, tuning: ConnectionTuning,
  blobBudget: number,
): { sheet: ConnectionSheet; blobs: GooDensityBlob[] } | null {
  if (members.length < tuning.sheetMinNodes || blobBudget <= 0) return null;
  const { axes, lo, hi, size } = extentAxes(members, nodes);
  const [ax0, ax1, ax2] = axes;
  // A stream that is essentially a line has a tiny second axis and is
  // rejected — that is the "no collinear sheet" degeneracy test.
  if (size[ax1]! < tuning.minRadius * 4 || size[ax0]! < tuning.minRadius * 4) return null;

  const centre: Triple = [
    (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2,
  ];
  const span0 = size[ax0]! * tuning.sheetSpanScale;
  const span1 = size[ax1]! * tuning.sheetSpanScale;
  const cols = Math.max(2, tuning.sheetCols);
  const rows = Math.max(2, tuning.sheetRows);
  const pitch0 = span0 / (cols - 1);
  const pitch1 = span1 / (rows - 1);
  const attach = tuning.sheetAttachFactor * Math.max(pitch0, pitch1, tuning.minRadius * 2);
  const attach2 = attach * attach;

  const blobs: GooDensityBlob[] = [];
  let holes = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (blobs.length >= blobBudget) { holes++; continue; }
      const fx = (c / (cols - 1)) - 0.5;
      const fy = (r / (rows - 1)) - 0.5;
      const p: Triple = [centre[0], centre[1], centre[2]];
      p[ax0] = centre[ax0]! + fx * span0 * 2;
      p[ax1] = centre[ax1]! + fy * span1 * 2;
      p[ax2] = centre[ax2]!;
      // ATTACHMENT GATE: at least one node must be near the cell, so the
      // patch follows the flow and cannot become a floating giant sail.
      let attached = false;
      for (const i of members) {
        const nd = nodes[i]!;
        const dx = nd.x - p[0]; const dy = nd.y - p[1]; const dz = nd.z - p[2];
        if (dx * dx + dy * dy + dz * dz <= attach2) { attached = true; break; }
      }
      if (!attached) { holes++; continue; }
      // SEEDED HOLES + ragged edge: a hole is skipped outright, and the
      // surviving radius is modulated by smooth value noise so the breakup
      // is irregular rather than a checkerboard.
      if (hash01(p[0], p[1], p[2], tuning.noiseSeed) < tuning.holeChance) { holes++; continue; }
      const n = valueNoise3(p[0] * 6, p[1] * 6, p[2] * 6, tuning.noiseSeed ^ 0x5bd1e995);
      const edgeFade = 1 - 0.55 * Math.min(1, Math.hypot(fx, fy) * 2);
      const radius = tuning.sheetRadiusScale * (0.55 + 0.9 * n) * edgeFade;
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
  /** Sparse ragged sheets where several nodes of one stream run together.
   *  Default true. */
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
  const enableSheets = options.enableSheets !== false;
  const { nodes, rejected } = collectNodes(droplets, tuning);
  const result: ConnectionResult = {
    strands: [], sheets: [], blobs: [],
    streamCount: 0,
    nodeCount: nodes.length,
    nodesRejected: rejected,
    budgetClamped: 0,
    degenerateRejected: 0,
  };
  if (nodes.length < 2) return result;

  // Deterministic group iteration order (by smallest input index), so replay
  // cannot depend on Map insertion order.
  const ordered = deriveStreamGroups(nodes, tuning);
  result.streamCount = ordered.length;

  if (enableStrands) {
    for (const members of ordered) {
      if (result.strands.length >= tuning.maxStrands) { result.budgetClamped++; continue; }
      const explicit = nodes[members[0]!]!.stream;
      const streamId = explicit ?? result.strands.length;
      const strand = buildStrand(members, nodes, streamId, explicit !== undefined, tuning);
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
      const explicit = nodes[members[0]!]!.stream;
      const streamId = explicit ?? result.sheets.length;
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
