// src/lab/sdf-zombie/webgpu/gib-asset-build.ts
//
// CPU-ONLY OFFLINE BUILDER for the committed gib sets (offline-gib-assets
// task 1). Takes an archetype's REST-pose `BuildResult` plus the flesh look and
// produces the serialisable piece documents in gib-asset.ts — no renderer, no
// DOM, no browser: the same `bakeChunkGeometry` the runtime settle bake uses.
//
// WHY NOT `gib-library.ts`. That module bakes the same pieces at boot and is
// the direct ancestor of this one; the differences that matter here are:
//
//   1. It SKIPS the skeleton. `bakeChunkGeometry`'s field folds bones only
//      near a wound (`chunk-bake-field.ts` mirrors the shader's nearWound
//      gate), and a bone-only piece has neither flesh nor wound, so its field
//      is empty and extraction finds nothing. `gib-library.test.ts` records
//      that as a known gap (`it.fails`). An OFFLINE set has to contain the
//      skeleton — it is the thing the owner asked for by name — so a bone-only
//      piece here is extracted from the BONE UNION ITSELF: the bone prims are
//      cloned with `op: 'add'` and handed to the baker as the additive field.
//      That leaves the shared field module untouched.
//
//   2. It stores no binding. The offline mesh must follow the current pose and
//      the rupture's endpoint slough, so every vertex is bound to up to
//      `maxPrims` source primitives here (see gib-asset.ts's skinning note).
//
//   3. It recentres by the geometry's own bounding-sphere centre. The offline
//      set uses the PLANNER ORIGIN as the local frame, so a spawn that puts the
//      chunk at `piece.origin` can drop the local geometry in with no extra
//      offset and the detail material's `positionLocal` noise rides the piece
//      exactly as the planner intends.
//
// APPROXIMATION IS MEASURED, NOT ASSUMED: each piece records the extraction's
// own field error and a synthetic-deformation skinning error, and the
// archetype records the nearest-neighbour gap between pieces across every cut.
import type { BuildResult } from '../build-body';
import { gibPlan, GIB_CUT, type GibPiece, type GibPlan } from '../gib-parts';
import { chunkExtent } from '../extent';
import { boneChunkRadius } from '../melt-bones';
import { sdPrimitive } from '../validate';
import { chunkBakeField, cutLook, type ChunkLook } from '../chunk-bake-field';
import { bakeChunkGeometry, type ChunkBakeData } from './chunk-bake-geometry';
import type { Primitive, Vec3 } from '../types';
import { cross, normalize, qFromAxisAngle, qRotate, type Quat } from '../vec';
import {
  GIB_ASSET_CUT_MASK, GIB_ASSET_KIND, GIB_ASSET_MAX_BIND_PRIMS, GIB_ASSET_SCHEMA_VERSION,
  fnv1a64, gibAssetRecipeFingerprint, gibAssetRecipeHeader,
  type GibAssetArchetype, type GibAssetBindingPrim, type GibAssetBounds,
  type GibAssetCut, type GibAssetFaceFrame, type GibAssetPiece,
  type GibAssetRecipe, type GibAssetSectionInput,
  encodeGibAssetBin, type GibAssetSection,
} from './gib-asset';
import { deformBoundVertex } from './gib-asset';

/** The field response values the bake writes into `bakeResponse` — the same
 *  numbers `ChunkGpuView.bakeData()` reads off the live body uniforms. */
export interface GibSurfaceResponse {
  legacyGamma: number;
  wetness: number;
  roughness: number;
  specIntensity: number;
  noiseAmp: number;
  fresnel: number;
}

export interface BuildGibAssetOptions {
  archetype: string;
  /** The archetype's REST-pose body (built from its `.blob`). */
  body: BuildResult;
  look: ChunkLook;
  surface: GibSurfaceResponse;
  /** Full recipe (including source text). Its fingerprint is written out. */
  recipe: GibAssetRecipe;
  /** Which skeleton groups to release; default 'all' (the superset every
   *  runtime plan selects a prefix from). */
  bones?: 'all' | 'core' | 'off';
  organs?: boolean;
  /** Extraction cell, metres. Default GIB_ASSET_DEFAULT_CELL. */
  cellSize?: number;
  maxBindPrims?: number;
  /** Torn-end carve fillet, matches the shipped settle bake. */
  carveK?: number;
}

export interface GibAssetBuildOutput {
  archetype: GibAssetArchetype;
  bin: Uint8Array;
  /** Total extraction cost, ms. Diagnostics only — kept OUT of the archetype
   *  document so identical input regenerates identical bytes. */
  bakeMs: number;
}

