// src/lab/sdf-zombie/webgpu/hand-volume-clip.ts
//
// X1.27 task C1 — the six-frame grip clip's runtime half: a STRICT version-2
// manifest validator (mirroring the baker's rejections exactly, so the file
// the bake wrote and the file the runtime accepts can never silently drift),
// the JSON+binary loader, and the normalized adjacent-frame lookup
// (gripFrameSample) the lab drives each frame.
//
// WHY SO STRICT. Same silent-failure modes as v1, plus clip-specific ones: a
// wrong atlasDepth samples across frame boundaries (two hands ghosted into
// one field), a wrong frameDepth shifts every slab, and a non-unit
// modelRotationLocal mis-seats the held dynamite. The manifest additionally
// carries the prop contract hash-bound to the exact derived GLB the poses
// were authored against — the runtime uses it as ONE orientation source (the
// quaternion), with axisLocal kept as an integrity CHECK, not a second way
// to orient the prop.
//
// The binary/prop paths are resolved RELATIVE to the manifest's own URL, so
// a clip manifest can live anywhere its atlas and GLB live beside it.
//
// LICENSING. Same derived-asset status as v1 (DavidFischer CC-BY-4.0 hand,
// posed against the derived DJMaesen CC-BY-4.0 dynamite bundle); the
// attribution string is validated presence, never optional.

import * as THREE from 'three/webgpu';
import { createR16fTexture, sha256Hex, HOST_IS_LITTLE_ENDIAN } from './hand-volume';

/** The only clip manifest version this runtime understands. */
export const HAND_CLIP_VERSION = 2;

/** The six authored frames, in bake/lookup order. */
export const GRIP_FRAME_LABELS = [
  'open', 'approach', 'first-contact', 'wrap', 'thumb-lock', 'firm-grip',
] as const;

export type GripFrameLabel = typeof GRIP_FRAME_LABELS[number];

/** Manifest version 2, as written by scripts/bake_hand_sdf_clip.py. */
export interface HandClipManifest {
  version: 2;
  kind: 'hand-sdf-clip';
  /** Atlas file name, resolved RELATIVE to the manifest's own URL. */
  binary: string;
  encoding: 'r16f-le';
  order: 'x-fastest-y-z';
  axes: { x: 'thumbward'; y: 'distal'; z: 'dorsal' };
  /** PER-FRAME voxel counts; the atlas is nx*ny*nz*frameCount samples. */
  dimensions: [number, number, number];
  /** Physical texture dimensions [nx, ny, nz * frameCount]. */
  atlasDimensions: [number, number, number];
  /** nz — the depth of one frame's slab inside the atlas. */
  frameDepth: number;
  frameCount: 6;
  /** Ordered frames; keys run strictly 0..1 and address slabs by index. */
  frames: Array<{ label: GripFrameLabel; key: number }>;
  /** Authored timings, seconds (consumed by the Task-E grip controller). */
  timing: { closeSec: number; releaseSec: number; swingSec: number; releaseAtSec: number };
  /** Metric local-space AABB of ONE frame, metres (the grids are common). */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  voxelSize: [number, number, number];
  isoValue: 0;
  /** Exactly 2 * nx * ny * nz * frameCount. */
  byteLength: number;
  sha256: { binary: string; source: string };
  attribution: string;
  prop: DynamitePropContract;
}

/** The hash-bound derived-GLB contract from Task A, embedded verbatim. */
export interface DynamitePropContract {
  /** GLB file name, resolved relative to the manifest URL. */
  url: string;
  sha256: string;
  /** The authored grip seat in the hand volume's anatomical frame, metres. */
  gripLocal: [number, number, number];
  /** The bundle's long axis in the same frame, unit length. */
  axisLocal: [number, number, number];
  /** Signed +Y from the GLB origin to the grip anchor, metres. */
  modelGripOffsetM: number;
  /** (w, x, y, z) rotating model +Y onto axisLocal — the ONE orientation
   *  source; axisLocal is its integrity check, not a competitor. */
  modelRotationLocal: [number, number, number, number];
  contactRadiusM: number;
  contactBelowM: number;
  contactAboveM: number;
  fuseTipNode: 'FuseTip';
  flightPivotNode: 'FlightPivot';
}

