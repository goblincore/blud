// src/lab/sdf-zombie/webgpu/gib-asset.ts
//
// THE OFFLINE GIB ASSET SCHEMA (2026-09-16 offline-gib-assets task 1).
//
// WHY THIS EXISTS. `gib-library.ts` bakes an archetype's split pieces ONCE per
// session, at boot, from the rest-pose body. That is already reusable across
// instances, but it still pays the extraction on every page load and it cannot
// be inspected, diffed or validated before a run. This module is the contract
// for the same geometry baked OFFLINE and committed:
//
//   * a versioned, deterministic binary payload per archetype (positions,
//     normals, indices and the OWNED procedural material channels the baked
//     shader reads — albedo/wound-mask, response, fresnel, noise anchor, AO);
//   * a bounded per-vertex binding to the piece's SOURCE primitives, so a
//     runtime loader can deform the canonical mesh onto the current pose and
//     the rupture's endpoint slough without re-extracting anything;
//   * a recipe fingerprint that covers the full `.blob` source text, build
//     options, palette and bake settings, so an asset that no longer matches
//     its source is detectable as STALE rather than silently wrong.
//
// NO THREE, NO DOM, NO NODE. The schema is plain typed arrays and records so
// the same code validates in the generator, in vitest and in the browser
// loader. (TextEncoder is the only global it needs and is present in all
// three.) The three-dependent extraction lives in gib-asset-build.ts.
//
// NO EXTRACTED BLOOD PIXELS. Every material channel here is procedural — the
// fbm mottle / tissue ramp the bake computes. Head face TEXTURES stay external
// references (the piece carries a face FRAME, never pixels).
//
// OWNERSHIP. "Geometry and procedural attributes are owned assets." A committed
// `.gib.bin` is generated from tracked `.blob` sources and contains no extracted
// Blood art, so it is safe to commit and ship.
import type { Vec3 } from '../types';
import { dot, qFromTo, qRotate, sub, type Quat } from '../vec';

/** Manifest `kind` — a cheap sanity check that a file is ours. */
export const GIB_ASSET_KIND = 'blud-gib-assets' as const;

/**
 * Bump on ANY layout or semantic change. The loader must refuse (or fall back
 * from) a payload it does not understand rather than misread bytes.
 *
 * 2 — 2026-09-16: `bakeColor.a` is now the cut-aware wound mask derived from
 *     the planner's `sub` cut caps (was uniformly 0 on 100% of vertices).
 * 3 — 2026-09-17: the bind table no longer contains `sub` carve caps. See
 *     `GIB_ASSET_BIND_MASK`: binding surface vertices to a cap (a point sphere
 *     ~3 m away with no axis) produced metre-long deform spikes.
 */
export const GIB_ASSET_SCHEMA_VERSION = 3;

/** Bounded per-vertex binding count. Four is the standard skinning budget: a
 *  vertex on a smooth-union fillet between two prims blends two, and a vertex
 *  in a three-way crease blends three; four leaves headroom without the
 *  unbounded cost of "every prim". */
export const GIB_ASSET_MAX_BIND_PRIMS = 4;

/** Extraction cell size for the offline sets, metres. 12 mm: a torn-end
 *  crater is still several cells across, while the triangle/byte cost stays
 *  committable (the runtime settle bake keeps its own 10 mm BAKE_CELL — see
 *  the build module and the report's size table). */
export const GIB_ASSET_DEFAULT_CELL = 0.012;

/** The cut-mask derivation the committed sets carry. Bump the string whenever
 *  the meaning of `bakeColor.a` changes; it rides the recipe fingerprint so an
 *  older set is STALE, not silently dry (see `GibAssetRecipe.cutMask`). */
export const GIB_ASSET_CUT_MASK = 'planner-cut-v1';

