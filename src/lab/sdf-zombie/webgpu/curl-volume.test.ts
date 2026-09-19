// Contract for the curl-noise volume (flame-polish plan task 2): a small
// seeded 64^3 RGBA8 field that gives flame its flow. Determinism is the point
// (the whole look must be reproducible from a seed), so the tests pin the
// build, the sign span the shader's `rgb * 2 - 1` decode relies on, and the
// spatial coherence that is the difference between "one flowing body" and "N
// independently flickering quads".
import { describe, it, expect } from 'vitest';
import { buildCurlVolume, CURL_VOLUME_SIZE, sampleCurlVolume, curlNoise3 } from './curl-volume';
import { noise3 } from '../validate';

describe('curl volume', () => {
  // A 64^3 build is ~0.7 s warm and several seconds while the JIT warms up on a
  // loaded machine — deterministic work, not a hang, so the default 5 s cap is
  // too tight for the cold first build.
  const BUILD_TIMEOUT = 30_000;

  it('the scalar noise is the repo noise, bit for bit', () => {
    // curl-volume transcribes validate.ts's noise3 without its per-hash array
    // allocations (3M samples per build). This pins the transcription so the
    // two cannot drift.
    for (const p of [[0.3, 4.7, -2.1], [12.5, 3.25, 8.125], [-7.9, 0.01, 63.4]]) {
      expect(curlNoise3(p[0]!, p[1]!, p[2]!)).toBeCloseTo(noise3(p as [number, number, number]), 12);
    }
  });

  it('packs a 64-cubed RGBA8 volume deterministically from a seed', () => {
    expect(CURL_VOLUME_SIZE).toBe(64);
    const a = buildCurlVolume(1234);
    const b = buildCurlVolume(1234);
    expect(a.length).toBe(64 * 64 * 64 * 4);
    expect(a).toEqual(b);                       // seeded, no Math.random
    expect(buildCurlVolume(9999)).not.toEqual(a);
  }, BUILD_TIMEOUT);

  it('is centred so the decoded vector spans both signs', () => {
    const v = buildCurlVolume(7);
    let lo = 255, hi = 0;
    for (let i = 0; i < v.length; i += 4) { lo = Math.min(lo, v[i]!); hi = Math.max(hi, v[i]!); }
    expect(lo).toBeLessThan(110);               // decodes below 0
    expect(hi).toBeGreaterThan(145);            // and above 0
  }, BUILD_TIMEOUT);

  it('samples coherently: neighbours agree far more than distant points', () => {
    // Divergence-free CURL noise is smooth over the volume — that smoothness
    // is what makes a ring of cards around one limb share a displacement. A
    // white-noise field (the per-card phase we are replacing) would not. The
    // distances are AVERAGED so one lucky far pair cannot flip the verdict.
    const v = buildCurlVolume(7);
    const d = (p: readonly [number, number, number], q: readonly [number, number, number]) =>
      Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    let near = 0, far = 0;
    for (let i = 0; i < 16; i++) {
      near += d(sampleCurlVolume(v, 32, 32, 32), sampleCurlVolume(v, 32 + 0.5, 32, 32));
      far += d(sampleCurlVolume(v, 32, 32, 32), sampleCurlVolume(v, i * 4, i * 3, i * 5));
    }
    expect(near / 16).toBeLessThan(far / 16);
  });

  it('wraps the sampler on the lattice period', () => {
    const v = buildCurlVolume(7);
    expect(sampleCurlVolume(v, 32, 32, 32)).toEqual(sampleCurlVolume(v, 32 + 64, 32, 32));
  });
});