/** A loaded, validated clip: manifest + the depth-packed 3D texture. */
export interface HandClipVolume {
  manifest: HandClipManifest;
  texture: THREE.Data3DTexture;
  /** Largest per-axis voxel pitch (hit epsilon / proxy padding derive from
   *  it, exactly as the static v1 volume). */
  maxVoxelPitch: number;
  /** Disposes the texture. Idempotent. */
  dispose(): void;
}

/** One adjacent-frame sample: mix(field[frame0], field[frame1], alpha). */
export interface GripFrameSample { frame0: number; frame1: number; alpha: number }

function fail(reason: string): never {
  throw new Error(`hand clip: ${reason}`);
}

const HEX64 = /^[0-9a-f]{64}$/;
const AXIS_TRIPLE = ['thumbward', 'distal', 'dorsal'] as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function vec3(v: unknown, label: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isFiniteNumber)) {
    fail(`${label} must be three finite numbers`);
  }
  return [v[0], v[1], v[2]] as [number, number, number];
}

/** Plain relative file name: no drive, no scheme, no traversal, no empties. */
function relativeName(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(`${label} missing`);
  if (v.includes('\\')) fail(`${label} ${v} must use forward slashes`);
  if (/^[A-Za-z]:/.test(v)) fail(`${label} ${v} has a drive prefix`);
  if (v.includes('://')) fail(`${label} ${v} has a URL scheme`);
  const parts = v.split('/');
  if (parts.some(p => p === '' || p === '.' || p === '..')) {
    fail(`${label} ${v} is not a plain relative path`);
  }
  return v;
}

/** Rotates v by the (w,x,y,z) quaternion (Hamilton product). */
function rotateByQuaternion(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  const [w, x, y, z] = q;
  return [
    (1 - 2 * (y * y + z * z)) * v[0]! + 2 * (x * y - w * z) * v[1]! + 2 * (x * z + w * y) * v[2]!,
    2 * (x * y + w * z) * v[0]! + (1 - 2 * (x * x + z * z)) * v[1]! + 2 * (y * z - w * x) * v[2]!,
    2 * (x * z - w * y) * v[0]! + 2 * (y * z + w * x) * v[1]! + (1 - 2 * (x * x + y * y)) * v[2]!,
  ];
}

/**
 * Validates an unknown v2 clip manifest, returning it typed. Mirrors the
 * baker's validate_manifest rejection for rejection — the bake contract is
 * re-asserted at load time rather than trusted.
 */
