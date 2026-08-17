// src/lab/sdf-zombie/webgpu/hand-volume.ts
//
// X1.26 task B1 — the baked hand volume's runtime half: strict manifest
// validation, JSON+binary fetch, and the Data3DTexture the shared marcher
// samples (march.wgsl.ts's sampleHandVolume).
//
// WHY SO STRICT. Every field here has a silent-failure mode that produces a
// WRONG HAND rather than an error: a byte-swapped half is a different
// distance, a swapped axis order mirrors the thumb to the little-finger side,
// and a shifted lattice moves the whole field half a voxel. The validator
// therefore re-asserts the bake contract at load time rather than trusting
// the file, and loadHandVolume adds byte-order and integrity checks on top.
//
// LICENSING. The .r16f is a DERIVED asset of the CC-BY-4.0 DavidFischer
// "First Person hands rigged" model and ships with the attribution recorded
// in the manifest and in ATTRIBUTIONS.md. The attribution is part of the
// validated manifest — a hand volume with no attribution string is rejected,
// so the licence text travels with every copy of the data that can load.

import * as THREE from 'three/webgpu';

/** The only manifest version this runtime understands. */
export const HAND_VOLUME_VERSION = 1;

/**
 * The baker's anatomical frame, validated verbatim — the runtime warp ramp
 * (`smoothstep(0.15, 0.9, uv.y)`) assumes y is the distal axis, so a manifest
 * that swapped axis names would warp the hand sideways.
 */
export const HAND_VOLUME_AXES = { x: 'thumbward', y: 'distal', z: 'dorsal' } as const;

/** Manifest version 1, as written by scripts/bake_hand_sdf.py. */
export interface HandVolumeManifest {
  version: 1;
  /** Binary file name, resolved RELATIVE to the manifest's own URL. */
  binary: string;
  encoding: 'r16f-le';
  order: 'x-fastest-y-z';
  axes: { x: 'thumbward'; y: 'distal'; z: 'dorsal' };
  /** Voxel counts per axis. The lattice is ENDPOINT-INCLUSIVE: sample i of n
   *  sits exactly on `boundsMin + i * voxelSize`, so `uv * (dims - 1)` maps
   *  [0,1] onto the stored samples. */
  dimensions: [number, number, number];
  /** Metric local-space AABB, metres. */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  /** Measured per-axis voxel pitch, metres (positive). */
  voxelSize: [number, number, number];
  isoValue: 0;
  /** Exactly 2 * nx * ny * nz — R16F is two bytes a sample. */
  byteLength: number;
  sha256: { binary: string; source: string };
  /** The CC-BY-4.0 attribution the derived volume must carry. */
  attribution: string;
}

/** A loaded, validated volume: manifest + GPU-ready texture. */
export interface HandVolume {
  manifest: HandVolumeManifest;
  texture: THREE.Data3DTexture;
  /** Largest per-axis voxel pitch. The volume mode's hit epsilon (at least
   *  half this) and proxy padding derive from it. */
  maxVoxelPitch: number;
  /** Disposes the texture. Idempotent. */
  dispose(): void;
}

/**
 * R16F-LE is only byte-addressable verbatim on a little-endian host. On a
 * big-endian host a Uint16Array view of the buffer silently byte-swaps every
 * half — no error, just wrong distances everywhere — so the loader refuses
 * rather than guessing.
 */
export const HOST_IS_LITTLE_ENDIAN: boolean =
  new Uint8Array(new Uint32Array([0x0a0b0c0d]).buffer)[0] === 0x0d;

