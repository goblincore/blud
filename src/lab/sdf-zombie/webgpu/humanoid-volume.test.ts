// src/lab/sdf-zombie/webgpu/humanoid-volume.test.ts
//
// Task 3 — strict humanoid atlas loader. Modeled on hand-volume.test.ts:
// the "valid" case is the REAL checked-in Task 2 bake read from disk (never
// a fixture hand-written next to its own validator), and every rejection
// mutates exactly one field of that real manifest. The bake contract is
// re-asserted at load time because every silent failure mode here produces a
// WRONG ZOMBIE rather than an error: a byte-swapped half is a different
// distance, a swapped part order mirrors the thumb, a drifted brick offset
// samples the neighbour's flesh, and a missing occupiedBounds hands shoulder
// hits to the spine's broad phase.

import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:crypto available in vitest via happy-dom/node
import { createHash } from 'node:crypto';
import * as THREE from 'three/webgpu';
import {
  validateHumanoidVolumeManifest, loadHumanoidVolume, createRgba8Texture,
  HOST_IS_LITTLE_ENDIAN,
  type HumanoidVolumeManifest, type HumanoidCoarseBricks,
} from './humanoid-volume';

const MANIFEST_URL = 'public/assets/lab/humanoid-sdf/zombie-humanoid.json';
const DISTANCE_URL = 'public/assets/lab/humanoid-sdf/zombie-distance-000.r16f';
const COLOR_URL = 'public/assets/lab/humanoid-sdf/zombie-color-000.rgba8';
const COARSE_URL = 'public/assets/lab/humanoid-sdf/zombie-coarse.f32';

const checkedIn = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
const DISTANCE_BYTES = readFileSync(DISTANCE_URL);
const COLOR_BYTES = readFileSync(COLOR_URL);
const COARSE_BYTES = readFileSync(COARSE_URL);

function sha256HexSync(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Deep clone of the real checked-in manifest, for one-field mutations. */
function cloneCheckedIn(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(checkedIn));
}

/** Copies a byte array into a fresh Response body (each serve must be
 *  independent — Response consumes its body and Buffer.slice keeps the
 *  underlying pool alive). */
function bytesResponse(bytes: Uint8Array): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy.buffer);
}

/** Serves the real assets through a stubbed fetch; `files` overrides the
 *  payload served for a file name, `manifest` overrides the JSON. */
function serve(
  files: Record<string, Uint8Array> = {},
  manifest?: unknown,
): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const href = String(url);
    calls.push(href);
    const name = href.split('/').pop()!;
    if (files[name] !== undefined) return bytesResponse(files[name]!);
    if (href.endsWith('zombie-humanoid.json')) {
      return new Response(JSON.stringify(manifest ?? checkedIn));
    }
    if (name === 'zombie-distance-000.r16f') return bytesResponse(DISTANCE_BYTES);
    if (name === 'zombie-color-000.rgba8') return bytesResponse(COLOR_BYTES);
    if (name === 'zombie-coarse.f32') return bytesResponse(COARSE_BYTES);
    return new Response('not found', { status: 404 });
  });
  return calls;
}

