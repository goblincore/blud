// src/lab/sdf-zombie/webgpu/humanoid-volume.ts
//
// Task 3 — the humanoid bone-SDF atlas's runtime half: strict manifest
// validation, ordered distance/color part loading, the coarse CPU brick pack
// (wound-slice dependency), and the two Data3DTextures the clustered marcher
// (Task 5) samples.
//
// WHY SO STRICT. Every field here has a silent-failure mode that produces a
// WRONG ZOMBIE rather than an error: a byte-swapped half is a different
// distance, a reordered transport part mirrors the field, a drifted brick
// offset samples the neighbour's flesh, and a missing occupiedBounds hands
// shoulder hits to the spine's wound broad phase. The validator therefore
// re-asserts the bake contract at load time (mirroring scripts/
// bake_humanoid_sdf.py's own rejection rules) rather than trusting the file,
// and loadHumanoidVolume adds byte-order and integrity checks on top. All of
// this is a blocking error — the spike is WebGPU-only and never falls back.

import * as THREE from 'three/webgpu';
import {
  createR16fTexture, sha256Hex, HOST_IS_LITTLE_ENDIAN,
} from './hand-volume';
// The hard host-endianness guard is shared with the hand loader (one
// implementation); re-exported so consumers pin it through this module.
export { HOST_IS_LITTLE_ENDIAN };

/** The only manifest version this runtime understands. */
export const HUMANOID_VOLUME_VERSION = 1;
export const HUMANOID_VOLUME_KIND = 'humanoid-bone-sdf';
export const HUMANOID_VOLUME_ORDER = 'x-fastest-y-z';
/** Atlas halo / brick separation in texels (bake pins this at 2). */
export const HUMANOID_ATLAS_PADDING = 2;
/** The one 30 mm weight-derived planar elbow band (never an endcap). */
export const HUMANOID_ELBOW_OVERLAP_M = 0.03;
/** Pitch caps: torso/limbs at most 6 mm, head/hands at most 3 mm. */
export const HUMANOID_LIMB_PITCH_CAP_M = 0.006;
export const HUMANOID_DETAIL_PITCH_CAP_M = 0.003;
/** Coarse CPU bricks are at most 16 voxels per axis (COARSE_MAX_DIM). */
export const HUMANOID_COARSE_MAX_DIM = 16;
/** Clusters sample at most four bricks (primaries + direct joint helpers). */
export const HUMANOID_MAX_SAMPLED_BONES_PER_CLUSTER = 4;
/** Pinned canonical owner asset — never modify Downloads. */
export const HUMANOID_SOURCE_SHA256 =
  '2b23530a64466ca650ead74e49feaf54b6463c254ecccc9b3d56ba993a33cd28';
/** Pinned sever constants; Tasks 4–7 consume these, never invent replacements. */
export const HUMANOID_SEVER_CUT_SEED = 12648430;
export const HUMANOID_SEVER_IRREGULARITY_M = 0.004;
export const HUMANOID_SEVER_RIM_WIDTH_M = 0.008;
/** The coarse pack rides next to the manifest under this fixed name (the
 *  baker resolves it the same way: scripts/bake_humanoid_sdf.py
 *  COARSE_FILENAME). */
export const COARSE_PACK_FILENAME = 'zombie-coarse.f32';

// -- stable public shapes (Tasks 4–10 import these exact names) ---------------

export interface HumanoidBrickManifest {
  bone: string;
  jointIndex: number;
  parentIndex: number;
  offset: [number, number, number];
  dimensions: [number, number, number];
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  voxelSize: [number, number, number];
  padding: 2;
  pageIndex: 0;
  /** Tight weight-derived bind bounds (wound broad phase MUST read these,
   *  never boundsMin/Max, which carry the exterior margin + trilinear halo). */
  occupiedBoundsMin: [number, number, number];
  occupiedBoundsMax: [number, number, number];
  fieldStats: {
    min: number;
    max: number;
    negativeCount: number;
    positiveCount: number;
    boundaryMin: number;
  };
  bindToModel: number[];   // 16 finite column-major values
  modelToBind: number[];   // checked inverse of bindToModel
}

export interface HumanoidBakeParameters {
  limbPitchM: number;
  detailPitchM: number;
  marginM: number;
  jointOverlapM: number;
  atlasPadding: 2;
  maxTransportPartBytes: number;
  route: 'direct-vdb';
  blenderVersion: string;
  nodeContractSha256: string;
  threshold: 0;
  adaptivity: 0;
  bandWidth: number;
  maxAtlasDimension: number;
}

export interface BinaryPartContract {
  url: string;
  byteLength: number;
  sha256: string;
}

export interface BinaryAtlasContract {
  parts: BinaryPartContract[];
  combinedByteLength: number;
  combinedSha256: string;
}

export interface HumanoidJointManifest {
  parent: string;
  child: string;
  centerModel: [number, number, number];
  axisModel: [number, number, number];
  overlapM: number;
}

export interface HumanoidClusterManifest {
  name: string;
  primaryBones: string[]; // every retained bone is primary in exactly one cluster
  sampleBones: string[];  // primaries plus direct joint helpers, length 1..4
  sweepBoundsMin: [number, number, number];
  sweepBoundsMax: [number, number, number];
}

export interface HumanoidCoarseBoneManifest {
  offset: number;
  dims: [number, number, number];
  byteLength: number;
  sha256: string;
}

export interface HumanoidCoarseContract {
  encoding: 'f32-le';
  bones: HumanoidCoarseBoneManifest[];
  combinedByteLength: number;
  combinedSha256: string;
}

