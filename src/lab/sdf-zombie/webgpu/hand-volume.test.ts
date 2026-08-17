// src/lab/sdf-zombie/webgpu/hand-volume.test.ts
//
// X1.26 task B1. The loader is the ONLY thing standing between a corrupt or
// hand-edited manifest and a hand that silently renders garbage (a wrong
// byte order or axis order does not error — it byte-swaps/mirrors the field),
// so every contract the bake wrote is re-asserted here at load time.
//
// The "valid" case is the REAL checked-in bake, read from disk — a fixture
// hand-written next to its own validator would only certify itself.

import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:crypto available in vitest via happy-dom/node
import { createHash } from 'node:crypto';
import {
  validateHandVolumeManifest, loadHandVolume, createFallbackHandVolumeTexture,
  HOST_IS_LITTLE_ENDIAN, type HandVolumeManifest,
} from './hand-volume';
import * as THREE from 'three/webgpu';

const CHECKED_IN_JSON = 'public/assets/lab/hand-sdf-relaxed-r.json';
const CHECKED_IN_BIN = 'public/assets/lab/hand-sdf-relaxed-r.r16f';
const checkedIn = JSON.parse(readFileSync(CHECKED_IN_JSON, 'utf8'));

/** A minimal VALID manifest (2³ volume, 1 cm voxels) for mutation tests. */
function tinyManifest(): Record<string, unknown> {
  return {
    version: 1,
    binary: 'tiny.r16f',
    encoding: 'r16f-le',
    order: 'x-fastest-y-z',
    axes: { x: 'thumbward', y: 'distal', z: 'dorsal' },
    dimensions: [2, 2, 2],
    boundsMin: [-0.01, -0.01, -0.01],
    boundsMax: [0.01, 0.01, 0.01],
    voxelSize: [0.02, 0.02, 0.02],
    isoValue: 0.0,
    byteLength: 16,
    sha256: {
      binary: 'a'.repeat(64),
      source: 'b'.repeat(64),
    },
    attribution: 'This work is based on "First Person hands rigged" by DavidFischer licensed under CC-BY-4.0',
  };
}

describe('validateHandVolumeManifest — the checked-in bake', () => {
  it('accepts the real manifest and reports its dimensions and byte length', () => {
    const m = validateHandVolumeManifest(checkedIn);
    expect(m.dimensions).toEqual([131, 178, 86]);
    expect(m.byteLength).toBe(2 * 131 * 178 * 86);
    expect(m.encoding).toBe('r16f-le');
    expect(m.order).toBe('x-fastest-y-z');
  });

  it('agrees with the checked-in binary on disk: exact byte length', () => {
    const m = validateHandVolumeManifest(checkedIn);
    const stat = readFileSync(CHECKED_IN_BIN).byteLength;
    expect(stat).toBe(m.byteLength);
  });

  it('measured voxel pitch is consistent with bounds/dimensions', () => {
    const m = validateHandVolumeManifest(checkedIn);
    for (let i = 0; i < 3; i++) {
      const extent = m.boundsMax[i]! - m.boundsMin[i]!;
      expect(m.voxelSize[i]! * (m.dimensions[i]! - 1)).toBeCloseTo(extent, 6);
    }
  });
});

describe('validateHandVolumeManifest — rejections', () => {
  // Every mutation is a way the bake contract could silently break at load:
  // none of these produce a shader error — they produce a WRONG HAND.
  const rejects = (label: string, mutate: (m: Record<string, unknown>) => void) =>
    it(`rejects ${label}`, () => {
      const m = tinyManifest();
      mutate(m);
      expect(() => validateHandVolumeManifest(m)).toThrow(/hand volume/i);
    });

  rejects('a wrong version', m => { m.version = 2; });
  rejects('a wrong encoding', m => { m.encoding = 'r16f-be'; });
  rejects('a wrong sample order', m => { m.order = 'y-fastest-x-z'; });
  rejects('swapped anatomical axes', m => {
    m.axes = { x: 'thumbward', y: 'dorsal', z: 'distal' };
  });
  rejects('a missing axis name', m => { m.axes = { x: 'thumbward', y: 'distal' }; });
  rejects('non-integer dimensions', m => { m.dimensions = [2.5, 2, 2]; });
  rejects('a 1-wide axis (endpoint-inclusive lattice needs both endpoints)', m => {
    m.dimensions = [1, 2, 2]; m.byteLength = 8;
  });
  rejects('dimensions inconsistent with byte length', m => {
    m.dimensions = [3, 2, 2]; // 24 bytes of data, byteLength still says 16
  });
  rejects('inverted bounds', m => { m.boundsMin = [0.02, -0.01, -0.01]; });
  rejects('non-finite bounds', m => { m.boundsMax = [NaN, 0.01, 0.01]; });
  rejects('a non-positive voxel size', m => { m.voxelSize = [0, 0.02, 0.02]; });
  rejects('a voxel size inconsistent with bounds/dimensions', m => {
    // 1% off — beyond the 0.1% tolerance the bake's own rounding allows.
    m.voxelSize = [0.0202, 0.02, 0.02];
  });
  rejects('a byte length that disagrees with dimensions', m => { m.byteLength = 15; });
  rejects('a non-zero iso-value', m => { m.isoValue = 0.5; });
  rejects('a malformed binary sha-256', m => {
    m.sha256 = { binary: 'xyz', source: 'b'.repeat(64) };
  });
  rejects('a missing attribution (licensing guardrail)', m => { m.attribution = ''; });

  it('rejects a non-object', () => {
    expect(() => validateHandVolumeManifest('nope')).toThrow(/hand volume/i);
    expect(() => validateHandVolumeManifest(null)).toThrow(/hand volume/i);
  });
});