/**
 * Which prims a vertex may bind to. Bump whenever the bind CANDIDATE SET
 * changes; it rides the recipe fingerprint so a set baked under the old rule is
 * STALE rather than served with a bad deformation.
 *
 * `additive-v1` (2026-09-17): only additive (`op !== 'sub'`) prims are bind
 * targets. A planner cut cap is a POINT sphere whose centre sits `radius`
 * (~3-5 m at `GIB_CUT.radiusK`) behind the cut plane and whose surface passes
 * right through the cut face — so nearest-surface binding handed the cut-face
 * vertices to the cap. A point prim has no axis, so `primTransformPoint` could
 * not rotate the (metre-scale) radial offset with the posed body, and every
 * animated piece trailed metre-long spike triangles. Caps still carve the
 * extracted surface; they are simply not skinning targets.
 */
export const GIB_ASSET_BIND_MASK = 'additive-v1';

export type GibAssetDType = 'f32' | 'u32' | 'u16' | 'u8';

export function gibAssetDTypeBytes(dtype: GibAssetDType): number {
  return dtype === 'f32' || dtype === 'u32' ? 4 : dtype === 'u16' ? 2 : 1;
}

export type GibAssetSectionName =
  | 'positions' | 'normals' | 'indices'
  | 'bakeColor' | 'bakeResponse' | 'bakeFresnel' | 'bakeAnchor' | 'bakeAo'
  | 'bindIndex' | 'bindWeight';

/** Fixed write/read order. Changing it is a schema change. */
export const GIB_SECTION_ORDER: readonly GibAssetSectionName[] = [
  'positions', 'normals', 'indices',
  'bakeColor', 'bakeResponse', 'bakeFresnel', 'bakeAnchor', 'bakeAo',
  'bindIndex', 'bindWeight',
];

export interface GibAssetSection {
  name: GibAssetSectionName;
  dtype: GibAssetDType;
  /** Scalar ELEMENT count (positions of one vertex = 3 elements). */
  count: number;
  /** Components per logical item (3 for positions/indices, 4 for bakeColor,
   *  1 for the binding rows). `count` is always `items * itemSize`. */
  itemSize: number;
  /** Byte offset into the archetype's `.gib.bin`. 4-byte aligned. */
  byteOffset: number;
  byteLength: number;
}

/** One rest-pose primitive a baked piece's vertices may bind to. `source`
 *  names where its DEFORMED twin lives at runtime (`gib-tear.ts`'s
 *  `deformedPrims`/`deformedBones`). Under `GIB_ASSET_BIND_MASK = 'additive-v1'`
 *  every row is sourced (flesh or bone) — the unsourced `sub` cut caps are not
 *  bind targets. A null source is kept in the type so a pre-v3 set still LOADS
 *  (and can be validated) rather than being misread; it follows the piece
 *  rigidly, which is exactly the pathology v3 removes. */
export interface GibAssetBindingPrim {
  source: 'flesh' | 'bone' | null;
  /** Index into the body's `prims` (flesh) or `bonePrims` (bone); -1 for a cap. */
  index: number;
  op: string;
  bone?: string;
  limb: string;
  cluster: number;
  a: Vec3;
  b: Vec3;
  radius: number;
  radiusB?: number;
  scale: Vec3;
  blendK: number;
}

export interface GibAssetBindTable {
  maxPrims: number;
  prims: GibAssetBindingPrim[];
}

export interface GibAssetBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  sphereRadius: number;
}

/** The head's face projection frame, in the piece's REST body frame. The face
 *  TEXTURE is an external reference; the asset only carries where it projects. */
export interface GibAssetFaceFrame {
  centre: Vec3;
  quat: Quat;
  axes: Vec3;
  forward: number;
  reach: number;
}

/** One cut plane this piece shares with a neighbour, by part name, in the REST
 *  body frame. `n` points from `a` toward `b`. */
export interface GibAssetCut {
  withPart: string;
  at: Vec3;
  n: Vec3;
  overhang: number;
}

/** Extraction and skinning approximation numbers, measured offline — reported,
 *  never asserted as exact. All metres. */
