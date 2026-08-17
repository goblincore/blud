// src/lab/sdf-zombie/webgpu/hand-volume-clip.test.ts
//
// X1.27 task C1. The clip loader re-asserts the BAKER's manifest contract at
// load time (mirroring scripts/test_bake_hand_sdf_clip.py rejection for
// rejection) and binds the atlas texture at ATLAS dimensions. The "valid"
// case is the REAL checked-in bake read from disk, with its exact binary and
// GLB hashes — a fixture hand-written next to its validator would only
// certify itself.

import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:crypto available in vitest via happy-dom/node
import { createHash } from 'node:crypto';
import {
  validateHandClipManifest, gripFrameSample, loadHandClip,
  GRIP_FRAME_LABELS, type HandClipManifest,
} from './hand-volume-clip';
import * as THREE from 'three/webgpu';

const CHECKED_IN_JSON = 'public/assets/lab/hand-sdf-dynamite-grip-r.json';
const CHECKED_IN_BIN = 'public/assets/lab/hand-sdf-dynamite-grip-r.r16f';
const CHECKED_IN_GLB = 'public/assets/lab/dynamite-bundle-grip.glb';
const PROP_CONTRACT = 'public/assets/lab/dynamite-bundle-grip.json';

const checkedIn = JSON.parse(readFileSync(CHECKED_IN_JSON, 'utf8'));

/** A minimal VALID v2 manifest (2³ frames, 1 cm voxels) for mutations. */
function tinyManifest(): Record<string, unknown> {
  return {
    version: 2,
    kind: 'hand-sdf-clip',
    binary: 'tiny-clip.r16f',
    encoding: 'r16f-le',
    order: 'x-fastest-y-z',
    axes: { x: 'thumbward', y: 'distal', z: 'dorsal' },
    dimensions: [2, 2, 2],
    atlasDimensions: [2, 2, 12],
    frameDepth: 2,
    frameCount: 6,
    frames: GRIP_FRAME_LABELS.map((label, i) => ({ label, key: i / 5 })),
    timing: { closeSec: 0.22, releaseSec: 0.12, swingSec: 0.24, releaseAtSec: 0.15 },
    boundsMin: [-0.01, -0.01, -0.01],
    boundsMax: [0.01, 0.01, 0.01],
    voxelSize: [0.02, 0.02, 0.02],
    isoValue: 0.0,
    byteLength: 2 * 2 * 2 * 2 * 6,
    sha256: { binary: 'a'.repeat(64), source: 'b'.repeat(64) },
    attribution: 'This work is based on "First Person hands rigged" by DavidFischer licensed under CC-BY-4.0',
    prop: {
      url: 'dynamite-bundle-grip.glb',
      sha256: 'c'.repeat(64),
      gripLocal: [0, 0.05, 0],
      axisLocal: [0, 1, 0],
      modelGripOffsetM: -0.015,
      modelRotationLocal: [1, 0, 0, 0],
      contactRadiusM: 0.037,
      contactBelowM: 0.115,
      contactAboveM: 0.135,
      fuseTipNode: 'FuseTip',
      flightPivotNode: 'FlightPivot',
    },
  };
}