describe('loadHandVolume', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Serves a manifest + binary pair through a stubbed fetch. */
  function serve(manifest: Record<string, unknown>, binary: Uint8Array, tamper = false) {
    const bin = tamper ? binary.map((b, i) => (i === 0 ? b ^ 0xff : b)) : binary;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('.json')) return new Response(JSON.stringify(manifest));
      return new Response(bin.slice().buffer);
    });
    return calls;
  }

  it('fetches the JSON, then the binary RELATIVE to the manifest URL', async () => {
    const m = tinyManifest();
    const bin = new Uint8Array(16).fill(0x3c); // +half values, content irrelevant
    m.sha256 = {
      binary: createHash('sha256').update(bin).digest('hex'),
      source: 'b'.repeat(64),
    };
    const calls = serve(m, bin);
    const vol = await loadHandVolume('http://localhost/assets/lab/tiny.json');
    expect(calls[0]).toBe('http://localhost/assets/lab/tiny.json');
    expect(calls[1]).toBe('http://localhost/assets/lab/tiny.r16f');
    vol.dispose();
  });

  it('builds a RedFormat/HalfFloatType 3D texture from the raw bytes', async () => {
    const m = tinyManifest();
    const bin = new Uint8Array(16);
    new Uint16Array(bin.buffer).set([0x3c00, 0x3c00, 0x3c00, 0x3c00,
                                     0x3c00, 0x3c00, 0x3c00, 0xbc00]);
    m.sha256 = {
      binary: createHash('sha256').update(bin).digest('hex'),
      source: 'b'.repeat(64),
    };
    serve(m, bin);
    const vol = await loadHandVolume('/assets/lab/tiny.json');
    const tex = vol.texture;
    expect(tex).toBeInstanceOf(THREE.Data3DTexture);
    expect(tex.format).toBe(THREE.RedFormat);
    expect(tex.type).toBe(THREE.HalfFloatType);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.unpackAlignment).toBe(1);
    // The bits ride UNTOUCHED — half encoding happens on the GPU.
    expect(Array.from((tex.image.data as Uint16Array))).toEqual(
      [0x3c00, 0x3c00, 0x3c00, 0x3c00, 0x3c00, 0x3c00, 0x3c00, 0xbc00]);
    // Derived metadata the views need (hit epsilon, proxy padding).
    expect(vol.maxVoxelPitch).toBeCloseTo(0.02, 9);
    // Ownership: dispose must be callable exactly-once-safe.
    vol.dispose();
    vol.dispose();
  });

  it('verifies the binary sha-256 and rejects a tampered payload', async () => {
    const m = tinyManifest();
    const bin = new Uint8Array(16).fill(0x11);
    m.sha256 = {
      binary: createHash('sha256').update(bin).digest('hex'),
      source: 'b'.repeat(64),
    };
    serve(m, bin, true);
    await expect(loadHandVolume('/assets/lab/tiny.json')).rejects.toThrow(/sha-256/i);
  });

  it('rejects a binary whose length disagrees with the manifest', async () => {
    const m = tinyManifest();
    const bin = new Uint8Array(10); // manifest promises 16
    m.sha256 = {
      binary: createHash('sha256').update(bin).digest('hex'),
      source: 'b'.repeat(64),
    };
    serve(m, bin);
    await expect(loadHandVolume('/assets/lab/tiny.json')).rejects.toThrow(/byte length/i);
  });

  it('refuses to run on a big-endian host (r16f-le would be byte-swapped)', async () => {
    // The host check is a module constant, not data — the guard's existence is
    // what is testable here, matching the repo's string-tripwire style for
    // things a test cannot make false on demand (see march.wgsl.test.ts).
    expect(HOST_IS_LITTLE_ENDIAN).toBe(true);
    // (import.meta.url is http-schemed under happy-dom; cwd is the repo root.)
    const src = readFileSync('src/lab/sdf-zombie/webgpu/hand-volume.ts', 'utf8');
    expect(src).toContain('if (!HOST_IS_LITTLE_ENDIAN)');
  });
});

describe('createFallbackHandVolumeTexture', () => {
  it('is a 1³ volume holding one POSITIVE half-float distance', () => {
    // +1 m: every sample says "empty space, far away", so a non-volume view
    // (volume enable 0) never samples it anyway — but if it ever did, it must
    // read as empty rather than as solid fill.
    const tex = createFallbackHandVolumeTexture();
    const bits = tex.image.data as Uint16Array;
    expect(bits.length).toBe(1);
    expect(bits[0]).toBe(0x3c00); // IEEE-754 half +1.0
    expect(tex.image.width).toBe(1);
    expect(tex.image.height).toBe(1);
    expect(tex.image.depth).toBe(1);
    expect(tex.format).toBe(THREE.RedFormat);
    expect(tex.type).toBe(THREE.HalfFloatType);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.unpackAlignment).toBe(1);
    tex.dispose();
  });
});

describe('HandVolumeManifest type stays literal', () => {
  it('pins encoding/order/axes to the bake contract', () => {
    // Compile-time literals double as runtime pins through the validator.
    const m: HandVolumeManifest = validateHandVolumeManifest(checkedIn);
    expect(m.encoding === 'r16f-le').toBe(true);
    expect(m.order === 'x-fastest-y-z').toBe(true);
  });
});