export interface GibAssetApproximation {
  /** max/mean |field(vertex)| — how far the extracted surface sits from the
   *  true iso it was extracted from (surface-nets + Newton pull fidelity). */
  vertexFieldErrorMax: number;
  vertexFieldErrorMean: number;
  /** max/mean |field_deformed(reconstructed)| under a deterministic synthetic
   *  per-prim motion. This is the smooth-union / fillet skinning error: a
   *  vertex blended from several prims does not follow the union's own
   *  surface exactly once its prims move independently. */
  deformedFieldErrorMax: number;
  deformedFieldErrorMean: number;
  /** Nearest-neighbour gap between this piece and each neighbour across a cut,
   *  from the baked vertices near the plane. The neighbour pieces must meet. */
  seams: { withPart: string; gapMin: number; gapMean: number; samples: number }[];
}

export interface GibAssetPiece {
  /** `gib-parts.ts`'s stable label ('torso.chest', 'legL.upper', 'bone.cage'). */
  part: string;
  limb: string;
  kind: 'limb' | 'gob' | 'bone';
  /** Which albedo branch the piece belongs to. 'bone' and 'organ' pieces are
   *  extracted from the bone/organ union directly (see gib-asset-build) and
   *  should be drawn with the skeleton material; their baked albedo is a
   *  documented fallback because the CPU baker has no bone branch. */
  material: 'flesh' | 'bone' | 'organ';
  /** Where the piece's geometry centre sat in the REST body frame. Local
   *  positions are `bodyPosition - offset`. */
  offset: Vec3;
  /** The planner's own piece origin (physics/spawn pivot), REST body frame. */
  origin: Vec3;
  /** Collision radius from the same recipe the marched path uses. */
  radius: number;
  /** Topple axis, same rule `spawnChunkPiece` uses. */
  longAxis: Vec3;
  verts: number;
  tris: number;
  bounds: GibAssetBounds;
  sections: GibAssetSection[];
  bind: GibAssetBindTable;
  /** Present only on the head piece. */
  face?: GibAssetFaceFrame;
  cuts: GibAssetCut[];
  approximation: GibAssetApproximation;
  /** Source-index provenance (body `prims` / `bonePrims`) — the same maps
   *  `GibPiece.srcPrims`/`srcBones` carry. */
  srcPrims: number[];
  srcBones: number[];
}

/** Deterministic size/counts. TIMINGS ARE NOT HERE — they live in the top-level
 *  manifest so a regenerated `.gib.json` is byte-identical for identical input
 *  (the plan's repeated-generation check). */
export interface GibAssetTotals {
  pieces: number;
  verts: number;
  tris: number;
  binBytes: number;
}

/** The full archetype document (the `.gib.json` file). */
export interface GibAssetArchetype {
  kind: typeof GIB_ASSET_KIND;
  schemaVersion: number;
  archetype: string;
  fingerprint: string;
  /** The recipe WITHOUT the source text (see `source` for the blob hash). */
  recipe: GibAssetRecipeHeader;
  source: { blob: string; blobBytes: number; blobHash: string };
  bake: { cellSize: number; carveK: number; gore: number; boneRelease: string; organs: boolean; cutMask: string; bindMask: string };
  offsets: { json: string; bin: string };
  totals: GibAssetTotals;
  pieces: GibAssetPiece[];
}

export interface GibAssetManifestEntry {
  archetype: string;
  fingerprint: string;
  /** Recipe WITHOUT the source text, so `--check` can recompute the recipe
   *  from the current `.blob` without loading the archetype document. */
  recipe: GibAssetRecipeHeader;
  json: string;
  bin: string;
  bytes: { json: number; bin: number };
  totals: GibAssetTotals;
  /** Diagnostics only — never part of a fingerprint. */
  timing: { bakeMs: number; buildMs: number };
  source: { blob: string; blobBytes: number; blobHash: string };
}

/** The top-level `manifest.json`. Deliberately small: a loader reads it first,
 *  then fetches only the archetype documents it needs. */
