// src/lab/sdf-zombie/webgpu/curl-volume-node.test.ts
//
// Contract for the SHARED curl-volume texture node. The piece that matters is
// the sharing: every effect must sample ONE lazily-created 64^3 Data3DTexture
// (a per-effect build is ~0.7 s of CPU and 1 MB of VRAM each, and — worse —
// two textures means two different flow fields, so effects no longer move
// together). Determinism and the filterability the shader depends on are the
// other two pinned facts; the TSL graph itself is only smoke-tested, because
// vitest has no WebGPU device.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { float, positionWorld } from 'three/tsl';
import {
  CURL_NODE_SEED, curlVector, disposeCurlVolume, getCurlTexture, getCurlVolumeData,
} from './curl-volume-node';
import { buildCurlVolume, CURL_VOLUME_SIZE } from './curl-volume';

describe('shared curl volume node', () => {
  // A cold 64^3 build is ~0.7 s warm and several seconds while the JIT warms.
  const BUILD_TIMEOUT = 30_000;

  it('builds ONE texture, lazily, and shares it across calls', () => {
    const a = getCurlTexture();
    const b = getCurlTexture();
    expect(a).toBe(b);                       // the same object, not a copy
    expect(a).toBeInstanceOf(THREE.Data3DTexture);
    expect(a.image.width).toBe(CURL_VOLUME_SIZE);
    expect(a.image.height).toBe(CURL_VOLUME_SIZE);
    expect(a.image.depth).toBe(CURL_VOLUME_SIZE);
  }, BUILD_TIMEOUT);

  it('is filterable and tiles on all three axes', () => {
    // RGBA8 + Linear/Linear is a filterable WebGPU combination; a Nearest
    // fallback makes WGSLNodeBuilder bake integer texel fetches and silently
    // ignore the filtering (flame-cards task 1's root cause). Repeat on every
    // axis is what lets the field tile instead of clamping at its edge.
    const t = getCurlTexture();
    expect(t.format).toBe(THREE.RGBAFormat);
    expect(t.type).toBe(THREE.UnsignedByteType);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    expect(t.magFilter).toBe(THREE.LinearFilter);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    expect(t.wrapT).toBe(THREE.RepeatWrapping);
    expect(t.wrapR).toBe(THREE.RepeatWrapping);
    expect(t.generateMipmaps).toBe(false);
  });

  it('exposes the same CPU volume the shared texture was packed from', () => {
    // The card host samples this array on the CPU to displace whole anchors by
    // the SAME field the shader warps with; if the two ever diverged the cards
    // would swim against their own flame.
    expect(getCurlVolumeData()).toEqual(buildCurlVolume(CURL_NODE_SEED));
  }, BUILD_TIMEOUT);

  it('builds a decoded curl node from a world position and time', () => {
    const node = curlVector(positionWorld as never, float(0) as never);
    expect(node).toBeTruthy();
  });

  it('drops the shared texture on dispose and lazily rebuilds on next use', () => {
    const before = getCurlTexture();
    disposeCurlVolume();
    const after = getCurlTexture();
    expect(after).not.toBe(before);
  }, BUILD_TIMEOUT);
});