export function validateHandClipManifest(input: unknown): HandClipManifest {
  if (typeof input !== 'object' || input === null) fail('manifest must be an object');
  const m = input as Record<string, unknown>;

  if (m.version !== HAND_CLIP_VERSION) {
    fail(`unsupported manifest version ${String(m.version)} (expected ${HAND_CLIP_VERSION})`);
  }
  if (m.kind !== 'hand-sdf-clip') fail(`unsupported kind ${String(m.kind)}`);
  if (m.encoding !== 'r16f-le') fail(`unsupported encoding ${String(m.encoding)}`);
  if (m.order !== 'x-fastest-y-z') fail(`unsupported sample order ${String(m.order)}`);

  const axes = m.axes as Record<string, unknown> | undefined;
  if (typeof axes !== 'object' || axes === null ||
      (['x', 'y', 'z'] as const).some((k, i) => axes[k] !== AXIS_TRIPLE[i])) {
    fail('axes must be x=thumbward, y=distal, z=dorsal (the runtime warp ramp assumes it)');
  }

  const binary = relativeName(m.binary, 'binary');

  const dims = m.dimensions;
  if (!Array.isArray(dims) || dims.length !== 3 ||
      !dims.every(d => Number.isInteger(d) && d >= 2)) {
    fail('dimensions must be three integers >= 2');
  }
  const [nx, ny, nz] = dims as [number, number, number];

  const frameCount = m.frameCount;
  if (frameCount !== GRIP_FRAME_LABELS.length) {
    fail(`frameCount must be ${GRIP_FRAME_LABELS.length} (got ${String(frameCount)})`);
  }
  const atlas = m.atlasDimensions;
  if (!Array.isArray(atlas) || atlas.length !== 3 ||
      !atlas.every(d => Number.isInteger(d)) ||
      atlas[0] !== nx || atlas[1] !== ny || atlas[2] !== nz * frameCount) {
    fail(`atlasDimensions must be [nx, ny, nz*frameCount] = [${nx}, ${ny}, ${nz * 6}]`);
  }
  if (m.frameDepth !== nz) fail(`frameDepth must equal per-frame nz ${nz} (got ${String(m.frameDepth)})`);

  const frames = m.frames;
  if (!Array.isArray(frames) || frames.length !== frameCount) {
    fail(`frames must list exactly ${frameCount} entries`);
  }
  const labels = frames.map(f => (f as Record<string, unknown>)?.label);
  if (labels.some((l, i) => l !== GRIP_FRAME_LABELS[i])) {
    fail(`frame labels must be exactly ${GRIP_FRAME_LABELS.join(', ')} in order — duplicates and reordering both break slab addressing`);
  }
  const keys: number[] = [];
  for (const entry of frames) {
    const key = (entry as Record<string, unknown>)?.key;
    if (!isFiniteNumber(key)) fail(`frame key ${String(key)} must be a finite number`);
    keys.push(key);
  }
  for (let i = 1; i < keys.length; i++) {
    if (!(keys[i]! > keys[i - 1]!)) fail('frame keys must be strictly increasing');
  }
  if (keys[0]! !== 0 || keys[keys.length - 1]! !== 1) {
    fail('frame keys must run from 0 to 1');
  }

  const timing = m.timing as Record<string, unknown> | undefined;
  if (typeof timing !== 'object' || timing === null) fail('timing missing');
  for (const k of ['closeSec', 'releaseSec', 'swingSec', 'releaseAtSec'] as const) {
    if (!isFiniteNumber(timing[k]) || timing[k]! <= 0) {
      fail(`timing.${k} must be > 0`);
    }
  }
  if (!(timing.releaseAtSec! < timing.swingSec!)) {
    fail('timing.releaseAtSec must fall inside the swing');
  }

  const boundsMin = vec3(m.boundsMin, 'boundsMin');
  const boundsMax = vec3(m.boundsMax, 'boundsMax');
  for (let i = 0; i < 3; i++) {
    if (!(boundsMin[i]! < boundsMax[i]!)) {
      fail(`boundsMin[${i}] must be strictly below boundsMax[${i}]`);
    }
  }
  const voxelSize = vec3(m.voxelSize, 'voxelSize');
  const dimsArr = [nx, ny, nz];
  for (let i = 0; i < 3; i++) {
    const pitch = voxelSize[i]!;
    if (!(pitch > 0)) fail(`voxelSize[${i}] must be positive`);
    const extent = (boundsMax[i]! - boundsMin[i]!) / (dimsArr[i]! - 1);
    if (Math.abs(pitch - extent) > Math.max(1e-9, pitch * 1e-3)) {
      fail(`voxelSize[${i}] is inconsistent with bounds/dimensions`);
    }
  }

  if (m.isoValue !== 0) fail(`isoValue must be 0 (got ${String(m.isoValue)})`);

  const byteLength = m.byteLength;
  if (byteLength !== 2 * nx * ny * nz * frameCount) {
    fail(`byteLength must be exactly 2*${nx}*${ny}*${nz}*${frameCount} = ${2 * nx * ny * nz * frameCount}`);
  }

  const sha = m.sha256 as Record<string, unknown> | undefined;
  if (typeof sha !== 'object' || sha === null ||
      typeof sha.binary !== 'string' || !HEX64.test(sha.binary) ||
      typeof sha.source !== 'string' || !HEX64.test(sha.source)) {
    fail('sha256.binary and sha256.source must be 64-char lowercase hex digests');
  }

  if (typeof m.attribution !== 'string' || !m.attribution.includes('CC-BY')) {
    fail('attribution must name the CC-BY licence (DavidFischer source model)');
  }

  const propIn = m.prop as Record<string, unknown> | undefined;
  if (typeof propIn !== 'object' || propIn === null) fail('prop contract missing');
  const url = relativeName(propIn.url, 'prop.url');
  if (typeof propIn.sha256 !== 'string' || !HEX64.test(propIn.sha256)) {
    fail('prop.sha256 must be a 64-char lowercase hex digest');
  }
  const gripLocal = vec3(propIn.gripLocal, 'prop.gripLocal');
  const axisLocal = vec3(propIn.axisLocal, 'prop.axisLocal');
  const axisLen = Math.hypot(axisLocal[0]!, axisLocal[1]!, axisLocal[2]!);
  if (Math.abs(axisLen - 1) > 1e-6) fail(`prop.axisLocal must be unit length (got ${axisLen})`);
  const quatIn = propIn.modelRotationLocal;
  if (!Array.isArray(quatIn) || quatIn.length !== 4 || !quatIn.every(isFiniteNumber)) {
    fail('prop.modelRotationLocal must be four finite numbers (w, x, y, z)');
  }
  const modelRotationLocal = quatIn as [number, number, number, number];
  const quatLen = Math.hypot(...modelRotationLocal);
  if (Math.abs(quatLen - 1) > 1e-6) {
    fail(`prop.modelRotationLocal must be unit length (got ${quatLen})`);
  }
  // Integrity check, not a second orientation source: the quaternion must
  // rotate model +Y onto the normalized axisLocal. Two competing orientation
  // fields would let a bad bake mis-seat the prop two ways at once.
  const modelY = rotateByQuaternion(modelRotationLocal, [0, 1, 0]);
  const axisErr = Math.hypot(
    modelY[0]! - axisLocal[0]!, modelY[1]! - axisLocal[1]!, modelY[2]! - axisLocal[2]!);
  if (axisErr > 1e-6) {
    fail(`prop.modelRotationLocal does not rotate model +Y onto axisLocal (error ${axisErr})`);
  }
  for (const k of ['modelGripOffsetM', 'contactRadiusM', 'contactBelowM', 'contactAboveM'] as const) {
    if (!isFiniteNumber(propIn[k])) fail(`prop.${k} must be a finite number`);
  }
  if (propIn.fuseTipNode !== 'FuseTip') fail(`prop.fuseTipNode must be 'FuseTip'`);
  if (propIn.flightPivotNode !== 'FlightPivot') fail(`prop.flightPivotNode must be 'FlightPivot'`);

  return {
    version: 2,
    kind: 'hand-sdf-clip',
    binary,
    encoding: 'r16f-le',
    order: 'x-fastest-y-z',
    axes: { x: 'thumbward', y: 'distal', z: 'dorsal' },
    dimensions: [nx, ny, nz],
    atlasDimensions: [atlas[0] as number, atlas[1] as number, atlas[2] as number],
    frameDepth: nz,
    frameCount,
    frames: frames.map((f, i) => ({
      label: GRIP_FRAME_LABELS[i]!,
      key: keys[i]!,
    })),
    timing: {
      closeSec: timing.closeSec as number,
      releaseSec: timing.releaseSec as number,
      swingSec: timing.swingSec as number,
      releaseAtSec: timing.releaseAtSec as number,
    },
    boundsMin,
    boundsMax,
    voxelSize,
    isoValue: 0,
    byteLength,
    sha256: { binary: sha.binary as string, source: sha.source as string },
    attribution: m.attribution as string,
    prop: {
      url,
      sha256: propIn.sha256 as string,
      gripLocal,
      axisLocal,
      modelGripOffsetM: propIn.modelGripOffsetM as number,
      modelRotationLocal,
      contactRadiusM: propIn.contactRadiusM as number,
      contactBelowM: propIn.contactBelowM as number,
      contactAboveM: propIn.contactAboveM as number,
      fuseTipNode: 'FuseTip',
      flightPivotNode: 'FlightPivot',
    },
  };
}