export interface GibAssetManifest {
  kind: typeof GIB_ASSET_KIND;
  schemaVersion: number;
  generator: string;
  /** ISO build time. Diagnostics only — written OUTSIDE the fingerprint. */
  builtAt: string;
  assets: GibAssetManifestEntry[];
}

/** Everything the geometry depends on. `blobSource` is the FULL text, so an
 *  equal-length edit changes the hash (the bug a length-only key would miss). */
export interface GibAssetRecipe {
  schemaVersion: number;
  generator: string;
  archetype: string;
  blobPath: string;
  blobSource: string;
  buildOpts: { silhouetteNoiseAmp: number; stepMultiplier: number; roundBlendScale?: number };
  /** The COMPLETE compiled face parameters — they change which head prims
   *  exist, so they are part of the geometry recipe, not a look detail. */
  face: Record<string, number>;
  palette: string;
  look: Record<string, number | readonly number[]>;
  surface: Record<string, number>;
  boneRelease: string;
  organs: boolean;
  cellSize: number;
  maxBindPrims: number;
  carveK: number;
  gore: number;
  /** The cut-mask derivation version. A change here means `bakeColor.a` means
   *  something different, so it MUST be in the fingerprint: an old set is
   *  detected as STALE instead of served with a dry cut. */
  cutMask: string;
  /** Which prims vertices may bind to (`GIB_ASSET_BIND_MASK`). A change here
   *  changes every deform, so an old set is STALE rather than served with the
   *  old binding. */
  bindMask: string;
}