describe('validateHumanoidVolumeManifest — the checked-in bake', () => {
  it('accepts the real manifest and pins its literal contract', () => {
    const m = validateHumanoidVolumeManifest(checkedIn);
    expect(m.version).toBe(1);
    expect(m.kind).toBe('humanoid-bone-sdf');
    expect(m.order).toBe('x-fastest-y-z');
    expect(m.pageCount).toBe(1);
    // The skeleton has 24 joints; head_end and headfront fold into Head, so
    // the retained bone array is 22 and MUST stay below boneCount (the state
    // of the chain pins this: index by ARRAY POSITION, not joint index).
    expect(m.boneCount).toBe(24);
    expect(m.bones).toHaveLength(22);
    expect(m.bones.map(b => b.bone)).toEqual(expect.arrayContaining(
      ['RightArm', 'RightForeArm', 'RightHand']));
    expect(m.source.sha256)
      .toBe('2b23530a64466ca650ead74e49feaf54b6463c254ecccc9b3d56ba993a33cd28');
    expect(m.source.byteLength).toBe(10234820);
    expect(m.source.originalFilename)
      .toBe('Meshy_AI_zombie_biped_Character_output.glb');
    expect(m.atlasDimensions).toEqual([128, 128, 512]);
    expect(m.distance.encoding).toBe('r16f-le');
    expect(m.distance.combinedByteLength).toBe(2 * 128 * 128 * 512);
    expect(m.color.encoding).toBe('rgba8');
    expect(m.color.combinedByteLength).toBe(4 * 128 * 128 * 512);
    expect(m.coarse.encoding).toBe('f32-le');
    expect(m.coarse.combinedByteLength).toBe(161216);
    expect(m.bake.limbPitchM).toBeLessThanOrEqual(0.006);
    expect(m.bake.detailPitchM).toBeLessThanOrEqual(0.003);
    expect(m.bake.jointOverlapM).toBeCloseTo(0.03, 9);
    expect(m.bake.atlasPadding).toBe(2);
    expect(m.bake.bandWidth).toBe(16);
  });

  it('keeps the exact right-arm mapping, sever constants and unit cut plane', () => {
    const m = validateHumanoidVolumeManifest(checkedIn);
    expect(m.rightArm.upperArm).toBe('RightArm');
    expect(m.rightArm.forearm).toBe('RightForeArm');
    expect(m.rightArm.hand).toBe('RightHand');
    expect(m.rightArm.cutSeed).toBe(12648430);
    expect(m.rightArm.irregularityM).toBe(0.004);
    expect(m.rightArm.rimWidthM).toBe(0.008);
    const [nx, ny, nz] = m.rightArm.cutPlaneLocal;
    expect(Math.hypot(nx!, ny!, nz!)).toBeCloseTo(1, 6);
  });

  it('pins the elbow joint: 30 mm overlap, unit axis, finite center', () => {
    const m = validateHumanoidVolumeManifest(checkedIn);
    const elbow = m.joints.find(
      j => j.parent === 'RightArm' && j.child === 'RightForeArm');
    expect(elbow).toBeDefined();
    expect(elbow!.overlapM).toBeCloseTo(0.03, 9);
    expect(Math.hypot(...elbow!.axisModel)).toBeCloseTo(1, 9);
    expect([...elbow!.centerModel].every(Number.isFinite)).toBe(true);
  });

  it('partitions every retained bone into exactly one cluster, right arm intact', () => {
    const m = validateHumanoidVolumeManifest(checkedIn);
    const primaryCount = new Map<string, number>();
    for (const c of m.clusters) {
      for (const b of c.primaryBones) primaryCount.set(b, (primaryCount.get(b) ?? 0) + 1);
    }
    for (const b of m.bones) expect(primaryCount.get(b.bone)).toBe(1);
    const rightArm = m.clusters.find(c => c.name === 'right-arm');
    expect(rightArm).toBeDefined();
    expect(rightArm!.sampleBones).toEqual(
      expect.arrayContaining(['RightArm', 'RightForeArm', 'RightHand']));
    expect(rightArm!.sampleBones.length).toBeLessThanOrEqual(4);
  });

  it('agrees with the checked-in binaries on disk: byte length AND sha-256', () => {
    const m = validateHumanoidVolumeManifest(checkedIn);
    expect(DISTANCE_BYTES.byteLength).toBe(m.distance.combinedByteLength);
    expect(sha256HexSync(DISTANCE_BYTES)).toBe(m.distance.combinedSha256);
    expect(COLOR_BYTES.byteLength).toBe(m.color.combinedByteLength);
    expect(sha256HexSync(COLOR_BYTES)).toBe(m.color.combinedSha256);
    expect(COARSE_BYTES.byteLength).toBe(m.coarse.combinedByteLength);
    expect(sha256HexSync(COARSE_BYTES)).toBe(m.coarse.combinedSha256);
  });
});