export interface HumanoidVolumeManifest {
  version: 1;
  kind: 'humanoid-bone-sdf';
  order: 'x-fastest-y-z';
  /** 24 source skeleton joints; the retained bone array is 22 (head_end and
   *  headfront fold into Head) — index by ARRAY POSITION everywhere. */
  boneCount: number;
  pageCount: 1;
  atlasDimensions: [number, number, number];
  source: {
    url: string;
    originalFilename: string;
    byteLength: number;
    sha256: string;
    textureSha256: string;
  };
  sourceToRuntime: number[]; // 16 finite column-major values
  runtimeToSource: number[]; // checked inverse of sourceToRuntime
  bake: HumanoidBakeParameters;
  distance: BinaryAtlasContract & { encoding: 'r16f-le' };
  color: BinaryAtlasContract & { encoding: 'rgba8' };
  coarse: HumanoidCoarseContract;
  bones: HumanoidBrickManifest[];
  joints: HumanoidJointManifest[];
  clusters: HumanoidClusterManifest[];
  rightArm: {
    upperArm: 'RightArm';
    forearm: 'RightForeArm';
    hand: 'RightHand';
    cutPlaneLocal: [number, number, number, number];
    cutSeed: number;
    irregularityM: number;
    rimWidthM: number;
  };
}

/** One coarse CPU brick: a bind-local f32 distance field view. */
export interface HumanoidCoarseBrick {
  /** f32-le signed distance in the bone's BIND-LOCAL frame (metres),
   *  x-fastest-y-z — the same ordering as the R16F atlas. */
  data: Float32Array;
  dims: [number, number, number];
  /** Bind-local metres; identical to the dense brick's bounds. */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

/** The validated coarse pack. `bones` is indexed by manifest.bones[] array
 *  position — the same index space as poseMatrices, HumanoidPoseState.bones
 *  and humanoid-sever's distalIndices. CPU-side; never uploaded as a texture. */
export interface HumanoidCoarseBricks {
  bones: HumanoidCoarseBrick[];
  combinedByteLength: number;
  combinedSha256: string;
  dispose(): void;
}

export interface HumanoidVolumeAssets {
  manifest: HumanoidVolumeManifest;
  distanceTexture: THREE.Data3DTexture;
  colorTexture: THREE.Data3DTexture;
  /** CPU distance bricks for click-to-shoot sphere-tracing (Task 10). */
  coarse: HumanoidCoarseBricks;
  /** bone name -> manifest.bones[] array position. */
  boneIndex: ReadonlyMap<string, number>;
  /** Disposes the textures and coarse views. Idempotent. */
  dispose(): void;
}

// -- validation helpers -------------------------------------------------------

function fail(reason: string): never {
  throw new Error(`humanoid volume: ${reason}`);
}

const HEX64 = /^[0-9a-f]{64}$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function number(v: unknown, label: string): number {
  if (!isFiniteNumber(v)) fail(`${label} must be a finite number`);
  return v;
}

function positiveNumber(v: unknown, label: string): number {
  const n = number(v, label);
  if (!(n > 0)) fail(`${label} must be positive`);
  return n;
}

function integer(v: unknown, label: string): number {
  if (!Number.isInteger(v)) fail(`${label} must be an integer`);
  return v as number;
}

function vec3(v: unknown, label: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isFiniteNumber)) {
    fail(`${label} must be three finite numbers`);
  }
  return [v[0]!, v[1]!, v[2]!];
}

function vec4(v: unknown, label: string): [number, number, number, number] {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isFiniteNumber)) {
    fail(`${label} must be four finite numbers`);
  }
  return [v[0]!, v[1]!, v[2]!, v[3]!];
}

function hex64(v: unknown, label: string): string {
  if (typeof v !== 'string' || !HEX64.test(v)) {
    fail(`${label} must be a 64-char lowercase hex sha-256`);
  }
  return v;
}

/** Plain relative file name: no drive, no scheme, no traversal, no empties.
 *  Part URLs are FETCHED, so an absolute or traversal path would point the
 *  loader at a file outside the atlas directory. */
function plainRelative(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    fail(`${label} must be a file name`);
  }
  if (v.startsWith('/') || v.includes('\\') ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) {
    fail(`${label} must be relative (no absolute path or scheme)`);
  }
  const segs = v.split('/');
  if (segs.some(s => s === '' || s === '.' || s === '..')) {
    fail(`${label} must be a plain relative path (no traversal)`);
  }
  return v;
}

/** A 4x4 stored as 16 column-major floats (the bake's convention). */
function mat16(v: unknown, label: string): number[] {
  if (!Array.isArray(v) || v.length !== 16 || !v.every(isFiniteNumber)) {
    fail(`${label} must be 16 finite column-major values`);
  }
  return v as number[];
}

/** Column-major 4x4 product a @ b. */
function matMul4(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function isIdentity16(m: readonly number[], eps: number): boolean {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      const want = r === c ? 1 : 0;
      if (Math.abs(m[c * 4 + r]! - want) > eps) return false;
    }
  }
  return true;
}

// -- the validator ------------------------------------------------------------