/** The long axis of a piece's prims — `spawnChunkPiece`'s rule, verbatim. */
function primsLongAxis(prims: readonly Primitive[]): Vec3 {
  let best: Vec3 = [0, 1, 0];
  let bestLen = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l > bestLen) { bestLen = l; best = [d[0] / l, d[1] / l, d[2] / l]; }
  }
  return bestLen < 1e-6 ? [0, 1, 0] : best;
}

/** `game-main`'s `headShape`, verbatim: the fattest additive prim in the head
 *  cluster normalises the face projection. */
export function gibHeadShape(body: BuildResult): { centre: Vec3; axes: Vec3 } | null {
  const head = body.clusters.find(c => c.limb === 'head');
  if (!head) return null;
  let best: Vec3 | null = null;
  let bestAxes: Vec3 | null = null;
  let bestR = -Infinity;
  for (const p of body.prims.slice(head.start, head.start + head.count)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      bestAxes = [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]];
    }
  }
  return best === null || bestAxes === null ? null : { centre: best, axes: bestAxes };
}

function boundsOf(local: Float32Array, verts: number): GibAssetBounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts; i++) {
    const x = local[i * 3]!, y = local[i * 3 + 1]!, z = local[i * 3 + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const min: Vec3 = [minX, minY, minZ];
  const max: Vec3 = [maxX, maxY, maxZ];
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let r2 = 0;
  for (let i = 0; i < verts; i++) {
    const dx = local[i * 3]! - center[0], dy = local[i * 3 + 1]! - center[1], dz = local[i * 3 + 2]! - center[2];
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return { min, max, center, sphereRadius: Math.sqrt(r2) };
}

/** Build one binding-table row. */
function bindingPrim(p: Primitive, source: 'flesh' | 'bone' | null, index: number): GibAssetBindingPrim {
  return {
    source, index, op: p.op ?? 'add', bone: p.bone, limb: p.limb, cluster: p.cluster,
    a: [p.a[0], p.a[1], p.a[2]], b: [p.b[0], p.b[1], p.b[2]],
    radius: p.radius, radiusB: p.radiusB, scale: [p.scale[0], p.scale[1], p.scale[2]], blendK: p.blendK,
  };
}

/**
 * Bind every vertex to up to K prims by inverse-square distance to the prim's
 * own surface, quantised to u8. Also returns the two approximation numbers the
 * build records: the extraction field error at each vertex, and the skinning
 * error under a deterministic synthetic per-prim motion.
 */
function bindVertices(
  world: Float32Array,
  verts: number,
  table: GibAssetBindingPrim[],
  tablePrims: Primitive[],
  cellSize: number,
): {
  bindIndex: Uint16Array; bindWeight: Uint8Array;
  fieldErrMax: number; fieldErrMean: number;
  deformErrMax: number; deformErrMean: number;
} {
  const k = Math.min(GIB_ASSET_MAX_BIND_PRIMS, Math.max(1, table.length));
  const bindIndex = new Uint16Array(verts * GIB_ASSET_MAX_BIND_PRIMS);
  const bindWeight = new Uint8Array(verts * GIB_ASSET_MAX_BIND_PRIMS);
  // A piece with no prims at all cannot exist in a `gibPlan` output, but if one
  // ever did the extraction would already have failed; keep this cheap guard so
  // the binding math below never indexes an empty table.
  if (table.length === 0) {
    return {
      bindIndex, bindWeight,
      fieldErrMax: 0, fieldErrMean: 0, deformErrMax: 0, deformErrMean: 0,
    };
  }

  // The rest field, for the extraction-error number.
  const restField = chunkBakeField({
    flesh: tablePrims.map(p => (p.op === 'sub' ? p : { ...p, op: 'add' as const })),
    bones: [], torn: [], carveK: 0,
  });

  // The synthetic motion: rotate each prim about its own midpoint by a small,
  // fixed, per-index angle. This is the cheapest stand-in for the rupture's
  // independent per-prim endpoint motion; the field it defines is the ground
  // truth the blended vertex is compared against.
  const posedFrames = tablePrims.map((p, i) => {
    const angle = 0.09 * ((i % 5) - 2);
    const dir: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
    let axis = cross(dir, [0.13, 1, 0.07]);
    let al = Math.hypot(axis[0], axis[1], axis[2]);
    if (al < 1e-6) { axis = [0.37, 0.21, 1]; al = Math.hypot(axis[0], axis[1], axis[2]); }
    const q: Quat = qFromAxisAngle([axis[0] / al, axis[1] / al, axis[2] / al], angle);
    const mid: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    const rot = (e: Vec3): Vec3 => {
      const d: Vec3 = [e[0] - mid[0], e[1] - mid[1], e[2] - mid[2]];
      const r = qRotate(q, d);
      return [mid[0] + r[0], mid[1] + r[1], mid[2] + r[2]];
    };
    return {
      a: rot([p.a[0], p.a[1], p.a[2]]), b: rot([p.b[0], p.b[1], p.b[2]]),
      radius: p.radius, radiusB: p.radiusB, scale: [p.scale[0], p.scale[1], p.scale[2]] as Vec3,
    };
  });
  const movedPrims = tablePrims.map((p, i) => {
    const f = posedFrames[i]!;
    const q: Primitive = { ...p, a: f.a, b: f.b };
    return q.op === 'sub' ? q : { ...q, op: 'add' as const };
  });
  const movedField = chunkBakeField({ flesh: movedPrims, bones: [], torn: [], carveK: 0 });

  // Rebuild the posed frames as GibAssetBindingPrims so gib-asset's reference
  // deformer can consume them without a second code path.
  const posedAsPrims: GibAssetBindingPrim[] = table.map((p, i) => {
    const f = posedFrames[i]!;
    return { ...p, a: f.a, b: f.b };
  });

  const dists = new Float64Array(table.length);
  const idxs = new Int32Array(table.length);
  let fieldErrMax = 0, fieldErrSum = 0;
  let deformErrMax = 0, deformErrSum = 0;
  const tmpOut: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < verts; i++) {
    const q: Vec3 = [world[i * 3]!, world[i * 3 + 1]!, world[i * 3 + 2]!];
    const fe = Math.abs(restField.field(q));
    if (fe > fieldErrMax) fieldErrMax = fe;
    fieldErrSum += fe;

    for (let j = 0; j < table.length; j++) {
      dists[j] = Math.abs(sdPrimitive(q, tablePrims[j]!));
      idxs[j] = j;
    }
    // Partial selection sort for the K nearest.
    for (let a = 0; a < k; a++) {
      let best = a;
      for (let b = a + 1; b < table.length; b++) if (dists[b]! < dists[best]!) best = b;
      if (best !== a) {
        const td = dists[a]!; dists[a] = dists[best]!; dists[best] = td;
        const ti = idxs[a]!; idxs[a] = idxs[best]!; idxs[best] = ti;
      }
    }
    const eps = Math.max(1e-4, cellSize * 0.1);
    let wsum = 0;
    const w = new Float64Array(k);
    for (let a = 0; a < k; a++) {
      const inv = 1 / (dists[a]! + eps);
      w[a] = inv * inv;
      wsum += w[a]!;
    }
    let qsum = 0;
    const qw = new Uint8Array(k);
    for (let a = 0; a < k; a++) {
      const qa = Math.round((w[a]! / wsum) * 255);
      qw[a] = qa;
      qsum += qa;
    }
    // Repair rounding so the u8 row sums to exactly 255 (the validator checks).
    let delta = 255 - qsum;
    let lead = 0;
    for (let a = 1; a < k; a++) if (qw[a]! > qw[lead]!) lead = a;
    while (delta !== 0) {
      if (delta > 0) { const add = Math.min(delta, 255 - qw[lead]!); qw[lead] = qw[lead]! + add; delta -= add; }
      else { const sub = Math.min(-delta, qw[lead]!); qw[lead] = qw[lead]! - sub; delta += sub; }
      if (delta !== 0) { lead = (lead + 1) % k; }
    }
    for (let a = 0; a < k; a++) {
      bindIndex[i * GIB_ASSET_MAX_BIND_PRIMS + a] = idxs[a]!;
      bindWeight[i * GIB_ASSET_MAX_BIND_PRIMS + a] = qw[a]!;
    }

    // Skinning error: reconstruct under the synthetic motion and ask the
    // moved field how far that lands from the true deformed surface.
    const mapped = deformBoundVertex(
      q, i, bindIndex, bindWeight, GIB_ASSET_MAX_BIND_PRIMS, table, posedAsPrims, tmpOut,
    );
    const de = Math.abs(movedField.field(mapped));
    if (de > deformErrMax) deformErrMax = de;
    deformErrSum += de;
  }
  return {
    bindIndex, bindWeight,
    fieldErrMax, fieldErrMean: verts > 0 ? fieldErrSum / verts : 0,
    deformErrMax, deformErrMean: verts > 0 ? deformErrSum / verts : 0,
  };
}

/** Nearest-neighbour gap between two pieces' vertices near a cut plane. */
function seamGap(
  aLocal: Float32Array, bLocal: Float32Array,
  aOffset: Vec3, bOffset: Vec3,
  at: Vec3, n: Vec3,
): { gapMin: number; gapMean: number; samples: number } {
  const band = 0.06;
  const collect = (local: Float32Array, off: Vec3): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 0; i < local.length; i += 3) {
      const x = local[i]! + off[0], y = local[i + 1]! + off[1], z = local[i + 2]! + off[2];
      const d = (x - at[0]) * n[0] + (y - at[1]) * n[1] + (z - at[2]) * n[2];
      if (Math.abs(d) < band) out.push([x, y, z]);
    }
    return out;
  };
  const A = collect(aLocal, aOffset);
  const B = collect(bLocal, bOffset);
  if (A.length === 0 || B.length === 0) return { gapMin: 0, gapMean: 0, samples: 0 };
  let gapMin = Infinity, sum = 0, count = 0;
  for (const p of A) {
    let best = Infinity;
    for (const q of B) {
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    const d = Math.sqrt(best);
    if (d < gapMin) gapMin = d;
    sum += d; count++;
  }
  return { gapMin, gapMean: sum / Math.max(1, count), samples: count };
}