/**
 * Maps a normalized grip progress [0,1] onto ONE adjacent frame pair.
 *
 * Endpoints collapse onto the boundary frame with alpha 0 (never a phantom
 * frame 6): sample(0) = {0,0,0}, sample(1) = {5,5,0}. Between keys, grip
 * maps linearly onto [key_i, key_i+1] and alpha is the segment fraction —
 * with the baked keys (0, .2, .4, .6, .8, 1) every segment is exactly 0.2
 * wide, so 0.3 is the exact midpoint of frames 1 and 2.
 */
export function gripFrameSample(manifest: HandClipManifest, grip01: number): GripFrameSample {
  const keys = manifest.frames.map(f => f.key);
  const last = manifest.frames.length - 1;
  if (!Number.isFinite(grip01)) return { frame0: 0, frame1: 0, alpha: 0 };
  if (grip01 <= keys[0]!) return { frame0: 0, frame1: 0, alpha: 0 };
  if (grip01 >= keys[last]!) return { frame0: last, frame1: last, alpha: 0 };
  let i = 0;
  while (i < last - 1 && grip01 >= keys[i + 1]!) i++;
  const k0 = keys[i]!, k1 = keys[i + 1]!;
  const alpha = k1 > k0 ? (grip01 - k0) / (k1 - k0) : 0;
  return { frame0: i, frame1: i + 1, alpha };
}