describe('validateHumanoidVolumeManifest — rejections', () => {
  // Every mutation is a way the bake contract could silently break at load:
  // none of these produce a shader error — they produce a WRONG ZOMBIE.
  const rejects = (label: string, mutate: (m: Record<string, unknown>) => void) =>
    it(`rejects ${label}`, () => {
      const m = cloneCheckedIn();
      mutate(m);
      expect(() => validateHumanoidVolumeManifest(m)).toThrow(/humanoid volume/i);
    });

  it('rejects a non-object', () => {
    expect(() => validateHumanoidVolumeManifest('nope')).toThrow(/humanoid volume/i);
    expect(() => validateHumanoidVolumeManifest(null)).toThrow(/humanoid volume/i);
  });

  rejects('a wrong version', m => { m.version = 2; });
  rejects('a wrong kind', m => { m.kind = 'hand-bone-sdf'; });
  rejects('a wrong page count', m => { m.pageCount = 2; });
  rejects('a wrong sample order', m => { m.order = 'y-fastest-x-z'; });
  rejects('a boneCount that no longer exceeds the retained bones', m => {
    m.boneCount = 22; // the head fold must keep bones.length strictly below it
  });
  rejects('a wrong distance encoding', m => {
    (m.distance as Record<string, unknown>).encoding = 'r16f-be';
  });
  rejects('a wrong color encoding', m => {
    (m.color as Record<string, unknown>).encoding = 'rgba16f';
  });
  rejects('a traversal part path', m => {
    ((m.distance as Record<string, unknown>).parts as Record<string, unknown>[])[0]!.url =
      '../zombie-distance-000.r16f';
  });
  rejects('an absolute part path', m => {
    ((m.distance as Record<string, unknown>).parts as Record<string, unknown>[])[0]!.url =
      '/assets/lab/humanoid-sdf/zombie-distance-000.r16f';
  });
  rejects('a scheme-qualified part path', m => {
    ((m.color as Record<string, unknown>).parts as Record<string, unknown>[])[0]!.url =
      'https://example.com/zombie-color-000.rgba8';
  });
  rejects('a duplicate bone name', m => {
    (m.bones as Record<string, unknown>[]).push(
      { ...(m.bones as Record<string, unknown>[])[0] });
  });
  rejects('a missing bone', m => {
    (m.bones as Record<string, unknown>[]).splice(1, 1);
  });
  rejects('a self-parenting cycle', m => {
    (m.bones as Record<string, unknown>[])[0]!.parentIndex = 0;
  });
  rejects('a parentIndex that does not precede the joint index', m => {
    (m.bones as Record<string, unknown>[])[1]!.parentIndex = 2;
  });
  rejects('a non-finite bind matrix', m => {
    ((m.bones as Record<string, unknown>[])[0]!.bindToModel as number[])[1] = NaN;
  });
  rejects('bind matrices that are not exact inverses', m => {
    ((m.bones as Record<string, unknown>[])[0]!.bindToModel as number[])[0]! += 0.5;
  });
  rejects('a non-unit joint axis', m => {
    (m.joints as Record<string, unknown>[])[17]!.axisModel = [1.5, 0, 0];
  });
  rejects('a drifted bake joint overlap', m => {
    ((m.bake as Record<string, unknown>))!.jointOverlapM = 0.04;
  });
  rejects('a joint whose overlap is not the 30 mm band', m => {
    (m.joints as Record<string, unknown>[])[17]!.overlapM = 0.025;
  });
  rejects('an out-of-atlas brick', m => {
    (m.bones as Record<string, unknown>[])[19]!.offset = [124, 2, 218];
  });
  rejects('overlapping atlas bricks', m => {
    (m.bones as Record<string, unknown>[])[1]!.offset = [2, 2, 134];
  });
  rejects('a limb brick pitched beyond the 6 mm cap', m => {
    ((m.bones as Record<string, unknown>[])[17]!.voxelSize as number[])[0] = 0.007;
  });
  rejects('a detail brick pitched beyond the 3 mm cap', m => {
    ((m.bones as Record<string, unknown>[])[19]!.voxelSize as number[])[0] = 0.004;
  });
  rejects('a drifted limb pitch cap', m => {
    ((m.bake as Record<string, unknown>))!.limbPitchM = 0.007;
  });
  rejects('a drifted detail pitch cap', m => {
    ((m.bake as Record<string, unknown>))!.detailPitchM = 0.004;
  });
  rejects('a voxel size inconsistent with bounds/dimensions', m => {
    ((m.bones as Record<string, unknown>[])[0]!.voxelSize as number[])[0] = 0.005;
  });
  rejects('a part whose byte length disagrees with the combined sum', m => {
    ((m.distance as Record<string, unknown>).parts as Array<{ byteLength: number }>)[0]!.byteLength += 1;
  });
  rejects('a combined byte length that disagrees with the part sum', m => {
    (m.distance as Record<string, unknown>).combinedByteLength = 16777217;
  });
  rejects('a combined byte length that disagrees with the atlas volume', m => {
    (m.color as Record<string, unknown>).combinedByteLength = 2 * 128 * 128 * 512;
  });
  rejects('a malformed part sha-256', m => {
    ((m.distance as Record<string, unknown>).parts as Record<string, unknown>[])[0]!.sha256 = 'xyz';
  });
  rejects('a malformed combined sha-256', m => {
    (m.color as Record<string, unknown>).combinedSha256 = 'not-a-hash';
  });
  rejects('a malformed source texture sha-256', m => {
    ((m.source as Record<string, unknown>)).textureSha256 = 'zzz';
  });
  rejects('a source sha-256 that drifted from the canonical owner asset', m => {
    ((m.source as Record<string, unknown>)).sha256 = 'a'.repeat(64);
  });
  rejects('sourceToRuntime/runtimeToSource that are not exact inverses', m => {
    (m.sourceToRuntime as number[])[0] = 0.5;
  });
  rejects('a cluster sampling more than four bones', m => {
    (m.clusters as Record<string, unknown>[])[5]!.sampleBones =
      ['neck', 'Head', 'Spine', 'Hips', 'Spine01'];
  });
  rejects('cluster primaries that no longer partition the bones exactly', m => {
    ((m.clusters as Record<string, unknown>[])[4]!.primaryBones as string[]).pop();
  });
  rejects('a missing right-arm cluster', m => {
    (m.clusters as Record<string, unknown>[]).splice(4, 1);
  });
  rejects('a drifted right-arm mapping', m => {
    ((m.rightArm as Record<string, unknown>))!.upperArm = 'LeftArm';
  });
  rejects('a drifted cut seed', m => {
    ((m.rightArm as Record<string, unknown>))!.cutSeed = 1;
  });
  rejects('a drifted cut irregularity', m => {
    ((m.rightArm as Record<string, unknown>))!.irregularityM = 0.01;
  });
  rejects('a drifted cut rim width', m => {
    ((m.rightArm as Record<string, unknown>))!.rimWidthM = 0.1;
  });
  rejects('a non-unit cut plane normal', m => {
    ((m.rightArm as Record<string, unknown>))!.cutPlaneLocal = [0.9, 0.778, 0.346, -0.085];
  });
  rejects('a non-finite cut plane', m => {
    ((m.rightArm as Record<string, unknown>))!.cutPlaneLocal =
      [NaN, 0.778, 0.346, -0.085];
  });
  rejects('a coarse bone whose dims exceed 16 per axis', m => {
    ((m.coarse as Record<string, unknown>).bones as Record<string, unknown>[])[0]!.dims =
      [17, 15, 16];
  });
  rejects('a coarse bone that overruns the pack', m => {
    ((m.coarse as Record<string, unknown>).bones as Record<string, unknown>[])[0]!.offset =
      161000;
  });
  rejects('a coarse combined byte length that disagrees with the bone sum', m => {
    (m.coarse as Record<string, unknown>).combinedByteLength = 161215;
  });
  rejects('a malformed coarse combined sha-256', m => {
    (m.coarse as Record<string, unknown>).combinedSha256 = 'zz';
  });
  rejects('a coarse bone count that breaks array-position indexing', m => {
    ((m.coarse as Record<string, unknown>).bones as Record<string, unknown>[]).push(
      { offset: 0, dims: [1, 1, 1], byteLength: 4, sha256: 'a'.repeat(64) });
  });
  rejects('a coarse bone sha-256 that is not hex', m => {
    ((m.coarse as Record<string, unknown>).bones as Record<string, unknown>[])[0]!.sha256 = 'nope';
  });

  it('rejects a bone MISSING occupiedBounds (the wound broad phase must never fall back to boundsMin/Max)', () => {
    const m = cloneCheckedIn();
    delete (m.bones as Record<string, unknown>[])[0]!.occupiedBoundsMin;
    expect(() => validateHumanoidVolumeManifest(m)).toThrow(/occupiedBounds/i);
    const m2 = cloneCheckedIn();
    delete (m2.bones as Record<string, unknown>[])[0]!.occupiedBoundsMax;
    expect(() => validateHumanoidVolumeManifest(m2)).toThrow(/occupiedBounds/i);
  });
});

