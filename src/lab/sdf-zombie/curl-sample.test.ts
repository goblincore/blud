// src/lab/sdf-zombie/curl-sample.test.ts
//
// Contract for the CPU curl sampler the droplet sim integrates with. The
// sampler is the ONE trilinear decode over the packed volume
// (webgpu/curl-volume.ts), so these pin the four properties the sim relies on:
// determinism, the torus wraparound, a decode that spans both signs, and the
// spatial coherence that makes a spray move as a connected volume rather than
// N independent specks.
import { describe, it, expect } from 'vitest';
import {
  CURL_VOLUME_SIZE, CURL_SCALE, sampleCurlVolume, sampleCurlWorld, curlAccelAt,
  type CurlFlow,
} from './curl-sample';
import { buildCurlVolume } from './webgpu/curl-volume';

// A 64^3 build is deterministic work, not a hang; the default 5 s cap is tight
// for a cold JIT (curl-volume.test.ts licenses the same).
const BUILD_TIMEOUT = 30_000;

function flow(data: Uint8Array, over: Partial<CurlFlow> = {}): CurlFlow {
  return { data, strength: 1, scale: CURL_SCALE, drift: 0, time: 0, ...over };
}

describe('curl-sample (CPU sampler over the packed volume)', () => {
  it('is deterministic: same volume + same position => identical vector', () => {
    const v = buildCurlVolume(7);
    const a = sampleCurlVolume(v, 10.25, 41.5, 3.75);
    const b = sampleCurlVolume(v, 10.25, 41.5, 3.75);
    expect(a).toEqual(b);
  }, BUILD_TIMEOUT);

  it('wraps on the lattice period on every axis', () => {
    const v = buildCurlVolume(7);
    const base = sampleCurlVolume(v, 3.25, 9.5, 61.75);
    expect(sampleCurlVolume(v, 3.25 + CURL_VOLUME_SIZE, 9.5, 61.75)).toEqual(base);
    expect(sampleCurlVolume(v, 3.25, 9.5 + CURL_VOLUME_SIZE, 61.75)).toEqual(base);
    expect(sampleCurlVolume(v, 3.25, 9.5, 61.75 + CURL_VOLUME_SIZE)).toEqual(base);
    // Negative lattice coordinates wrap too (the builder is periodic, the
    // sampler must be as well or a droplet leaving the box would read 0).
    expect(sampleCurlVolume(v, 3.25 - CURL_VOLUME_SIZE, 9.5, 61.75)).toEqual(base);
  });

  it('decodes the packed bytes to vectors on BOTH sides of zero', () => {
    const v = buildCurlVolume(7);
    let sawPos = false, sawNeg = false;
    for (let i = 0; i < 512; i++) {
      const s = sampleCurlVolume(v, i * 0.37, i * 0.11, i * 0.53) as readonly number[];
      for (const c of s) {
        if (c > 0.001) sawPos = true;
        if (c < -0.001) sawNeg = true;
      }
    }
    expect(sawPos).toBe(true);
    expect(sawNeg).toBe(true);
  });

  it('is trilinear-continuous: nearby points give nearby vectors', () => {
    const v = buildCurlVolume(7);
    const d = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    // Across many points, a 1/64-texel step must be much smaller than the
    // full -1..1 vector span; a Nearest sampler (or a bad decode) would jump.
    let maxStep = 0;
    for (let i = 0; i < 256; i++) {
      const p = [i * 0.41, i * 0.23, i * 0.67] as const;
      const q = [p[0] + 1 / 64, p[1], p[2]] as const;
      maxStep = Math.max(maxStep, d(sampleCurlVolume(v, ...p), sampleCurlVolume(v, ...q)));
    }
    expect(maxStep).toBeLessThan(0.5);
  }, BUILD_TIMEOUT);

  it('sampleCurlWorld divides by the scale exactly like the shader accessor', () => {
    const v = buildCurlVolume(7);
    expect(sampleCurlWorld(v, 12, 24, -36, 6)).toEqual(sampleCurlVolume(v, 2, 4, -6));
    // A non-positive scale falls back to the shared default rather than /0.
    expect(sampleCurlWorld(v, 12, 24, -36, 0)).toEqual(sampleCurlWorld(v, 12, 24, -36));
  });

  it('curlAccelAt scales the decoded vector by strength and applies the drift', () => {
    const v = buildCurlVolume(7);
    const f = flow(v);
    const unit = sampleCurlWorld(v, 1.5, 2.5, 3.5, CURL_SCALE);
    const a = curlAccelAt(f, 1.5, 2.5, 3.5);
    expect(a[0]).toBeCloseTo(unit[0], 12);
    expect(a[1]).toBeCloseTo(unit[1], 12);
    expect(a[2]).toBeCloseTo(unit[2], 12);

    const doubled = curlAccelAt(flow(v, { strength: 2 }), 1.5, 2.5, 3.5);
    expect(doubled[0]).toBeCloseTo(unit[0] * 2, 12);

    // Drift advances the sample point along +Y over time.
    const drifted = curlAccelAt(flow(v, { drift: 2, time: 3 }), 1.5, 2.5, 3.5);
    expect(drifted).toEqual(curlAccelAt(flow(v, { drift: 6, time: 1 }), 1.5, 2.5, 3.5));
    // ... and a zero drift is time-independent (the static field).
    expect(curlAccelAt(flow(v, { time: 99 }), 1.5, 2.5, 3.5)).toEqual(a);
  }, BUILD_TIMEOUT);
});