/**
 * Fetches and validates the v2 manifest, then its atlas (resolved RELATIVE
 * to the manifest URL), checks byte order/length/integrity, and builds the
 * depth-packed Data3DTexture at the ATLAS dimensions. Nothing is allocated
 * before validation succeeds and no partially initialized object can escape:
 * every failure throws before the single return.
 */
export async function loadHandClip(url: string): Promise<HandClipVolume> {
  const manifestUrl = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
  const res = await fetch(manifestUrl);
  if (!res.ok) fail(`manifest fetch ${manifestUrl.href} failed: HTTP ${res.status}`);
  let manifest: HandClipManifest;
  try {
    manifest = validateHandClipManifest(await res.json());
  } catch (err) {
    throw err instanceof Error && err.message.startsWith('hand clip:')
      ? err
      : new Error(`hand clip: ${manifestUrl.href} is not valid JSON`);
  }

  if (!HOST_IS_LITTLE_ENDIAN) {
    fail('host is big-endian; r16f-le bytes would be byte-swapped by Uint16Array');
  }

  const binUrl = new URL(manifest.binary, manifestUrl);
  const binRes = await fetch(binUrl);
  if (!binRes.ok) fail(`binary fetch ${binUrl.href} failed: HTTP ${binRes.status}`);
  const buffer = await binRes.arrayBuffer();
  if (buffer.byteLength !== manifest.byteLength) {
    fail(`binary byte length ${buffer.byteLength} disagrees with manifest byteLength ${manifest.byteLength}`);
  }

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await sha256Hex(buffer);
    if (digest !== manifest.sha256.binary) {
      fail(`binary sha-256 mismatch: manifest says ${manifest.sha256.binary}, payload is ${digest}`);
    }
  }

  const texture = createR16fTexture(
    new Uint16Array(buffer), manifest.atlasDimensions);
  let disposed = false;
  return {
    manifest,
    texture,
    maxVoxelPitch: Math.max(...manifest.voxelSize),
    dispose() {
      if (!disposed) { disposed = true; texture.dispose(); }
    },
  };
}