describe('createRgba8Texture', () => {
  it('builds a nearest/clamp RGBA8 3D texture from raw bytes', () => {
    const bits = new Uint8Array(2 * 2 * 2 * 4).fill(255);
    const tex = createRgba8Texture(bits, [2, 2, 2]);
    expect(tex).toBeInstanceOf(THREE.Data3DTexture);
    expect(tex.image.width).toBe(2);
    expect(tex.image.height).toBe(2);
    expect(tex.image.depth).toBe(2);
    expect(tex.format).toBe(THREE.RGBAFormat);
    expect(tex.type).toBe(THREE.UnsignedByteType);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.unpackAlignment).toBe(1);
    expect(tex.image.data).toBe(bits); // used by reference, bits ride untouched
    tex.dispose();
  });
});

describe('loadHumanoidVolume', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ASSET_URL = '/assets/lab/humanoid-sdf/zombie-humanoid.json';

  it('fetches JSON first, then distance parts, color parts, then the coarse pack, all RELATIVE to the manifest URL', async () => {
    const calls = serve();
    const assets = await loadHumanoidVolume(ASSET_URL);
    // Resolved against the manifest URL (the happy-dom origin is
    // localhost:3000 — only the path is part of the contract).
    const path = (href: string) => new URL(href).pathname;
    expect(path(calls[0]!)).toBe('/assets/lab/humanoid-sdf/zombie-humanoid.json');
    expect(path(calls[1]!)).toBe('/assets/lab/humanoid-sdf/zombie-distance-000.r16f');
    expect(path(calls[2]!)).toBe('/assets/lab/humanoid-sdf/zombie-color-000.rgba8');
    expect(path(calls[3]!)).toBe('/assets/lab/humanoid-sdf/zombie-coarse.f32');
    assets.dispose();
  });

  it('concatenates ordered transport parts and verifies per-part + combined hashes (two-part distance)', async () => {
    const half = Math.floor(DISTANCE_BYTES.length / 2);
    const p0 = new Uint8Array(DISTANCE_BYTES.subarray(0, half));
    const p1 = new Uint8Array(DISTANCE_BYTES.subarray(half));
    const m = cloneCheckedIn();
    (m.distance as Record<string, unknown>).parts = [
      { url: 'zombie-distance-000.r16f', byteLength: p0.length, sha256: sha256HexSync(p0) },
      { url: 'zombie-distance-001.r16f', byteLength: p1.length, sha256: sha256HexSync(p1) },
    ];
    const calls = serve({
      'zombie-distance-000.r16f': p0,
      'zombie-distance-001.r16f': p1,
    }, m);
    const assets = await loadHumanoidVolume(ASSET_URL);
    // parts fetched in DECLARED order, concatenated back to the one logical atlas
    const path = (href: string) => new URL(href).pathname;
    expect(path(calls[1]!)).toBe('/assets/lab/humanoid-sdf/zombie-distance-000.r16f');
    expect(path(calls[2]!)).toBe('/assets/lab/humanoid-sdf/zombie-distance-001.r16f');
    expect((assets.distanceTexture.image.data as Uint16Array).length)
      .toBe(128 * 128 * 512);
    assets.dispose();
  });

  it('rejects a reordered transport part stream', async () => {
    // Declared order says part 0 is the first half, but the served bytes are
    // the SECOND half — the concatenation would silently mirror the field if
    // the per-part hash were not verified in declared order.
    const half = Math.floor(DISTANCE_BYTES.length / 2);
    const p0 = new Uint8Array(DISTANCE_BYTES.subarray(0, half));
    const p1 = new Uint8Array(DISTANCE_BYTES.subarray(half));
    const m = cloneCheckedIn();
    (m.distance as Record<string, unknown>).parts = [
      { url: 'zombie-distance-000.r16f', byteLength: p0.length, sha256: sha256HexSync(p0) },
      { url: 'zombie-distance-001.r16f', byteLength: p1.length, sha256: sha256HexSync(p1) },
    ];
    serve({
      'zombie-distance-000.r16f': p1, // swapped on disk
      'zombie-distance-001.r16f': p0,
    }, m);
    await expect(loadHumanoidVolume(ASSET_URL)).rejects.toThrow(/sha-256/i);
  });

  it('builds RedFormat/HalfFloatType distance and RGBAFormat/UnsignedByteType color textures at the atlas dimensions', async () => {
    serve();
    const assets = await loadHumanoidVolume(ASSET_URL);
    const dist = assets.distanceTexture;
    expect(dist).toBeInstanceOf(THREE.Data3DTexture);
    expect(dist.image.width).toBe(128);
    expect(dist.image.height).toBe(128);
    expect(dist.image.depth).toBe(512);
    expect(dist.format).toBe(THREE.RedFormat);
    expect(dist.type).toBe(THREE.HalfFloatType);
    expect(dist.magFilter).toBe(THREE.NearestFilter);
    expect(dist.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(dist.generateMipmaps).toBe(false);
    expect(dist.unpackAlignment).toBe(1);
    expect((dist.image.data as Uint16Array).length).toBe(128 * 128 * 512);
    const color = assets.colorTexture;
    expect(color.image.width).toBe(128);
    expect(color.image.height).toBe(128);
    expect(color.image.depth).toBe(512);
    expect(color.format).toBe(THREE.RGBAFormat);
    expect(color.type).toBe(THREE.UnsignedByteType);
    expect(color.magFilter).toBe(THREE.NearestFilter);
    expect(color.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(color.generateMipmaps).toBe(false);
    expect(color.unpackAlignment).toBe(1);
    expect((color.image.data as Uint8Array).length).toBe(128 * 128 * 512 * 4);
    assets.dispose();
  });

  it('verifies the distance part sha-256 and rejects a tampered payload', async () => {
    const tampered = new Uint8Array(DISTANCE_BYTES);
    tampered[100]! ^= 0xff;
    serve({ 'zombie-distance-000.r16f': tampered });
    await expect(loadHumanoidVolume(ASSET_URL)).rejects.toThrow(/sha-256/i);
  });

  it('rejects a distance part whose byte length disagrees with the manifest', async () => {
    serve({ 'zombie-distance-000.r16f':
      new Uint8Array(DISTANCE_BYTES.subarray(0, DISTANCE_BYTES.length - 1)) });
    await expect(loadHumanoidVolume(ASSET_URL)).rejects.toThrow(/byte length/i);
  });

  it('validates the manifest BEFORE fetching any part (no texture allocation)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ ...cloneCheckedIn(), kind: 'tampered' }));
    });
    await expect(loadHumanoidVolume(ASSET_URL)).rejects.toThrow(/humanoid volume/i);
    expect(calls).toHaveLength(1); // only the manifest fetch
  });

  it('exposes the coarse f32 bricks indexed by bones[] array position, CPU-side', async () => {
    const manifest = validateHumanoidVolumeManifest(checkedIn);
    serve();
    const assets = await loadHumanoidVolume(ASSET_URL);
    const coarse: HumanoidCoarseBricks = assets.coarse;
    expect(coarse.bones).toHaveLength(manifest.bones.length);
    // bones[0] = Hips -> the FIRST coarse brick
    const hips = coarse.bones[0]!;
    expect(Array.from(hips.dims)).toEqual([15, 15, 16]);
    expect(Array.from(hips.boundsMin)).toEqual(manifest.bones[0]!.boundsMin);
    expect(Array.from(hips.boundsMax)).toEqual(manifest.bones[0]!.boundsMax);
    expect(hips.data.length).toBe(15 * 15 * 16);
    const hipsSpec = manifest.coarse.bones[0]!;
    expect(hips.data.byteOffset).toBe(hipsSpec.offset);
    expect(Array.from(new Uint8Array(hips.data.buffer, hips.data.byteOffset, hips.data.byteLength)))
      .toEqual(Array.from(COARSE_BYTES.subarray(hipsSpec.offset, hipsSpec.offset + hipsSpec.byteLength)));
    // bones[18] = RightForeArm, bones[21] = Head — array-position indexing
    const rfa = coarse.bones[18]!;
    expect(Array.from(rfa.dims)).toEqual([9, 16, 7]);
    expect(rfa.data.byteOffset).toBe(manifest.coarse.bones[18]!.offset);
    const head = coarse.bones[21]!;
    expect(Array.from(head.dims)).toEqual([12, 15, 16]);
    expect(head.data.byteOffset).toBe(manifest.coarse.bones[21]!.offset);
    expect(assets.boneIndex.get('RightForeArm')).toBe(18);
    expect(assets.boneIndex.get('Head')).toBe(21);
    // the coarse pack is CPU-side: the two GPU textures are the only textures
    expect(coarse.bones[0]!.data).toBeInstanceOf(Float32Array);
    assets.dispose();
  });

  it('rejects a coarse pack whose combined byte length disagrees', async () => {
    serve({ 'zombie-coarse.f32':
      new Uint8Array(COARSE_BYTES.subarray(0, COARSE_BYTES.length - 1)) });
    await expect(loadHumanoidVolume(ASSET_URL)).rejects.toThrow(/byte length/i);
  });

  it('rejects a coarse pack whose combined sha-256 disagrees', async () => {
    const tampered = new Uint8Array(COARSE_BYTES);
    tampered[0]! ^= 0xff;
    serve({ 'zombie-coarse.f32': tampered });
    await expect(loadHumanoidVolume(ASSET_URL)).rejects.toThrow(/sha-256/i);
  });

  it('rejects a coarse pack containing a non-finite value', async () => {
    // Corrupt ONE float of RightForeArm's slice to NaN, then re-derive the
    // coarse contract so every hash is consistent with the payload — the
    // non-finite check is the only thing left to fire.
    const tampered = new Uint8Array(COARSE_BYTES);
    const rfa = checkedIn.coarse.bones[18] as { offset: number };
    new DataView(tampered.buffer, tampered.byteOffset, tampered.byteLength)
      .setFloat32(rfa.offset, NaN, true);
    const m = cloneCheckedIn();
    const bones = (checkedIn.coarse.bones as Array<{ offset: number; dims: number[]; byteLength: number }>)
      .map(b => ({
        offset: b.offset,
        dims: b.dims,
        byteLength: b.byteLength,
        sha256: sha256HexSync(tampered.subarray(b.offset, b.offset + b.byteLength)),
      }));
    (m.coarse as Record<string, unknown>).bones = bones;
    (m.coarse as Record<string, unknown>).combinedSha256 = sha256HexSync(tampered);
    serve({ 'zombie-coarse.f32': tampered }, m);
    await expect(loadHumanoidVolume(ASSET_URL)).rejects.toThrow(/non-finite/i);
  });

  it('disposes exactly-once-safe', async () => {
    serve();
    const assets = await loadHumanoidVolume(ASSET_URL);
    expect(() => {
      assets.dispose();
      assets.dispose();
      assets.coarse.dispose();
      assets.coarse.dispose();
    }).not.toThrow();
  });
});

describe('big-endian guard', () => {
  it('keeps the hard host endianness guard for r16f-le distance', () => {
    // The host check is a module constant, not data — the guard's existence is
    // what is testable here (see hand-volume.test.ts for the same tripwire).
    expect(HOST_IS_LITTLE_ENDIAN).toBe(true);
    const src = readFileSync('src/lab/sdf-zombie/webgpu/humanoid-volume.ts', 'utf8');
    expect(src).toContain('if (!HOST_IS_LITTLE_ENDIAN)');
  });
});

describe('HumanoidVolumeManifest type stays literal', () => {
  it('pins encoding/order/pageCount to the bake contract', () => {
    const m: HumanoidVolumeManifest = validateHumanoidVolumeManifest(checkedIn);
    expect(m.distance.encoding === 'r16f-le').toBe(true);
    expect(m.color.encoding === 'rgba8').toBe(true);
    expect(m.order === 'x-fastest-y-z').toBe(true);
    expect(m.kind === 'humanoid-bone-sdf').toBe(true);
    expect(m.version === 1).toBe(true);
    expect(m.pageCount === 1).toBe(true);
  });
});