/** Deterministic 64-bit FNV-1a over the UTF-8 bytes. Browser- and Node-safe. */
export function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i++) {
    h = ((h ^ BigInt(bytes[i]!)) * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

/** Recursively key-sorted JSON so a record's fingerprint does not depend on
 *  property insertion order. Arrays keep their order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * The asset's content fingerprint. Covers the full source text and every
 * setting that changes a vertex, an albedo channel or the binding — but NOT
 * timings, so regenerating identical inputs yields identical bytes. */
export function gibAssetRecipeFingerprint(recipe: GibAssetRecipe): string {
  return fnv1a64(stableStringify(recipe));
}

/** A recipe WITHOUT the source text (what the on-disk manifest stores beside
 *  the fingerprint; the loader re-reads the `.blob` from `blobPath` to check
 *  staleness). */
export type GibAssetRecipeHeader = Omit<GibAssetRecipe, 'blobSource'>;

export function gibAssetRecipeHeader(recipe: GibAssetRecipe): GibAssetRecipeHeader {
  const { blobSource: _blobSource, ...header } = recipe;
  return header;
}

// ---------------------------------------------------------------------------
// Binary encoding / decoding
// ---------------------------------------------------------------------------

export interface GibAssetSectionInput {
  name: GibAssetSectionName;
  data: Float32Array | Uint32Array | Uint16Array | Uint8Array;
}

/** Align `offset` up to a power-of-two boundary. */
function align(offset: number, to: number): number {
  return (offset + (to - 1)) & ~(to - 1);
}

export interface GibEncodedBin {
  /** Per piece, in the same order as the input, its section table. */
  sections: GibAssetSection[][];
  bin: Uint8Array;
}

function dtypeOf(data: GibAssetSectionInput['data']): GibAssetDType {
  if (data instanceof Float32Array) return 'f32';
  if (data instanceof Uint32Array) return 'u32';
  if (data instanceof Uint16Array) return 'u16';
  return 'u8';
}

/**
 * Encode every piece into one archetype `.gib.bin`. Deterministic: the same
 * inputs produce byte-identical output (fixed section order, fixed alignment,
 * tiny-endian writes via DataView). No timestamps.
 */
export function encodeGibAssetBin(pieces: GibAssetSectionInput[][]): GibEncodedBin {
  const tables: GibAssetSection[][] = [];
  let cursor = 0;
  for (const piece of pieces) {
    const table: GibAssetSection[] = [];
    for (const name of GIB_SECTION_ORDER) {
      const input = piece.find(s => s.name === name);
      if (!input) continue;
      const dtype = dtypeOf(input.data);
      const bytesPer = gibAssetDTypeBytes(dtype);
      const start = align(cursor, 4);
      const count = input.data.length;
      table.push({
        name, dtype, count,
        itemSize: 0, // filled by the caller/consumer from the piece header
        byteOffset: start,
        byteLength: count * bytesPer,
      });
      cursor = start + count * bytesPer;
    }
    tables.push(table);
  }
  const bin = new Uint8Array(cursor);
  const view = new DataView(bin.buffer);
  for (let p = 0; p < pieces.length; p++) {
    for (const sec of tables[p]!) {
      const input = pieces[p]!.find(s => s.name === sec.name)!;
      const off = sec.byteOffset;
      for (let i = 0; i < input.data.length; i++) {
        const v = input.data[i]!;
        if (sec.dtype === 'f32') view.setFloat32(off + i * 4, v, true);
        else if (sec.dtype === 'u32') view.setUint32(off + i * 4, v, true);
        else if (sec.dtype === 'u16') view.setUint16(off + i * 2, v, true);
        else view.setUint8(off + i, v);
      }
    }
  }
  return { sections: tables, bin };
}

/**
 * A typed-array VIEW onto one section. Falls back to a copy when the base
 * buffer is misaligned (a subarray slice of a larger fetch), so callers never
 * have to think about alignment.
 */
export function decodeGibAssetSection(
  sec: GibAssetSection, bin: Uint8Array,
): Float32Array | Uint32Array | Uint16Array | Uint8Array {
  const bytesPer = gibAssetDTypeBytes(sec.dtype);
  const abs = bin.byteOffset + sec.byteOffset;
  const aligned = abs % bytesPer === 0;
  const buf = aligned ? bin.buffer : bin.slice(sec.byteOffset, sec.byteOffset + sec.byteLength).buffer;
  const offset = aligned ? abs : 0;
  if (sec.dtype === 'f32') return new Float32Array(buf, offset, sec.count);
  if (sec.dtype === 'u32') return new Uint32Array(buf, offset, sec.count);
  if (sec.dtype === 'u16') return new Uint16Array(buf, offset, sec.count);
  return new Uint8Array(buf, offset, sec.count);
}

/** Every decoded channel of one piece, ready for the renderer / validator. */
export interface DecodedGibPiece {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  bakeColor: Float32Array;
  bakeResponse: Float32Array;
  bakeFresnel: Float32Array;
  bakeAnchor: Float32Array;
  bakeAo: Float32Array;
  bindIndex: Uint16Array;
  bindWeight: Uint8Array;
}

/** Decode one piece's sections. Throws when a required channel is absent —
 *  a silently-partial piece renders black or unskinned. */
export function decodeGibAssetPiece(piece: GibAssetPiece, bin: Uint8Array): DecodedGibPiece {
  const of = (name: GibAssetSectionName): GibAssetSection => {
    const sec = piece.sections.find(s => s.name === name);
    if (!sec) throw new Error(`gib asset ${piece.part}: missing section '${name}'`);
    return sec;
  };
  return {
    positions: decodeGibAssetSection(of('positions'), bin) as Float32Array,
    normals: decodeGibAssetSection(of('normals'), bin) as Float32Array,
    indices: decodeGibAssetSection(of('indices'), bin) as Uint16Array | Uint32Array,
    bakeColor: decodeGibAssetSection(of('bakeColor'), bin) as Float32Array,
    bakeResponse: decodeGibAssetSection(of('bakeResponse'), bin) as Float32Array,
    bakeFresnel: decodeGibAssetSection(of('bakeFresnel'), bin) as Float32Array,
    bakeAnchor: decodeGibAssetSection(of('bakeAnchor'), bin) as Float32Array,
    bakeAo: decodeGibAssetSection(of('bakeAo'), bin) as Float32Array,
    bindIndex: decodeGibAssetSection(of('bindIndex'), bin) as Uint16Array,
    bindWeight: decodeGibAssetSection(of('bindWeight'), bin) as Uint8Array,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface GibAssetValidation {
  ok: boolean;
  errors: string[];
}

const finite3 = (a: ArrayLike<number>, i: number): boolean =>
  Number.isFinite(a[i * 3]) && Number.isFinite(a[i * 3 + 1]) && Number.isFinite(a[i * 3 + 2]);

/**
 * Structural + numeric validation of one decoded piece. Pure and cheap: a
 * loader can run it on fetch (or a test on the committed files) and fall back
 * rather than draw garbage. `binLength` bounds every section offset.
 */
export function validateGibAssetPiece(
  piece: GibAssetPiece, decoded: DecodedGibPiece, binLength: number,
): GibAssetValidation {
  const errors: string[] = [];
  const err = (m: string) => errors.push(`${piece.part}: ${m}`);
  const v = piece.verts, t = piece.tris;

  if (v <= 0) err('empty geometry (0 vertices)');
  if (t <= 0) err('empty geometry (0 triangles)');
  if (decoded.positions.length !== v * 3) err(`positions ${decoded.positions.length} ≠ verts*3 ${v * 3}`);
  if (decoded.normals.length !== v * 3) err(`normals ${decoded.normals.length} ≠ verts*3 ${v * 3}`);
  if (decoded.indices.length !== t * 3) err(`indices ${decoded.indices.length} ≠ tris*3 ${t * 3}`);
  if (decoded.bakeColor.length !== v * 4) err(`bakeColor ${decoded.bakeColor.length} ≠ verts*4`);
  if (decoded.bakeResponse.length !== v * 4) err(`bakeResponse ${decoded.bakeResponse.length} ≠ verts*4`);
  if (decoded.bakeFresnel.length !== v) err(`bakeFresnel ${decoded.bakeFresnel.length} ≠ verts`);
  if (decoded.bakeAnchor.length !== v * 4) err(`bakeAnchor ${decoded.bakeAnchor.length} ≠ verts*4`);
  if (decoded.bakeAo.length !== v) err(`bakeAo ${decoded.bakeAo.length} ≠ verts`);
  if (decoded.bindIndex.length !== v * piece.bind.maxPrims) err(`bindIndex length ≠ verts*maxPrims`);
  if (decoded.bindWeight.length !== v * piece.bind.maxPrims) err(`bindWeight length ≠ verts*maxPrims`);

  for (let i = 0; i < piece.sections.length; i++) {
    const s = piece.sections[i]!;
    if (s.byteOffset < 0 || s.byteOffset + s.byteLength > binLength) {
      err(`section '${s.name}' out of bin bounds (${s.byteOffset}..${s.byteOffset + s.byteLength} of ${binLength})`);
    }
    if (s.count !== s.byteLength / gibAssetDTypeBytes(s.dtype)) err(`section '${s.name}' count/byteLength disagree`);
  }

  // Numeric checks — only run them once the lengths are trustworthy.
  if (errors.length === 0) {
    for (let i = 0; i < v; i++) {
      if (!finite3(decoded.positions, i)) { err(`non-finite position at vertex ${i}`); break; }
    }
    for (let i = 0; i < v; i++) {
      if (!finite3(decoded.normals, i)) { err(`non-finite normal at vertex ${i}`); break; }
      const nx = decoded.normals[i * 3]!, ny = decoded.normals[i * 3 + 1]!, nz = decoded.normals[i * 3 + 2]!;
      const l = Math.hypot(nx, ny, nz);
      if (Math.abs(l - 1) > 0.02) { err(`non-unit normal at vertex ${i} (|n|=${l.toFixed(4)})`); break; }
    }
    for (let i = 0; i < v; i++) {
      const c = decoded.bakeColor[i * 4]!, g = decoded.bakeColor[i * 4 + 1]!;
      const b = decoded.bakeColor[i * 4 + 2]!, w = decoded.bakeColor[i * 4 + 3]!;
      if (![c, g, b, w].every(Number.isFinite)) { err(`non-finite bakeColor at vertex ${i}`); break; }
    }
    for (let i = 0; i < decoded.bakeAo.length; i++) {
      const a = decoded.bakeAo[i]!;
      if (!Number.isFinite(a) || a < -1e-4 || a > 1 + 1e-4) { err(`bakeAo out of [0,1] at vertex ${i} (${a})`); break; }
    }
    for (let i = 0; i < decoded.indices.length; i++) {
      const idx = decoded.indices[i]!;
      if (idx >= v) { err(`index ${idx} ≥ verts ${v} at ${i}`); break; }
    }
    const primCount = piece.bind.prims.length;
    for (let i = 0; i < v; i++) {
      let sum = 0;
      let bad = false;
      for (let k = 0; k < piece.bind.maxPrims; k++) {
        const row = i * piece.bind.maxPrims + k;
        const bi = decoded.bindIndex[row]!;
        const w = decoded.bindWeight[row]!;
        if (bi >= primCount) { err(`bindIndex ${bi} ≥ prims ${primCount} at vertex ${i}`); bad = true; break; }
        if (!Number.isFinite(w)) { err(`non-finite bindWeight at vertex ${i}`); bad = true; break; }
        sum += w;
      }
      if (bad) break;
      // u8 weights normalised 0..255; a vertex with no prims at all is the one
      // legal zero row (a piece with an empty bind table).
      if (primCount > 0 && Math.abs(sum - 255) > 2) { err(`bind weights at vertex ${i} sum to ${sum}, not 255`); break; }
    }
  }

  const b = piece.bounds;
  if (![b.min, b.max, b.center].every(p => p.every(Number.isFinite)) || !Number.isFinite(b.sphereRadius)) {
    err('non-finite bounds');
  }
  return { ok: errors.length === 0, errors };
}

/** Validate the top-level manifest's shape (before any bin is fetched). */
export function validateGibAssetManifest(manifest: GibAssetManifest): GibAssetValidation {
  const errors: string[] = [];
  if (manifest.kind !== GIB_ASSET_KIND) errors.push(`manifest kind '${manifest.kind}' ≠ '${GIB_ASSET_KIND}'`);
  if (manifest.schemaVersion !== GIB_ASSET_SCHEMA_VERSION) {
    errors.push(`manifest schemaVersion ${manifest.schemaVersion} ≠ ${GIB_ASSET_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) errors.push('manifest has no assets');
  for (const a of manifest.assets ?? []) {
    if (!a.fingerprint || a.fingerprint.length !== 16) errors.push(`${a.archetype}: missing/invalid fingerprint`);
    if (!a.bin || !a.json) errors.push(`${a.archetype}: missing file reference`);
    if (a.totals.pieces <= 0 || a.totals.verts <= 0) errors.push(`${a.archetype}: empty totals`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// The bounded skinning reference
//
// The generator stores, per vertex, up to `maxPrims` (prim, weight) pairs into
// the piece's binding table. This is the reconstruction a runtime deformer can
// use to follow the current pose and the rupture's slough without touching the
// SDF. It is a CAPSULE-FRAME map: express the rest point in the prim's own
// segment frame, rebuild it in the posed frame with the posed/rest radius
// ratio. Exact for a capsule (the overwhelming majority of prims); a rounded
// box and a strand are approximated, which is one of the numbers the build
// records under `approximation`.
// ---------------------------------------------------------------------------

export interface GibPrimFrame {
  a: Vec3;
  b: Vec3;
  radius: number;
  radiusB?: number;
  scale: Vec3;
}

export function gibPrimFrame(p: GibAssetBindingPrim): GibPrimFrame {
  return { a: p.a, b: p.b, radius: p.radius, radiusB: p.radiusB, scale: p.scale };
}

/** Rest→posed map of one prim applied to a rest-frame point.
 *
 *  EXACT for a capsule whose endpoints have moved rigidly: `t` locates the
 *  closest point on the REST segment, the offset from that base is expressed in
 *  the REST segment frame and rebuilt in the POSED one — rotated by the
 *  shortest arc taking the rest axis onto the posed axis and scaled by the
 *  posed/rest radius ratio. Rotation is what keeps a swung limb's surface on
 *  the limb; omitting it (the pre-2026-09-17 behaviour) left the radial offset
 *  pointing the REST way, which for a metre-scale radial was a metre-scale
 *  error. A DEGENERATE segment (a point sphere, `|b-a| ≈ 0`) has no axis to
 *  rotate about, so its radial is carried unrotated — which is exactly why
 *  `GIB_ASSET_BIND_MASK` no longer lets a point cut cap be a bind target.
 *  Non-uniform `scale` is still approximated (only the radius ratio is used). */
export function primTransformPoint(q: Vec3, rest: GibPrimFrame, posed: GibPrimFrame): Vec3 {
  const d = sub(rest.b, rest.a);
  const l2 = dot(d, d);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(q, rest.a), d) / l2));
  const base: Vec3 = [rest.a[0] + d[0] * t, rest.a[1] + d[1] * t, rest.a[2] + d[2] * t];
  const radial: Vec3 = [q[0] - base[0], q[1] - base[1], q[2] - base[2]];
  const rr = rest.radius + ((rest.radiusB ?? rest.radius) - rest.radius) * t;
  const pr = posed.radius + ((posed.radiusB ?? posed.radius) - posed.radius) * t;
  const ratio = rr > 1e-9 ? pr / rr : 1;
  const pd = sub(posed.b, posed.a);
  const newBase: Vec3 = [posed.a[0] + pd[0] * t, posed.a[1] + pd[1] * t, posed.a[2] + pd[2] * t];
  // Rotate the radial offset from the rest axis frame onto the posed one. Both
  // segments must be non-degenerate: qFromTo normalises, and a point prim has
  // no direction to give it.
  const pdl2 = dot(pd, pd);
  if (l2 >= 1e-12 && pdl2 >= 1e-12) {
    const rot = qFromTo(d, pd);
    const r = qRotate(rot, radial);
    return [newBase[0] + r[0] * ratio, newBase[1] + r[1] * ratio, newBase[2] + r[2] * ratio];
  }
  return [newBase[0] + radial[0] * ratio, newBase[1] + radial[1] * ratio, newBase[2] + radial[2] * ratio];
}

/**
 * The blended skinning result for one vertex. `row` is the vertex's slot in
 * the flat bind arrays (`index`/`weight` of length verts*maxPrims).
 * `posed[i]` is the posed frame of binding prim `i`; a missing entry falls
 * back to the rest frame (a cap or an unmoved prim).
 */
export function deformBoundVertex(
  q: Vec3,
  row: number,
  bindIndex: ArrayLike<number>,
  bindWeight: ArrayLike<number>,
  maxPrims: number,
  prims: readonly GibAssetBindingPrim[],
  posed: readonly (GibPrimFrame | undefined)[],
  out?: [number, number, number],
): Vec3 {
  let x = 0, y = 0, z = 0, wsum = 0;
  for (let k = 0; k < maxPrims; k++) {
    const slot = row * maxPrims + k;
    const w = bindWeight[slot]! / 255;
    if (w <= 0) continue;
    const pi = bindIndex[slot]!;
    const prim = prims[pi];
    if (!prim) continue;
    const rest = gibPrimFrame(prim);
    const mapped = primTransformPoint(q, rest, posed[pi] ?? rest);
    x += mapped[0] * w; y += mapped[1] * w; z += mapped[2] * w; wsum += w;
  }
  if (wsum <= 1e-9) return out ? (out[0] = q[0], out[1] = q[1], out[2] = q[2], out) : [q[0], q[1], q[2]];
  const r: Vec3 = [x / wsum, y / wsum, z / wsum];
  if (out) { out[0] = r[0]; out[1] = r[1]; out[2] = r[2]; return out; }
  return r;
}
