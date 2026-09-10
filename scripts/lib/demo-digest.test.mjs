// scripts/lib/demo-digest.test.mjs
//
// The recorder's FNV-1a copy, gated against the canonical vectors. It needs its
// own suite HERE as well as the cross-check in frame-hash.test.ts, because that
// cross-check lives in a .ts file that imports this module — if the module broke
// at the type level, the .ts suite would fail to collect and the duplication could
// rot unnoticed. This file is the module's own gate.
import { describe, it, expect } from 'vitest';
import { fnv1aBytes, FNV_OFFSET, FNV_PRIME } from './demo-digest.mjs';

describe('demo-digest — the recorder-side digest', () => {
  it('reproduces the canonical FNV-1a 32-bit vectors', () => {
    expect(fnv1aBytes(new Uint8Array([]))).toBe(0x811c9dc5);
    expect(fnv1aBytes(new Uint8Array([0x61]))).toBe(0xe40c292c);
    expect(fnv1aBytes(new Uint8Array([0x61, 0x62, 0x63]))).toBe(0x1a47e90b);
    expect(fnv1aBytes(new Uint8Array([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37]))).toBe(0xd97f649d);
  });

  it('exposes the standard basis and prime so a skew is visible, not silent', () => {
    expect(FNV_OFFSET).toBe(0x811c9dc5);
    expect(FNV_PRIME).toBe(0x01000193);
  });

  it('returns an unsigned 32-bit value that survives JSON', () => {
    for (const v of [0, 1, 255, 0xdeadbeef]) {
      const h = fnv1aBytes(new Uint8Array([v, v, v]));
      expect(h).toBe(h >>> 0);
      expect(JSON.parse(JSON.stringify(h))).toBe(h);
    }
  });

  it('is sensitive to a single flipped bit anywhere in a large buffer', () => {
    // The real workload is a decoded PNG: a few hundred KB. A digest that only
    // looked at the head of the buffer would pass a small test and fail here.
    const buf = new Uint8Array(200_000);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 31) & 0xff;
    const before = fnv1aBytes(buf);
    buf[199_999] ^= 0x01;
    expect(fnv1aBytes(buf)).not.toBe(before);
  });
});