function validateAtlasContract<E extends 'r16f-le' | 'rgba8'>(
  v: unknown, label: string, encoding: E, bytesPerTexel: number,
  atlasVolume: number,
): BinaryAtlasContract & { encoding: E } {
  if (typeof v !== 'object' || v === null) fail(`${label} must be an object`);
  const c = v as Record<string, unknown>;
  if (c.encoding !== encoding) {
    fail(`${label}.encoding must be ${encoding} (got ${String(c.encoding)})`);
  }
  const partsRaw = c.parts;
  if (!Array.isArray(partsRaw) || partsRaw.length === 0) {
    fail(`${label}.parts must be a non-empty ordered list`);
  }
  let sum = 0;
  const parts: BinaryPartContract[] = [];
  for (let i = 0; i < partsRaw.length; i++) {
    const p = partsRaw[i] as Record<string, unknown> | null;
    if (typeof p !== 'object' || p === null) {
      fail(`${label}.parts[${i}] must be an object`);
    }
    const url = plainRelative(p.url, `${label}.parts[${i}].url`);
    const byteLength = integer(p.byteLength, `${label}.parts[${i}].byteLength`);
    if (byteLength <= 0) fail(`${label}.parts[${i}].byteLength must be positive`);
    const sha = hex64(p.sha256, `${label}.parts[${i}].sha256`);
    sum += byteLength;
    parts.push({ url, byteLength, sha256: sha });
  }
  const combinedByteLength = integer(c.combinedByteLength, `${label}.combinedByteLength`);
  if (combinedByteLength <= 0) fail(`${label}.combinedByteLength must be positive`);
  if (combinedByteLength !== sum) {
    fail(`${label}.combinedByteLength ${combinedByteLength} != ordered part sum ${sum}`);
  }
  const combinedSha256 = hex64(c.combinedSha256, `${label}.combinedSha256`);
  const expected = bytesPerTexel * atlasVolume;
  if (combinedByteLength !== expected) {
    fail(`${label}.combinedByteLength ${combinedByteLength} != ${bytesPerTexel} bytes * atlas volume ${atlasVolume} (${expected})`);
  }
  return { parts, combinedByteLength, combinedSha256, encoding };
}

/**
 * Validates an unknown manifest against the bake contract, returning it
 * typed. Throws (rather than returning a result) because every caller treats
 * an invalid atlas as a load failure — this spike is WebGPU-only and has no
 * mesh fallback.
 */