/**
 * Build one archetype's offline asset set. Deterministic and synchronous.
 * Throws (loudly) on empty or overflowed extraction — a silently-missing piece
 * is the exact failure this set exists to end.
 */
export function buildGibAssetArchetype(opts: BuildGibAssetOptions): GibAssetBuildOutput {
  const cellSize = opts.cellSize ?? 0.012;
  const carveK = opts.carveK ?? 0.008;
  const plan: GibPlan = gibPlan(opts.body, { bones: opts.bones ?? 'all', organs: opts.organs ?? true });
  const head = gibHeadShape(opts.body);
  const face: GibAssetFaceFrame | undefined = head
    ? { centre: head.centre, quat: [0, 0, 0, 1], axes: head.axes, forward: 1, reach: 1 }
    : undefined;

  const pieces: GibAssetPiece[] = [];
  const sectionInputs: GibAssetSectionInput[][] = [];
  const localByPart = new Map<string, Float32Array>();
  let bakeMsTotal = 0;

  plan.pieces.forEach((g: GibPiece, pieceIndex: number) => {
    const boneOnly = g.prims.length === 0 && g.bones.length > 0;
    const organOnly = boneOnly && g.bones.some(p => p.op === 'organ');
    const fieldFlesh = boneOnly ? g.bones.map(p => ({ ...p, op: 'add' as const })) : g.prims;
    const fieldBones = boneOnly ? [] : g.bones;
    // The collision radius keeps `spawnChunkPiece`'s recipe (bone-only pieces
    // use `boneChunkRadius`); the EXTRACTION box must instead cover every prim's
    // reach from the centroid, or surface-nets drops boundary quads. A cage is
    // several rib prims, so those two are not the same number.
    const collRadius = boneOnly
      ? boneChunkRadius(g.bones)
      : chunkExtent(g.prims, g.origin);
    const geometryExtent = Math.max(chunkExtent(boneOnly ? g.bones : g.prims, g.origin), 0.02);
    const extent = geometryExtent;
    // THE CUT MASK. A planner piece's cut is a capped PLANE: `g.prims` carries
    // the additive flesh plus one `sub` cap per cut. Because the cap is part of
    // the same `flesh` array, `ev.preWound` is already zero on the capped face,
    // so leaving `torn: []` bakes alpha 0 over 100% of vertices and every cut
    // reads as dry outer skin. Passing the ADDITIVE prims as `cutMask.flesh`
    // gives `cutAwareField` the depth beneath the ORIGINAL skin (0 on the
    // outside, deep on the cut face) that the carve path derives the same way.
    const capCount = g.prims.reduce((n, p) => n + (p.op === 'sub' ? 1 : 0), 0);
    const cutMask = capCount > 0 ? { flesh: g.prims.filter(p => p.op !== 'sub') } : undefined;
    const data: ChunkBakeData = {
      flesh: fieldFlesh,
      bones: fieldBones,
      torn: [],
      carveK,
      centre: g.origin,
      extent,
      halfExtent: [extent, extent, extent],
      quat: [0, 0, 0, 1],
      // A cap cut has no cavities, so the viscera lump is off for it exactly as
      // it is on the carved library (see `cutLook`); the geometry is untouched.
      look: cutMask ? cutLook(opts.look) : opts.look,
      surface: opts.surface,
      gore: 1,
      cellSize,
      cutMask,
      face: g.part === 'head' ? face : undefined,
    };
    const baked = bakeChunkGeometry(data);
    if (baked.verts === 0) {
      throw new Error(`gib asset ${opts.archetype}/${g.part}: extraction produced no geometry`);
    }
    bakeMsTotal += baked.bakeMs;
    if (baked.overflow || baked.droppedQuads > 0) {
      throw new Error(
        `gib asset ${opts.archetype}/${g.part}: extraction overflow=${baked.overflow} `
        + `droppedQuads=${baked.droppedQuads} — refusing to ship holed geometry`,
      );
    }
    // The cut mask is a MATERIAL CONTRACT, not a nicety: a capped piece whose
    // alpha came out entirely zero is the exact blocker this regeneration
    // exists to fix, so fail the build loudly instead of shipping a dry cut.
    const world = baked.geometry.getAttribute('position').array as Float32Array;
    const normals = baked.geometry.getAttribute('normal').array as Float32Array;
    const colors = baked.geometry.getAttribute('bakeColor').array as Float32Array;
    const responses = baked.geometry.getAttribute('bakeResponse').array as Float32Array;
    const fresnels = baked.geometry.getAttribute('bakeFresnel').array as Float32Array;
    const anchors = baked.geometry.getAttribute('bakeAnchor').array as Float32Array;
    const aos = baked.geometry.getAttribute('bakeAo').array as Float32Array;
    const indexAttr = baked.geometry.getIndex()!;

    if (cutMask) {
      let wmMax = 0, wmNonzero = 0;
      for (let i = 3; i < colors.length; i += 4) {
        const w = colors[i]!;
        if (w > 0.02) wmNonzero++;
        if (w > wmMax) wmMax = w;
      }
      if (wmMax < 0.5 || wmNonzero === 0) {
        throw new Error(
          `gib asset ${opts.archetype}/${g.part}: cut mask empty (max ${wmMax.toFixed(3)}, `
          + `${wmNonzero}/${baked.verts} vertices > 0.02) — cut-aware bakeColor.a regressed`,
        );
      }
    }

    // Local frame = the planner origin (see the header). `bakeAnchor.xyz` was
    // already written relative to exactly this centre, so the two agree.
    const local = new Float32Array(world.length);
    for (let i = 0; i < world.length; i++) local[i] = world[i]! - g.origin[i % 3]!;
    localByPart.set(g.part, local);

    // Binding table: sourced flesh rows (indexed by srcPrims), sourced bone
    // rows, then any unsourced caps. `srcPrims`/`srcBones` name only the
    // sourced rows, so a trailing sub cap has no source and follows the piece.
    const table: GibAssetBindingPrim[] = [];
    const tablePrims: Primitive[] = [];
    g.prims.forEach((p, j) => {
      const src = g.srcPrims?.[j];
      table.push(bindingPrim(p, src === undefined ? null : 'flesh', src ?? -1));
      tablePrims.push(p);
    });
    g.bones.forEach((p, j) => {
      const src = g.srcBones?.[j];
      table.push(bindingPrim(p, src === undefined ? null : 'bone', src ?? -1));
      tablePrims.push(p);
    });

    const bind = bindVertices(world, baked.verts, table, tablePrims, cellSize);

    // Cuts this piece is part of, by neighbour part name.
    const cuts: GibAssetCut[] = [];
    for (const c of plan.cuts) {
      const inA = c.a === pieceIndex, inB = c.b === pieceIndex;
      if (!inA && !inB) continue;
      const other = inA ? c.b : c.a;
      const otherPart = plan.pieces[other]?.part ?? `piece${other}`;
      cuts.push({
        withPart: otherPart,
        at: [c.at[0], c.at[1], c.at[2]],
        // Orient the normal from THIS piece toward the neighbour.
        n: inA ? [c.n[0], c.n[1], c.n[2]] : [-c.n[0], -c.n[1], -c.n[2]],
        overhang: c.overhang ?? GIB_CUT.blendK * GIB_CUT.overhangK,
      });
    }

    const positions = local;
    const indices = indexAttr.array as Uint16Array | Uint32Array;
    const idxOut = positions.length / 3 < 65536 ? new Uint16Array(indices) : new Uint32Array(indices);

    const input: GibAssetSectionInput[] = [
      { name: 'positions', data: positions },
      { name: 'normals', data: normals },
      { name: 'indices', data: idxOut },
      { name: 'bakeColor', data: colors },
      { name: 'bakeResponse', data: responses },
      { name: 'bakeFresnel', data: fresnels },
      { name: 'bakeAnchor', data: anchors },
      { name: 'bakeAo', data: aos },
      { name: 'bindIndex', data: bind.bindIndex },
      { name: 'bindWeight', data: bind.bindWeight },
    ];
    sectionInputs.push(input);

    const bounds = boundsOf(positions, baked.verts);
    pieces.push({
      part: g.part,
      limb: g.limb as unknown as string,
      kind: g.kind,
      material: organOnly ? 'organ' : boneOnly ? 'bone' : 'flesh',
      offset: [g.origin[0], g.origin[1], g.origin[2]],
      origin: [g.origin[0], g.origin[1], g.origin[2]],
      radius: collRadius,
      longAxis: primsLongAxis(boneOnly ? g.bones : g.prims),
      verts: baked.verts,
      tris: baked.tris,
      bounds,
      sections: [], // filled after encoding
      bind: { maxPrims: GIB_ASSET_MAX_BIND_PRIMS, prims: table },
      face: g.part === 'head' ? face : undefined,
      cuts,
      approximation: {
        vertexFieldErrorMax: bind.fieldErrMax,
        vertexFieldErrorMean: bind.fieldErrMean,
        deformedFieldErrorMax: bind.deformErrMax,
        deformedFieldErrorMean: bind.deformErrMean,
        seams: [],
      },
      srcPrims: g.srcPrims ? [...g.srcPrims] : [],
      srcBones: g.srcBones ? [...g.srcBones] : [],
    });
  });

  // Seam gaps, now that every neighbour's vertices exist.
  for (let i = 0; i < plan.pieces.length; i++) {
    const piece = pieces[i]!;
    const local = localByPart.get(piece.part)!;
    for (const cut of piece.cuts) {
      const neighbour = pieces.find(p => p.part === cut.withPart);
      if (!neighbour) continue;
      const other = localByPart.get(cut.withPart);
      if (!other) continue;
      const gap = seamGap(local, other, piece.offset, neighbour.offset, cut.at, cut.n);
      if (gap.samples > 0) {
        piece.approximation.seams.push({ withPart: cut.withPart, gapMin: gap.gapMin, gapMean: gap.gapMean, samples: gap.samples });
      }
    }
  }

  const encoded = encodeGibAssetBin(sectionInputs);
  const bin = encoded.bin;
  // The cheap index of the encoder's tables is enough; itemSize is not part of
  // the on-disk contract's semantics beyond documenting the shape.
  for (let i = 0; i < pieces.length; i++) {
    pieces[i]!.sections = encoded.sections[i]!.map((s: GibAssetSection) => ({
      ...s,
      itemSize: s.name === 'positions' || s.name === 'normals' || s.name === 'indices' ? 3
        : s.name === 'bakeColor' || s.name === 'bakeResponse' || s.name === 'bakeAnchor' ? 4 : 1,
    }));
  }

  const totals = {
    pieces: pieces.length,
    verts: pieces.reduce((s, p) => s + p.verts, 0),
    tris: pieces.reduce((s, p) => s + p.tris, 0),
    binBytes: bin.byteLength,
  };

  const archetype: GibAssetArchetype = {
    kind: GIB_ASSET_KIND,
    schemaVersion: GIB_ASSET_SCHEMA_VERSION,
    archetype: opts.archetype,
    fingerprint: gibAssetRecipeFingerprint(opts.recipe),
    recipe: gibAssetRecipeHeader(opts.recipe),
    source: {
      blob: opts.recipe.blobPath,
      blobBytes: new TextEncoder().encode(opts.recipe.blobSource).length,
      blobHash: fnv1a64(opts.recipe.blobSource),
    },
    bake: {
      cellSize,
      carveK,
      gore: 1,
      boneRelease: opts.bones ?? 'all',
      organs: opts.organs ?? true,
      cutMask: GIB_ASSET_CUT_MASK,
    },
    offsets: { json: `${opts.archetype}.gib.json`, bin: `${opts.archetype}.gib.bin` },
    totals,
    pieces,
  };
  return { archetype, bin, bakeMs: Math.round(bakeMsTotal * 100) / 100 };
}