describe('validateHandClipManifest — the checked-in bake', () => {
  it('accepts the real manifest and reports the bake grid', () => {
    const m = validateHandClipManifest(checkedIn);
    expect(m.dimensions).toEqual([131, 178, 102]);
    expect(m.atlasDimensions).toEqual([131, 178, 612]);
    expect(m.frameDepth).toBe(102);
    expect(m.frameCount).toBe(6);
    expect(m.byteLength).toBe(2 * 131 * 178 * 102 * 6);
    expect(m.frames.map(f => f.label)).toEqual([...GRIP_FRAME_LABELS]);
    expect(m.frames.map(f => f.key)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(m.timing).toEqual({ closeSec: 0.22, releaseSec: 0.12, swingSec: 0.24, releaseAtSec: 0.15 });
  });

  it('agrees with the checked-in binary on disk: exact bytes, exact sha-256', () => {
    const m = validateHandClipManifest(checkedIn);
    const bytes = readFileSync(CHECKED_IN_BIN);
    expect(bytes.byteLength).toBe(m.byteLength);
    expect(createHash('sha256').update(bytes).digest('hex'))
      .toBe(m.sha256.binary);
  });

  it('is hash-bound to the exact derived GLB the poses were authored against', () => {
    const m = validateHandClipManifest(checkedIn);
    const contract = JSON.parse(readFileSync(PROP_CONTRACT, 'utf8'));
    expect(m.prop.sha256).toBe(contract.sha256);
    expect(createHash('sha256').update(readFileSync(CHECKED_IN_GLB)).digest('hex'))
      .toBe(m.prop.sha256);
    expect(m.prop.url).toBe(contract.glb);
    expect(m.prop.fuseTipNode).toBe('FuseTip');
    expect(m.prop.flightPivotNode).toBe('FlightPivot');
  });

  it('the quaternion is the orientation source and axisLocal agrees with it', () => {
    const m = validateHandClipManifest(checkedIn);
    // modelRotationLocal rotates model +Y onto axisLocal (validated to 1e-6
    // inside the validator); restate it numerically here.
    const [w, x, y, z] = m.prop.modelRotationLocal;
    const rotatedY = [
      2 * (x * y + w * z),
      1 - 2 * (x * x + z * z),
      2 * (y * z - w * x),
    ];
    const err = Math.hypot(
      rotatedY[0]! - m.prop.axisLocal[0]!,
      rotatedY[1]! - m.prop.axisLocal[1]!,
      rotatedY[2]! - m.prop.axisLocal[2]!);
    expect(err).toBeLessThan(1e-6);
  });
});

describe('validateHandClipManifest — rejections (mirror the baker)', () => {
  const rejects = (label: string, mutate: (m: Record<string, unknown>) => void) =>
    it(`rejects ${label}`, () => {
      const m = tinyManifest();
      mutate(m);
      expect(() => validateHandClipManifest(m)).toThrow(/hand clip/i);
    });

  rejects('a wrong version', m => { m.version = 1; });
  rejects('a wrong kind', m => { m.kind = 'hand-sdf'; });
  rejects('a wrong encoding', m => { m.encoding = 'r16f-be'; });
  rejects('a wrong sample order', m => { m.order = 'z-fastest'; });
  rejects('swapped anatomical axes', m => {
    m.axes = { x: 'thumbward', y: 'dorsal', z: 'distal' };
  });
  rejects('a frame count other than six', m => {
    m.frameCount = 5;
    m.atlasDimensions = [2, 2, 10];
    m.byteLength = 2 * 2 * 2 * 5;
  });
  rejects('duplicate labels', m => {
    (m.frames as Array<{ label: string }>)[2]!.label = 'approach';
  });
  rejects('out-of-order labels', m => {
    const f = m.frames as Array<{ label: string }>;
    [f[1]!.label, f[2]!.label] = [f[2]!.label, f[1]!.label];
  });
  rejects('keys not starting at 0', m => {
    (m.frames as Array<{ key: number }>)[0]!.key = 0.1;
  });
  rejects('keys not ending at 1', m => {
    (m.frames as Array<{ key: number }>)[5]!.key = 0.9;
  });
  rejects('non-monotonic keys', m => {
    (m.frames as Array<{ key: number }>)[3]!.key = 0.1;
  });
  rejects('equal adjacent keys', m => {
    (m.frames as Array<{ key: number }>)[3]!.key = 0.4;
  });
  rejects('atlasDimensions != [nx, ny, nz*6]', m => {
    m.atlasDimensions = [2, 2, 11];
  });
  rejects('frameDepth != nz', m => {
    m.frameDepth = 3;
    m.atlasDimensions = [2, 2, 18];
    m.byteLength = 2 * 2 * 2 * 3 * 6;
  });
  rejects('a byte length mismatch', m => { m.byteLength = m.byteLength as number + 2; });
  rejects('a non-unit axisLocal', m => {
    m.prop = { ...(m.prop as Record<string, unknown>), axisLocal: [0, 2, 0] };
  });
  rejects('a non-unit modelRotationLocal', m => {
    m.prop = { ...(m.prop as Record<string, unknown>), modelRotationLocal: [2, 0, 0, 0] };
  });
  rejects('a quaternion that does not rotate model +Y onto axisLocal', m => {
    // 90 deg about +X maps +Y to +Z, not +Y.
    const s = Math.SQRT1_2;
    m.prop = { ...(m.prop as Record<string, unknown>), modelRotationLocal: [s, s, 0, 0] };
  });
  rejects('a missing attribution (licensing guardrail)', m => { m.attribution = ''; });
  rejects('an absolute binary path', m => { m.binary = '/abs/clip.r16f'; });
  rejects('a traversal binary path', m => { m.binary = '../escape.r16f'; });
  rejects('a schemed binary path', m => { m.binary = 'https://x/clip.r16f'; });
  rejects('an absolute prop url', m => { m.prop = { ...(m.prop as Record<string, unknown>), url: '/abs/prop.glb' }; });
  rejects('a traversal prop url', m => { m.prop = { ...(m.prop as Record<string, unknown>), url: '../up.glb' }; });
  rejects('a drive-letter path', m => { m.prop = { ...(m.prop as Record<string, unknown>), url: 'C:\\prop.glb' }; });
  rejects('non-positive timing', m => {
    m.timing = { ...(m.timing as Record<string, unknown>), closeSec: 0 };
  });
  rejects('release marker outside the swing', m => {
    m.timing = { ...(m.timing as Record<string, unknown>), releaseAtSec: 0.3 };
  });
  rejects('inverted bounds', m => { m.boundsMin = [0.02, -0.01, -0.01]; });
  rejects('voxel size inconsistent with bounds/dimensions', m => {
    m.voxelSize = [0.0202, 0.02, 0.02];
  });
  rejects('a missing prop contract', m => { delete m.prop; });
  rejects('wrong anchor node names', m => {
    m.prop = { ...(m.prop as Record<string, unknown>), fuseTipNode: 'tip' };
  });

  it('rejects a non-object', () => {
    expect(() => validateHandClipManifest('nope')).toThrow(/hand clip/i);
    expect(() => validateHandClipManifest(null)).toThrow(/hand clip/i);
  });
});

describe('gripFrameSample — normalized adjacent-frame lookup', () => {
  const m = validateHandClipManifest(checkedIn);

  it('pins the plan-specified samples', () => {
    expect(gripFrameSample(m, 0)).toEqual({ frame0: 0, frame1: 0, alpha: 0 });
    const mid = gripFrameSample(m, 0.3);
    expect(mid.frame0).toBe(1);
    expect(mid.frame1).toBe(2);
    expect(mid.alpha).toBeCloseTo(0.5, 12);
    expect(gripFrameSample(m, 1)).toEqual({ frame0: 5, frame1: 5, alpha: 0 });
  });

  it('maps each segment midpoint exactly', () => {
    for (let i = 0; i < 5; i++) {
      const g = (i + 0.5) / 5;
      const s = gripFrameSample(m, g);
      expect(s.frame0).toBe(i);
      expect(s.frame1).toBe(i + 1);
      expect(s.alpha).toBeCloseTo(0.5, 12);
    }
    // segment start: alpha 0 on the LOWER frame pair
    const s = gripFrameSample(m, 0.2);
    expect(s.frame0).toBe(1);
    expect(s.frame1).toBe(2);
    expect(s.alpha).toBeCloseTo(0, 12);
  });

  it('clamps outside [0,1] to the boundary frames and never invents frame 6', () => {
    expect(gripFrameSample(m, -0.5)).toEqual({ frame0: 0, frame1: 0, alpha: 0 });
    expect(gripFrameSample(m, 1.5)).toEqual({ frame0: 5, frame1: 5, alpha: 0 });
    expect(gripFrameSample(m, Number.NaN).frame1).toBe(0);
    const s = gripFrameSample(m, 0.999);
    expect(s).toEqual({ frame0: 4, frame1: 5, alpha: expect.closeTo(0.995, 10) });
  });

  it('interpolates only ADJACENT frames — open and firm-grip never mix', () => {
    for (let i = 0; i <= 20; i++) {
      const g = i / 20;
      const s = gripFrameSample(m, g);
      expect(Math.abs(s.frame1 - s.frame0)).toBeLessThanOrEqual(1);
    }
  });
});

describe('loadHandClip', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('serves the REAL checked-in manifest + atlas: texture binds at [nx, ny, nz*6]', async () => {
    const bytes = new Uint8Array(readFileSync(CHECKED_IN_BIN));
    const m = JSON.parse(readFileSync(CHECKED_IN_JSON, 'utf8'));
    const calls = serve(m, bytes);
    const clip = await loadHandClip('http://localhost/assets/lab/hand-sdf-dynamite-grip-r.json');
    expect(calls[0]).toBe('http://localhost/assets/lab/hand-sdf-dynamite-grip-r.json');
    // the binary resolves RELATIVE to the manifest URL
    expect(calls[1]).toBe('http://localhost/assets/lab/hand-sdf-dynamite-grip-r.r16f');
    const tex = clip.texture;
    expect(tex).toBeInstanceOf(THREE.Data3DTexture);
    expect(tex.format).toBe(THREE.RedFormat);
    expect(tex.type).toBe(THREE.HalfFloatType);
    expect(tex.image.width).toBe(131);
    expect(tex.image.height).toBe(178);
    expect(tex.image.depth).toBe(612);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.generateMipmaps).toBe(false);
    expect(clip.maxVoxelPitch).toBeCloseTo(0.0014966860, 9);
    // Idempotent disposal.
    clip.dispose();
    clip.dispose();
  });

  it('keeps the half bits untouched and hashes them first', async () => {
    // tiny atlas: 2x2x12 half floats; a distinctive first word.
    const bin = new Uint8Array(96);
    const words = new Uint16Array(bin.buffer);
    words.fill(0x3c00);
    words[0] = 0xbc00;
    const m = tinyManifest();
    m.sha256 = {
      binary: createHash('sha256').update(bin).digest('hex'),
      source: 'b'.repeat(64),
    };
    serve(m, bin);
    const clip = await loadHandClip('/assets/lab/tiny.json');
    expect(Array.from(clip.texture.image.data as Uint16Array).slice(0, 4))
      .toEqual([0xbc00, 0x3c00, 0x3c00, 0x3c00]);
    clip.dispose();
  });

  it('rejects a tampered atlas by sha-256 before any texture escapes', async () => {
    const bin = new Uint8Array(96).fill(0x11);
    const m = tinyManifest();
    m.sha256 = {
      binary: createHash('sha256').update(bin).digest('hex'),
      source: 'b'.repeat(64),
    };
    serve(m, bin, true);
    await expect(loadHandClip('/assets/lab/tiny.json')).rejects.toThrow(/sha-256/i);
  });

  it('rejects a short atlas (byte length vs manifest)', async () => {
    const bin = new Uint8Array(10);
    const m = tinyManifest();
    m.sha256 = {
      binary: createHash('sha256').update(bin).digest('hex'),
      source: 'b'.repeat(64),
    };
    serve(m, bin);
    await expect(loadHandClip('/assets/lab/tiny.json')).rejects.toThrow(/byte length/i);
  });

  it('rejects an invalid manifest without fetching or allocating anything', async () => {
    const m = tinyManifest();
    m.frameDepth = 7; // structurally invalid
    const calls = serve(m, new Uint8Array(96));
    await expect(loadHandClip('/assets/lab/tiny.json')).rejects.toThrow(/frameDepth/);
    expect(calls.length).toBe(1); // only the JSON was fetched
  });

  it('type stays literal: version 2, kind hand-sdf-clip', () => {
    const m: HandClipManifest = validateHandClipManifest(checkedIn);
    expect(m.version === 2 && m.kind === 'hand-sdf-clip').toBe(true);
  });
});