export function validateHumanoidVolumeManifest(input: unknown): HumanoidVolumeManifest {
  if (typeof input !== 'object' || input === null) fail('manifest must be an object');
  const m = input as Record<string, unknown>;

  if (m.version !== HUMANOID_VOLUME_VERSION) {
    fail(`unsupported manifest version ${String(m.version)} (expected ${HUMANOID_VOLUME_VERSION})`);
  }
  if (m.kind !== HUMANOID_VOLUME_KIND) {
    fail(`unsupported kind ${String(m.kind)} (expected ${HUMANOID_VOLUME_KIND})`);
  }
  if (m.order !== HUMANOID_VOLUME_ORDER) {
    fail(`unsupported sample order ${String(m.order)} (expected ${HUMANOID_VOLUME_ORDER})`);
  }
  if (m.pageCount !== 1) {
    fail(`pageCount must be 1 (one logical atlas per texture; got ${String(m.pageCount)})`);
  }

  // boneCount: the 24-joint skeleton; head_end/headfront fold into Head, so
  // the retained bone array must stay STRICTLY below it (baker mirror).
  const boneCount = integer(m.boneCount, 'boneCount');
  if (boneCount <= 0) fail('boneCount must be a positive integer');

  const atlasRaw = m.atlasDimensions;
  if (!Array.isArray(atlasRaw) || atlasRaw.length !== 3 ||
      !atlasRaw.every(d => Number.isInteger(d) && (d as number) >= 2)) {
    fail('atlasDimensions must be three integers >= 2');
  }
  const atlasDimensions = [atlasRaw[0]!, atlasRaw[1]!, atlasRaw[2]!] as [number, number, number];
  const atlasVolume = atlasDimensions[0] * atlasDimensions[1] * atlasDimensions[2];

  // bake — exact caps and pipeline identity (the baker rejects drift too).
  const bake = m.bake as Record<string, unknown> | null;
  if (typeof bake !== 'object' || bake === null) fail('bake must be an object');
  const limbPitchM = number(bake.limbPitchM, 'bake.limbPitchM');
  if (limbPitchM > HUMANOID_LIMB_PITCH_CAP_M) {
    fail(`bake.limbPitchM ${limbPitchM} exceeds the ${HUMANOID_LIMB_PITCH_CAP_M} m limb cap`);
  }
  const detailPitchM = number(bake.detailPitchM, 'bake.detailPitchM');
  if (detailPitchM > HUMANOID_DETAIL_PITCH_CAP_M) {
    fail(`bake.detailPitchM ${detailPitchM} exceeds the ${HUMANOID_DETAIL_PITCH_CAP_M} m detail cap`);
  }
  const marginM = positiveNumber(bake.marginM, 'bake.marginM');
  const jointOverlapM = number(bake.jointOverlapM, 'bake.jointOverlapM');
  if (Math.abs(jointOverlapM - HUMANOID_ELBOW_OVERLAP_M) > 1e-9) {
    fail(`bake.jointOverlapM must be the ${HUMANOID_ELBOW_OVERLAP_M} m weight-derived band`);
  }
  const atlasPadding = integer(bake.atlasPadding, 'bake.atlasPadding');
  if (atlasPadding !== HUMANOID_ATLAS_PADDING) {
    fail(`bake.atlasPadding must be ${HUMANOID_ATLAS_PADDING}`);
  }
  const maxTransportPartBytes = integer(bake.maxTransportPartBytes, 'bake.maxTransportPartBytes');
  if (maxTransportPartBytes <= 0) fail('bake.maxTransportPartBytes must be positive');
  if (bake.route !== 'direct-vdb') fail(`bake.route must be 'direct-vdb' (got ${String(bake.route)})`);
  if (typeof bake.blenderVersion !== 'string' || bake.blenderVersion.length === 0) {
    fail('bake.blenderVersion must be a non-empty string');
  }
  const nodeContractSha256 = hex64(bake.nodeContractSha256, 'bake.nodeContractSha256');
  if (bake.threshold !== 0) fail(`bake.threshold must be 0 (got ${String(bake.threshold)})`);
  if (bake.adaptivity !== 0) fail(`bake.adaptivity must be 0 (got ${String(bake.adaptivity)})`);
  const bandWidth = integer(bake.bandWidth, 'bake.bandWidth');
  if (bandWidth <= 0) fail('bake.bandWidth must be a positive integer');
  const maxAtlasDimension = integer(bake.maxAtlasDimension, 'bake.maxAtlasDimension');
  if (maxAtlasDimension < Math.max(...atlasDimensions)) {
    fail('bake.maxAtlasDimension is smaller than the atlas');
  }

  // source — the canonical owner asset is pinned by sha-256.
  const source = m.source as Record<string, unknown> | null;
  if (typeof source !== 'object' || source === null) fail('source must be an object');
  if (typeof source.url !== 'string' || source.url.length === 0) {
    fail('source.url must be a non-empty string');
  }
  if (typeof source.originalFilename !== 'string' || source.originalFilename.length === 0) {
    fail('source.originalFilename must be a non-empty string');
  }
  const sourceByteLength = integer(source.byteLength, 'source.byteLength');
  if (sourceByteLength <= 0) fail('source.byteLength must be positive');
  const sourceSha256 = hex64(source.sha256, 'source.sha256');
  if (sourceSha256 !== HUMANOID_SOURCE_SHA256) {
    fail('source.sha256 drifted from the canonical owner asset');
  }
  const textureSha256 = hex64(source.textureSha256, 'source.textureSha256');
  if (m.sourceTextureSha256 !== undefined && m.sourceTextureSha256 !== textureSha256) {
    fail('top-level sourceTextureSha256 disagrees with source.textureSha256');
  }

  // source/runtime basis — checked inverses.
  const sourceToRuntime = mat16(m.sourceToRuntime, 'sourceToRuntime');
  const runtimeToSource = mat16(m.runtimeToSource, 'runtimeToSource');
  if (!isIdentity16(matMul4(sourceToRuntime, runtimeToSource), 1e-4)) {
    fail('sourceToRuntime and runtimeToSource are not inverse within 1e-4');
  }

  // transport contracts — encodings, ordered parts, byte sums, atlas volume.
  const distance = validateAtlasContract(
    m.distance, 'distance', 'r16f-le', 2, atlasVolume);
  const color = validateAtlasContract(m.color, 'color', 'rgba8', 4, atlasVolume);

  // bones — the brick layout is the shared contract for BOTH atlases.
  const bonesRaw = m.bones;
  if (!Array.isArray(bonesRaw) || bonesRaw.length === 0) {
    fail('bones must be a non-empty array');
  }
  if (bonesRaw.length >= boneCount) {
    fail(`bones length ${bonesRaw.length} must stay below boneCount ${boneCount} (the head fold)`);
  }
  const bones: HumanoidBrickManifest[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < bonesRaw.length; i++) {
    const b = bonesRaw[i] as Record<string, unknown> | null;
    if (typeof b !== 'object' || b === null) fail(`bones[${i}] must be an object`);
    const bone = b.bone;
    if (typeof bone !== 'string' || bone.length === 0) {
      fail(`bones[${i}].bone must be a non-empty name`);
    }
    if (seenNames.has(bone)) fail(`duplicate bone name ${bone}`);
    seenNames.add(bone);

    const jointIndex = integer(b.jointIndex, `bones[${i}].jointIndex`);
    if (jointIndex < 0) fail(`bones[${i}].jointIndex must be >= 0`);
    const parentIndex = integer(b.parentIndex, `bones[${i}].parentIndex`);
    if (parentIndex !== -1) {
      if (parentIndex < 0 || parentIndex >= bonesRaw.length) {
        fail(`bones[${i}].parentIndex ${parentIndex} is out of range`);
      }
      // Topological tree: a parent's joint always precedes its child's, so a
      // parentIndex that does not precede the jointIndex is a cycle.
      if (parentIndex >= jointIndex) {
        fail(`bones[${i}].parentIndex ${parentIndex} must precede jointIndex ${jointIndex} (parent cycle)`);
      }
    }

    const offset = vec3(b.offset, `bones[${i}].offset`).map(v => integer(v, `bones[${i}].offset`));
    const dimensions = vec3(b.dimensions, `bones[${i}].dimensions`).map(v => integer(v, `bones[${i}].dimensions`));
    for (let k = 0; k < 3; k++) {
      if (offset[k]! < HUMANOID_ATLAS_PADDING) {
        fail(`bones[${i}].offset[${k}] must be >= the ${HUMANOID_ATLAS_PADDING}-texel atlas halo`);
      }
      if (dimensions[k]! < 1) fail(`bones[${i}].dimensions[${k}] must be >= 1`);
      if (offset[k]! + dimensions[k]! > atlasDimensions[k]!) {
        fail(`bones[${i}] brick ${JSON.stringify(offset)}+${JSON.stringify(dimensions)} exceeds the atlas ${JSON.stringify(atlasDimensions)}`);
      }
    }
    if (b.padding !== HUMANOID_ATLAS_PADDING) {
      fail(`bones[${i}].padding must be ${HUMANOID_ATLAS_PADDING}`);
    }
    if (b.pageIndex !== 0) fail(`bones[${i}].pageIndex must be 0 (single logical atlas)`);

    const boundsMin = vec3(b.boundsMin, `bones[${i}].boundsMin`);
    const boundsMax = vec3(b.boundsMax, `bones[${i}].boundsMax`);
    for (let k = 0; k < 3; k++) {
      if (!(boundsMin[k]! < boundsMax[k]!)) {
        fail(`bones[${i}].boundsMin[${k}] must be strictly below boundsMax[${k}]`);
      }
    }

    // occupied bounds are REQUIRED: the wound broad phase (Tasks 8/10) reads
    // ONLY these, so a manifest missing them must never silently fall back to
    // the padded boundsMin/Max.
    if (b.occupiedBoundsMin === undefined || b.occupiedBoundsMin === null ||
        b.occupiedBoundsMax === undefined || b.occupiedBoundsMax === null) {
      fail(`bones[${i}].occupiedBoundsMin/Max are required (wound broad phase must never fall back to boundsMin/Max)`);
    }
    const occupiedBoundsMin = vec3(b.occupiedBoundsMin, `bones[${i}].occupiedBoundsMin`);
    const occupiedBoundsMax = vec3(b.occupiedBoundsMax, `bones[${i}].occupiedBoundsMax`);
    for (let k = 0; k < 3; k++) {
      if (!(occupiedBoundsMin[k]! < occupiedBoundsMax[k]!)) {
        fail(`bones[${i}].occupiedBoundsMin[${k}] must be strictly below occupiedBoundsMax[${k}]`);
      }
      // Tight weight-derived bind bounds always sit inside the padded brick.
      if (occupiedBoundsMin[k]! < boundsMin[k]! - 1e-6 ||
          occupiedBoundsMax[k]! > boundsMax[k]! + 1e-6) {
        fail(`bones[${i}] occupied bounds escape the brick bounds`);
      }
    }

    const voxelSize = vec3(b.voxelSize, `bones[${i}].voxelSize`);
    // Head/Hand detail bricks run at the 3 mm cap, everything else at 6 mm.
    const pitchCap = /(Head|Hand)/.test(bone) ? detailPitchM : limbPitchM;
    for (let k = 0; k < 3; k++) {
      if (!(voxelSize[k]! > 0)) fail(`bones[${i}].voxelSize[${k}] must be positive`);
      // Float tolerance: RightLeg legitimately bakes 0.006000000000000001.
      if (voxelSize[k]! > pitchCap + 1e-9) {
        fail(`bones[${i}].voxelSize[${k}] ${voxelSize[k]} exceeds the ${pitchCap} m pitch cap`);
      }
      // Endpoint-inclusive lattice: pitch must equal extent / (n - 1) — a
      // shifted grid transform breaks this.
      const want = (boundsMax[k]! - boundsMin[k]!) / (dimensions[k]! - 1);
      if (Math.abs(voxelSize[k]! - want) > 1e-9) {
        fail(`bones[${i}].voxelSize[${k}] is inconsistent with bounds/dimensions`);
      }
    }

    const fs = b.fieldStats as Record<string, unknown> | null;
    if (typeof fs !== 'object' || fs === null) fail(`bones[${i}].fieldStats must be an object`);
    const fMin = number(fs.min, `bones[${i}].fieldStats.min`);
    const fMax = number(fs.max, `bones[${i}].fieldStats.max`);
    const boundaryMin = number(fs.boundaryMin, `bones[${i}].fieldStats.boundaryMin`);
    if (!(fMin < 0)) fail(`bones[${i}].fieldStats.min must be negative (every brick contains the surface)`);
    if (!(fMax > 0)) fail(`bones[${i}].fieldStats.max must be positive (every brick contains the surface)`);
    const negativeCount = integer(fs.negativeCount, `bones[${i}].fieldStats.negativeCount`);
    const positiveCount = integer(fs.positiveCount, `bones[${i}].fieldStats.positiveCount`);
    if (negativeCount < 0 || positiveCount < 0) {
      fail(`bones[${i}].fieldStats counts must be >= 0`);
    }

    const bindToModel = mat16(b.bindToModel, `bones[${i}].bindToModel`);
    const modelToBind = mat16(b.modelToBind, `bones[${i}].modelToBind`);
    if (!isIdentity16(matMul4(bindToModel, modelToBind), 1e-4)) {
      fail(`bones[${i}] bindToModel/modelToBind are not inverse within 1e-4`);
    }
    hex64(b.supportMeshSha256, `bones[${i}].supportMeshSha256`);

    bones.push({
      bone,
      jointIndex,
      parentIndex,
      offset: offset as [number, number, number],
      dimensions: dimensions as [number, number, number],
      boundsMin,
      boundsMax,
      voxelSize,
      padding: HUMANOID_ATLAS_PADDING,
      pageIndex: 0,
      occupiedBoundsMin,
      occupiedBoundsMax,
      fieldStats: { min: fMin, max: fMax, negativeCount, positiveCount, boundaryMin },
      bindToModel,
      modelToBind,
    });
  }

  // Padded brick regions must be disjoint (the baker keeps the halo gap).
  for (let i = 0; i < bones.length; i++) {
    for (let j = i + 1; j < bones.length; j++) {
      const a = bones[i]!;
      const b = bones[j]!;
      let separated = false;
      for (let k = 0; k < 3; k++) {
        if (a.offset[k]! + a.dimensions[k]! + HUMANOID_ATLAS_PADDING <= b.offset[k]! ||
            b.offset[k]! + b.dimensions[k]! + HUMANOID_ATLAS_PADDING <= a.offset[k]!) {
          separated = true;
          break;
        }
      }
      if (!separated) {
        fail(`atlas bricks ${a.bone} and ${b.bone} overlap (padded regions)`);
      }
    }
  }

  // joints — exactly the retained tree edges, cross-checked against bones[].
  const nonRootCount = bones.length - 1; // every bone except Hips has one parent
  const jointsRaw = m.joints;
  if (!Array.isArray(jointsRaw) || jointsRaw.length !== nonRootCount) {
    fail(`joints must list exactly the ${nonRootCount} retained parent edges`);
  }
  const boneIndex = new Map(bones.map((b, i) => [b.bone, i]));
  const joints: HumanoidJointManifest[] = [];
  const seenChildren = new Set<string>();
  for (let i = 0; i < jointsRaw.length; i++) {
    const j = jointsRaw[i] as Record<string, unknown> | null;
    if (typeof j !== 'object' || j === null) fail(`joints[${i}] must be an object`);
    const parent = j.parent;
    const child = j.child;
    if (typeof parent !== 'string' || typeof child !== 'string' ||
        !boneIndex.has(parent) || !boneIndex.has(child)) {
      fail(`joints[${i}] parent/child must reference retained bone names`);
    }
    if (seenChildren.has(child)) fail(`joints[${i}] child ${child} is listed twice`);
    seenChildren.add(child);
    const childIdx = boneIndex.get(child)!;
    const parentIdx = bones[childIdx]!.parentIndex;
    if (parentIdx === -1) fail(`joints[${i}] child ${child} is a root and has no parent`);
    if (bones[parentIdx]!.bone !== parent) {
      fail(`joints[${i}] parent ${parent} does not match the bone tree parent ${bones[parentIdx]!.bone}`);
    }
    const centerModel = vec3(j.centerModel, `joints[${i}].centerModel`);
    const axisModel = vec3(j.axisModel, `joints[${i}].axisModel`);
    const axisLen = Math.hypot(...axisModel);
    if (Math.abs(axisLen - 1) > 1e-6) {
      fail(`joints[${i}] axisModel is not unit length (norm ${axisLen})`);
    }
    const overlapM = number(j.overlapM, `joints[${i}].overlapM`);
    if (Math.abs(overlapM - HUMANOID_ELBOW_OVERLAP_M) > 1e-9) {
      fail(`joints[${i}].overlapM must be the ${HUMANOID_ELBOW_OVERLAP_M} m band`);
    }
    joints.push({ parent, child, centerModel, axisModel, overlapM });
  }

  // clusters — primaries partition the retained bones exactly; samples are
  // primaries plus direct joint helpers, capped at four.
  const clustersRaw = m.clusters;
  if (!Array.isArray(clustersRaw) || clustersRaw.length === 0) {
    fail('clusters must be a non-empty array');
  }
  const primaryCounts = new Map<string, number>();
  const clusters: HumanoidClusterManifest[] = [];
  const seenClusters = new Set<string>();
  for (let i = 0; i < clustersRaw.length; i++) {
    const c = clustersRaw[i] as Record<string, unknown> | null;
    if (typeof c !== 'object' || c === null) fail(`clusters[${i}] must be an object`);
    const name = c.name;
    if (typeof name !== 'string' || name.length === 0) fail(`clusters[${i}].name must be a non-empty string`);
    if (seenClusters.has(name)) fail(`duplicate cluster name ${name}`);
    seenClusters.add(name);

    const primaryBonesRaw = c.primaryBones;
    const sampleBonesRaw = c.sampleBones;
    if (!Array.isArray(primaryBonesRaw) || primaryBonesRaw.length === 0 ||
        !Array.isArray(sampleBonesRaw) || sampleBonesRaw.length === 0) {
      fail(`clusters[${i}] primaryBones/sampleBones must be non-empty arrays`);
    }
    if (sampleBonesRaw.length > HUMANOID_MAX_SAMPLED_BONES_PER_CLUSTER) {
      fail(`clusters[${i}] samples ${sampleBonesRaw.length} bones, max is ${HUMANOID_MAX_SAMPLED_BONES_PER_CLUSTER}`);
    }
    const primaryBones: string[] = [];
    for (const p of primaryBonesRaw) {
      if (typeof p !== 'string' || !boneIndex.has(p)) {
        fail(`clusters[${i}] primary ${String(p)} is not a retained bone`);
      }
      if (primaryBones.includes(p)) fail(`clusters[${i}] primary ${p} listed twice`);
      primaryBones.push(p);
    }
    const sampleBones: string[] = [];
    for (const s of sampleBonesRaw) {
      if (typeof s !== 'string' || !boneIndex.has(s)) {
        fail(`clusters[${i}] sample ${String(s)} is not a retained bone`);
      }
      if (sampleBones.includes(s)) fail(`clusters[${i}] sample ${s} listed twice`);
      sampleBones.push(s);
    }
    for (const p of primaryBones) {
      if (!sampleBones.includes(p)) {
        fail(`clusters[${i}] primary ${p} must be sampled`);
      }
      primaryCounts.set(p, (primaryCounts.get(p) ?? 0) + 1);
    }
    const sweepBoundsMin = vec3(c.sweepBoundsMin, `clusters[${i}].sweepBoundsMin`);
    const sweepBoundsMax = vec3(c.sweepBoundsMax, `clusters[${i}].sweepBoundsMax`);
    for (let k = 0; k < 3; k++) {
      if (!(sweepBoundsMin[k]! < sweepBoundsMax[k]!)) {
        fail(`clusters[${i}].sweepBoundsMin[${k}] must be below sweepBoundsMax[${k}]`);
      }
    }
    clusters.push({ name, primaryBones, sampleBones, sweepBoundsMin, sweepBoundsMax });
  }
  for (const b of bones) {
    if (primaryCounts.get(b.bone) !== 1) {
      fail(`cluster primaries do not partition the retained bones exactly (${b.bone} is primary ${primaryCounts.get(b.bone) ?? 0} times)`);
    }
  }
  const rightArmCluster = clusters.find(c => c.name === 'right-arm');
  if (!rightArmCluster) fail('no right-arm cluster');
  for (const want of ['RightArm', 'RightForeArm', 'RightHand']) {
    if (!rightArmCluster.sampleBones.includes(want)) {
      fail(`right-arm cluster must sample ${want}`);
    }
  }

  // rightArm — the exact mapping and pinned sever constants.
  const ra = m.rightArm as Record<string, unknown> | null;
  if (typeof ra !== 'object' || ra === null) fail('rightArm must be an object');
  for (const [key, want] of [['upperArm', 'RightArm'], ['forearm', 'RightForeArm'], ['hand', 'RightHand']] as const) {
    if (ra[key] !== want) fail(`rightArm.${key} must be ${want} (got ${String(ra[key])})`);
  }
  const cutPlaneLocal = vec4(ra.cutPlaneLocal, 'rightArm.cutPlaneLocal');
  if (Math.abs(Math.hypot(cutPlaneLocal[0], cutPlaneLocal[1], cutPlaneLocal[2]) - 1) > 1e-6) {
    fail('rightArm.cutPlaneLocal normal is not unit length');
  }
  const cutSeed = integer(ra.cutSeed, 'rightArm.cutSeed');
  if (cutSeed !== HUMANOID_SEVER_CUT_SEED) fail('rightArm.cutSeed drifted');
  if (ra.irregularityM !== HUMANOID_SEVER_IRREGULARITY_M) fail('rightArm.irregularityM drifted');
  if (ra.rimWidthM !== HUMANOID_SEVER_RIM_WIDTH_M) fail('rightArm.rimWidthM drifted');

  // coarse — the CPU brick pack, indexed by bones[] array position.
  const coarse = m.coarse as Record<string, unknown> | null;
  if (typeof coarse !== 'object' || coarse === null) fail('coarse must be an object');
  if (coarse.encoding !== 'f32-le') fail(`coarse.encoding must be f32-le (got ${String(coarse.encoding)})`);
  const coarseCombinedByteLength = integer(coarse.combinedByteLength, 'coarse.combinedByteLength');
  if (coarseCombinedByteLength <= 0) fail('coarse.combinedByteLength must be positive');
  const coarseCombinedSha256 = hex64(coarse.combinedSha256, 'coarse.combinedSha256');
  const coarseBonesRaw = coarse.bones;
  if (!Array.isArray(coarseBonesRaw) || coarseBonesRaw.length !== bones.length) {
    fail(`coarse.bones must be indexed by manifest.bones[] array position (${bones.length} entries)`);
  }
  const coarseBones: HumanoidCoarseBoneManifest[] = [];
  let coarseSum = 0;
  for (let i = 0; i < coarseBonesRaw.length; i++) {
    const cb = coarseBonesRaw[i] as Record<string, unknown> | null;
    if (typeof cb !== 'object' || cb === null) fail(`coarse.bones[${i}] must be an object`);
    const offset = integer(cb.offset, `coarse.bones[${i}].offset`);
    if (offset < 0) fail(`coarse.bones[${i}].offset must be >= 0`);
    if (offset % 4 !== 0) fail(`coarse.bones[${i}].offset must be 4-byte aligned for f32 views`);
    const dimsRaw = cb.dims;
    if (!Array.isArray(dimsRaw) || dimsRaw.length !== 3) {
      fail(`coarse.bones[${i}].dims must be three integers`);
    }
    const dims = dimsRaw.map(v => integer(v, `coarse.bones[${i}].dims`)) as [number, number, number];
    for (let k = 0; k < 3; k++) {
      if (dims[k]! < 1 || dims[k]! > HUMANOID_COARSE_MAX_DIM) {
        fail(`coarse.bones[${i}].dims[${k}] must be 1..${HUMANOID_COARSE_MAX_DIM}`);
      }
    }
    const byteLength = integer(cb.byteLength, `coarse.bones[${i}].byteLength`);
    const wantBytes = 4 * dims[0] * dims[1] * dims[2];
    if (byteLength !== wantBytes) {
      fail(`coarse.bones[${i}].byteLength ${byteLength} != 4 * dims product (${wantBytes})`);
    }
    if (offset + byteLength > coarseCombinedByteLength) {
      fail(`coarse.bones[${i}] offset+byteLength overruns the pack`);
    }
    hex64(cb.sha256, `coarse.bones[${i}].sha256`);
    coarseSum += byteLength;
    coarseBones.push({ offset, dims, byteLength, sha256: cb.sha256 as string });
  }
  if (coarseSum !== coarseCombinedByteLength) {
    fail(`coarse.combinedByteLength must equal the per-bone sum (${coarseSum})`);
  }

  return {
    version: 1,
    kind: 'humanoid-bone-sdf',
    order: 'x-fastest-y-z',
    boneCount,
    pageCount: 1,
    atlasDimensions,
    source: {
      url: source.url as string,
      originalFilename: source.originalFilename as string,
      byteLength: sourceByteLength,
      sha256: sourceSha256,
      textureSha256,
    },
    sourceToRuntime,
    runtimeToSource,
    bake: {
      limbPitchM,
      detailPitchM,
      marginM,
      jointOverlapM,
      atlasPadding: 2,
      maxTransportPartBytes,
      route: 'direct-vdb',
      blenderVersion: bake.blenderVersion as string,
      nodeContractSha256,
      threshold: 0,
      adaptivity: 0,
      bandWidth,
      maxAtlasDimension,
    },
    distance,
    color,
    coarse: {
      encoding: 'f32-le',
      bones: coarseBones,
      combinedByteLength: coarseCombinedByteLength,
      combinedSha256: coarseCombinedSha256,
    },
    bones,
    joints,
    clusters,
    rightArm: {
      upperArm: 'RightArm',
      forearm: 'RightForeArm',
      hand: 'RightHand',
      cutPlaneLocal,
      cutSeed,
      irregularityM: ra.irregularityM as number,
      rimWidthM: ra.rimWidthM as number,
    },
  };
}