function fail(reason: string): never {
  throw new Error(`hand volume: ${reason}`);
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

/**
 * Validates an unknown manifest against the bake contract, returning it typed.
 *
 * Throws (rather than returning a result) because every caller treats an
 * invalid volume as a load failure: the lab falls back to primitive mode.
 */
export function validateHandVolumeManifest(input: unknown): HandVolumeManifest {
  if (typeof input !== 'object' || input === null) fail('manifest must be an object');
  const m = input as Record<string, unknown>;

  if (m.version !== HAND_VOLUME_VERSION) {
    fail(`unsupported manifest version ${String(m.version)} (expected ${HAND_VOLUME_VERSION})`);
  }
  if (m.encoding !== 'r16f-le') fail(`unsupported encoding ${String(m.encoding)}`);
  if (m.order !== 'x-fastest-y-z') fail(`unsupported sample order ${String(m.order)}`);

  // Axis names must match the anatomical frame exactly — see HAND_VOLUME_AXES.
  const axes = m.axes as Record<string, unknown> | undefined;
  if (typeof axes !== 'object' || axes === null ||
      (['x', 'y', 'z'] as const).some((k, i) => axes[k] !== AXIS_TRIPLE[i])) {
    fail('axes must be x=thumbward, y=distal, z=dorsal (the runtime warp ramp assumes it)');
  }

  if (typeof m.binary !== 'string' || m.binary.length === 0 ||
      m.binary.startsWith('/') || m.binary.includes('..')) {
    fail('binary must be a relative file name next to the manifest');
  }

  // Dimensions: positive integers, and >= 2 — the endpoint-inclusive lattice
  // needs both endpoints, and voxelSize consistency (below) divides by n - 1.
  const dims = m.dimensions;
  if (!Array.isArray(dims) || dims.length !== 3 ||
      !dims.every(d => Number.isInteger(d) && d >= 2)) {
    fail('dimensions must be three integers >= 2');
  }
  const [nx, ny, nz] = dims as [number, number, number];

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
    // The baker rounds the measured pitch to f64; anything beyond 0.1% off
    // means bounds, dimensions and pitch disagree — a shifted lattice.
    if (Math.abs(pitch - extent) > Math.max(1e-9, pitch * 1e-3)) {
      fail(`voxelSize[${i}] is inconsistent with bounds/dimensions`);
    }
  }

  if (m.isoValue !== 0) fail(`isoValue must be 0 (got ${String(m.isoValue)})`);

  const byteLength = m.byteLength;
  if (byteLength !== 2 * nx * ny * nz) {
    fail(`byteLength must be exactly 2*${nx}*${ny}*${nz} = ${2 * nx * ny * nz}`);
  }

  const sha = m.sha256 as Record<string, unknown> | undefined;
  if (typeof sha !== 'object' || sha === null ||
      typeof sha.binary !== 'string' || !HEX64.test(sha.binary) ||
      typeof sha.source !== 'string' || !HEX64.test(sha.source)) {
    fail('sha256.binary and sha256.source must be 64-char lowercase hex digests');
  }

  if (typeof m.attribution !== 'string' || !m.attribution.includes('CC-BY')) {
    // Licensing guardrail: the derived volume ships ONLY with its attribution.
    fail('attribution must name the CC-BY licence (DavidFischer source model)');
  }

  return {
    version: 1,
    binary: m.binary,
    encoding: 'r16f-le',
    order: 'x-fastest-y-z',
    axes: { x: 'thumbward', y: 'distal', z: 'dorsal' },
    dimensions: [nx, ny, nz],
    boundsMin,
    boundsMax,
    voxelSize,
    isoValue: 0,
    byteLength,
    sha256: { binary: sha.binary as string, source: sha.source as string },
    attribution: m.attribution as string,
  };
}

/**
 * The one texture construction for hand volumes (X1.26, shared with the
 * X1.27 clip loader): raw half bits, nearest filtering (the shader does its
 * own trilinear from eight textureLoads — a sampler would buy nothing but a
 * half-voxel shift; see march.wgsl.ts), clamp-to-edge in all three axes, no
 * mips. `dimensions` may be a single frame OR a depth-packed atlas (the
 * clip passes [nx, ny, nz*frameCount]) — the shader derives its slab-local
 * indices from textureDimensions and volumeClip.w, never from a second
 * uniform.
 */
export function createR16fTexture(
  bits: Uint16Array, dimensions: readonly [number, number, number],
): THREE.Data3DTexture {
  const texture = new THREE.Data3DTexture(bits, dimensions[0], dimensions[1], dimensions[2]);
  texture.format = THREE.RedFormat;
  texture.type = THREE.HalfFloatType;
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

/** SHA-256 of an ArrayBuffer as lowercase hex (the loaders' integrity
 *  check). Exported (X1.27 task C1) so the clip loader and the Task-D GLB
 *  wrapper verify through ONE implementation. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(
    await crypto.subtle.digest('SHA-256', buffer),
  )).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Half-float bits of +1.0 — the fallback's single "empty space" sample. */
const HALF_POSITIVE_ONE = 0x3c00;

/**
 * The 1³ stand-in every NON-volume view binds. It stores one positive
 * distance (a metre of empty space), so even a view that accidentally sampled
 * it reads empty rather than solid; the enable flag keeps that from happening
 * at all. Shared by body/chunk/hands materials — one instance can back them
 * all, and its owner (the lab renderer) disposes it exactly once.
 */
export function createFallbackHandVolumeTexture(): THREE.Data3DTexture {
  return createR16fTexture(new Uint16Array([HALF_POSITIVE_ONE]), [1, 1, 1]);
}

/**
 * Fetches and validates the manifest, then its binary (resolved RELATIVE to
 * the manifest URL), checks byte order/length/integrity, and builds the
 * Data3DTexture. Validation happens BEFORE any texture allocation.
 */
export async function loadHandVolume(url: string): Promise<HandVolume> {
  const manifestUrl = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
  const res = await fetch(manifestUrl);
  if (!res.ok) fail(`manifest fetch ${manifestUrl.href} failed: HTTP ${res.status}`);
  let manifest: HandVolumeManifest;
  try {
    manifest = validateHandVolumeManifest(await res.json());
  } catch (err) {
    throw err instanceof Error && err.message.startsWith('hand volume:')
      ? err
      : new Error(`hand volume: ${manifestUrl.href} is not valid JSON`);
  }

  // Byte order: an r16f-le buffer is only verbatim-viewable on a LE host.
  // Rejecting beats silently byte-swapping every distance.
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

  // Integrity: verify the payload against the manifest's digest when the
  // platform exposes WebCrypto (every target does; the guard is for exotic
  // embedders where loading should still work rather than hard-fail).
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await sha256Hex(buffer);
    if (digest !== manifest.sha256.binary) {
      fail(`binary sha-256 mismatch: manifest says ${manifest.sha256.binary}, payload is ${digest}`);
    }
  }

  const [nx, ny, nz] = manifest.dimensions;
  const texture = createR16fTexture(new Uint16Array(buffer), [nx, ny, nz]);
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