// -- texture construction -----------------------------------------------------

/** The one RGBA8 texture construction for the humanoid color atlas: raw
 *  bytes, nearest filtering (the marcher does its own trilinear from eight
 *  textureLoads), clamp-to-edge in all three axes, no mips. */
export function createRgba8Texture(
  bits: Uint8Array, dimensions: readonly [number, number, number],
): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(bits, dimensions[0], dimensions[1], dimensions[2]);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// -- ordered part loading -----------------------------------------------------

/** Fetches each part in DECLARED order, verifying per-part bytes/hash, then
 *  concatenates and verifies the combined bytes/hash. The returned buffer is
 *  a fresh 0-aligned copy (concatenation), so texture views are safe. */
async function fetchParts(
  manifestUrl: URL, contract: BinaryAtlasContract,
): Promise<ArrayBuffer> {
  const chunks: ArrayBuffer[] = [];
  for (const part of contract.parts) {
    const url = new URL(part.url, manifestUrl);
    const res = await fetch(url);
    if (!res.ok) fail(`part fetch ${url.href} failed: HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength !== part.byteLength) {
      fail(`part ${url.href} byte length ${buffer.byteLength} disagrees with manifest ${part.byteLength}`);
    }
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const digest = await sha256Hex(buffer);
      if (digest !== part.sha256) {
        fail(`part ${url.href} sha-256 mismatch: manifest says ${part.sha256}, payload is ${digest}`);
      }
    }
    chunks.push(buffer);
  }
  const combined = new Uint8Array(contract.combinedByteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await sha256Hex(combined.buffer);
    if (digest !== contract.combinedSha256) {
      fail(`combined sha-256 mismatch: manifest says ${contract.combinedSha256}, payload is ${digest}`);
    }
  }
  return combined.buffer;
}

/** Fetches the single coarse pack file next to the manifest and builds the
 *  validated per-bone Float32Array views (no texture is ever created from
 *  it — the pack stays CPU-side for click-to-shoot sphere-tracing). */
async function fetchCoarse(
  manifestUrl: URL, manifest: HumanoidVolumeManifest,
): Promise<HumanoidCoarseBricks> {
  const url = new URL(COARSE_PACK_FILENAME, manifestUrl);
  const res = await fetch(url);
  if (!res.ok) fail(`coarse fetch ${url.href} failed: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength !== manifest.coarse.combinedByteLength) {
    fail(`coarse pack byte length ${buffer.byteLength} disagrees with manifest ${manifest.coarse.combinedByteLength}`);
  }
  const verify = typeof crypto !== 'undefined' && crypto.subtle;
  if (verify) {
    const digest = await sha256Hex(buffer);
    if (digest !== manifest.coarse.combinedSha256) {
      fail(`coarse pack sha-256 mismatch: manifest says ${manifest.coarse.combinedSha256}, payload is ${digest}`);
    }
  }
  const bricks: HumanoidCoarseBrick[] = [];
  for (let i = 0; i < manifest.coarse.bones.length; i++) {
    const spec = manifest.coarse.bones[i]!;
    const bone = manifest.bones[i]!.bone;
    if (verify) {
      const slice = buffer.slice(spec.offset, spec.offset + spec.byteLength);
      const digest = await sha256Hex(slice);
      if (digest !== spec.sha256) {
        fail(`coarse bone ${bone} sha-256 mismatch (index ${i})`);
      }
    }
    const view = new Float32Array(buffer, spec.offset, spec.byteLength / 4);
    for (let v = 0; v < view.length; v++) {
      if (!Number.isFinite(view[v]!)) {
        fail(`coarse bone ${bone} contains a non-finite value at voxel ${v}`);
      }
    }
    bricks.push({
      data: view,
      dims: spec.dims,
      boundsMin: manifest.bones[i]!.boundsMin,
      boundsMax: manifest.bones[i]!.boundsMax,
    });
  }
  let disposed = false;
  return {
    bones: bricks,
    combinedByteLength: manifest.coarse.combinedByteLength,
    combinedSha256: manifest.coarse.combinedSha256,
    dispose() {
      if (!disposed) {
        disposed = true;
        bricks.length = 0; // drop the views; the pack buffer is GC'd
      }
    },
  };
}

/**
 * Fetches and validates the humanoid manifest, then its ordered distance and
 * color transport parts plus the coarse CPU brick pack (all resolved
 * RELATIVE to the manifest URL), checks byte order/length/integrity, and
 * builds the two Data3DTextures at the atlas dimensions. Nothing is
 * allocated before validation succeeds and no partially initialized object
 * can escape: every failure throws before the single return.
 */
export async function loadHumanoidVolume(url: string): Promise<HumanoidVolumeAssets> {
  const manifestUrl = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
  const res = await fetch(manifestUrl);
  if (!res.ok) fail(`manifest fetch ${manifestUrl.href} failed: HTTP ${res.status}`);
  let manifest: HumanoidVolumeManifest;
  try {
    manifest = validateHumanoidVolumeManifest(await res.json());
  } catch (err) {
    throw err instanceof Error && err.message.startsWith('humanoid volume:')
      ? err
      : new Error(`humanoid volume: ${manifestUrl.href} is not valid JSON`);
  }

  // Byte order: an r16f-le buffer is only verbatim-viewable on a LE host.
  // Rejecting beats silently byte-swapping every distance (the same hard
  // guard the hand loader keeps).
  if (!HOST_IS_LITTLE_ENDIAN) {
    fail('host is big-endian; r16f-le bytes would be byte-swapped by Uint16Array');
  }

  // Everything is fetched and verified BEFORE any texture allocation.
  const distanceBytes = await fetchParts(manifestUrl, manifest.distance);
  const colorBytes = await fetchParts(manifestUrl, manifest.color);
  const coarse = await fetchCoarse(manifestUrl, manifest);

  const [nx, ny, nz] = manifest.atlasDimensions;
  const distanceTexture = createR16fTexture(new Uint16Array(distanceBytes), [nx, ny, nz]);
  const colorTexture = createRgba8Texture(new Uint8Array(colorBytes), [nx, ny, nz]);
  const boneIndex = new Map(manifest.bones.map((b, i) => [b.bone, i]));

  let disposed = false;
  return {
    manifest,
    distanceTexture,
    colorTexture,
    coarse,
    boneIndex,
    dispose() {
      if (!disposed) {
        disposed = true;
        distanceTexture.dispose();
        colorTexture.dispose();
        coarse.dispose();
      }
    },
  };
}
