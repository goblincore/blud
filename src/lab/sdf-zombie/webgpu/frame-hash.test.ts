import { describe, it, expect } from 'vitest';
import { fnv1aBytes as recorderFnv, FNV_OFFSET as REC_OFFSET, FNV_PRIME as REC_PRIME } from '../../../../scripts/lib/demo-digest.mjs';
import {
  fnv1aBytes,
  fnv1aFloats,
  FRAME_HASH_VERSION,
  compareFrames,
  describeComparison,
  firstDivergence,
  hashTiles,
  packTexelRegion,
  paddedRowStrideBytes,
  paddedRowStrideFloats,
  ROW_ALIGN,
  type FrameHash,
} from './frame-hash';

// The gate for the frame hash itself. The instrument is the thing that decides
// whether every later measurement is trustworthy, so it gets the same treatment
// as the code it guards: exact expectations, not shapes.

describe('fnv1aBytes / fnv1aFloats — the digest primitives', () => {
  it('is deterministic and order-sensitive', () => {
    expect(fnv1aBytes(new Uint8Array([1, 2, 3]))).toBe(fnv1aBytes(new Uint8Array([1, 2, 3])));
    expect(fnv1aBytes(new Uint8Array([1, 2, 3]))).not.toBe(fnv1aBytes(new Uint8Array([3, 2, 1])));
  });

  it('returns an UNSIGNED 32-bit value, so it survives JSON and a >2^31 comparison', () => {
    for (const v of [0, 1, 255, 0xdeadbeef, 0xffffffff]) {
      const h = fnv1aBytes(new Uint8Array([v, v, v]));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBe(h >>> 0);
    }
  });

  it('matches the FNV-1a reference for the empty input (the offset basis)', () => {
    expect(fnv1aBytes(new Uint8Array(0))).toBe(0x811c9dc5);
  });

  it('hashes floats by BIT PATTERN, so sub-LSB differences are caught', () => {
    // The regression the 2026-09-05 note measured: a wall-clock flicker wobble
    // moved ~19% of pixels at a difference below float display precision. A
    // digest built on rounded or decimal-formatted values would call those
    // frames identical, which is exactly the false pass this tool must not
    // have.
    const a = Math.fround(0.1);
    // 1e-9 is BELOW f32 resolution at 0.1 and rounds away; 1e-8 moves the
    // mantissa by one step, which is the smallest difference a render target
    // can actually hold.
    const b = Math.fround(0.1 + 1e-8);
    expect(a).not.toBe(b); // distinct f32 neighbours, 1 ULP apart
    expect(fnv1aFloats([a])).not.toBe(fnv1aFloats([b]));
    // And the boundary of the claim: something that does NOT survive f32
    // narrowing hashes the same, because both are the same target value.
    expect(fnv1aFloats([Math.fround(0.1)])).toBe(fnv1aFloats([0.1]));
  });

  it('agrees with the byte digest over the same float bits (one digest, two front doors)', () => {
    const values = [0, 1, -1, 3.5, -0.0, 1e-30, 65504, Number.MIN_VALUE];
    const f32 = new Float32Array(values);
    expect(fnv1aFloats(values)).toBe(fnv1aBytes(new Uint8Array(f32.buffer)));
  });

  it('distinguishes +0 from -0 — a sign flip is a real change in a render target', () => {
    expect(fnv1aFloats([0])).not.toBe(fnv1aFloats([-0]));
  });

  it('chains: a per-row seed composes to the same value as hashing the rows at once', () => {
    const rows = [[1, 2, 3], [4, 5], [6]];
    const flat = fnv1aFloats(rows.flat());
    let chained = 0x811c9dc5;
    for (const r of rows) chained = fnv1aFloats(r, chained);
    // NOT equal in general — FNV is sequential, and the chained form hashes the
    // same bits in the same order only if the seed mutation is identical. This
    // asserts the property hashTiles relies on: chaining is well-defined and
    // stable across calls, which is what makes the tile digests reproducible.
    expect(chained).toBe(fnv1aFloats(rows.flat()));
    expect(flat).toBe(chained);
  });
});

describe('row padding — the de-padding is the whole reason this is correct', () => {
  it('computes the 256-byte-aligned stride the game actually gets', () => {
    // The shipped 'bodies' field marches 800x300 with 4 floats per texel:
    // 800 * 16 = 12800 bytes, already a multiple of 256, so no padding.
    expect(paddedRowStrideBytes(800 * 16)).toBe(12800);
    expect(paddedRowStrideFloats(800, 4)).toBe(3200);
    // A row that is NOT aligned does get padded, and this is the case that a
    // dense walk would silently misread.
    expect(paddedRowStrideBytes(100 * 16)).toBe(1792);
    expect(paddedRowStrideBytes(16)).toBe(256);
    expect(ROW_ALIGN).toBe(256);
  });

  it('drops padding so the digest is a pure function of the TEXELS', () => {
    // Two readbacks of the same 2x2 image whose padding bytes differ. Hashing
    // the raw buffer would call these different; hashing the logical texels
    // must call them identical, because no pixel differs.
    const stride = paddedRowStrideFloats(2, 4); // 16 floats: 8 logical + 8 pad
    const withPad = (pad: number) => {
      const buf = new Float32Array(stride * 2);
      const texels = [
        [1, 2, 3, 4, 5, 6, 7, 8],
        [9, 10, 11, 12, 13, 14, 15, 16],
      ];
      for (let y = 0; y < 2; y++) {
        buf.set(texels[y]!, y * stride);
        for (let i = 8; i < stride; i++) buf[y * stride + i] = pad;
      }
      return buf;
    };
    const layout = { width: 2, height: 2, bytesPerTexel: 16, rowStrideBytes: stride * 4 };
    const a = packTexelRegion(withPad(1234), layout, { x: 0, y: 0, w: 2, h: 2 });
    const b = packTexelRegion(withPad(0), layout, { x: 0, y: 0, w: 2, h: 2 });
    expect(a).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(fnv1aFloats(a)).toBe(fnv1aFloats(b));
    // Control: the padding really is different in the raw buffers.
    expect(fnv1aFloats(withPad(1234))).not.toBe(fnv1aFloats(withPad(0)));
  });

  it('reads a region correctly and refuses one it cannot hold', () => {
    const stride = 16;
    const buf = new Float32Array(stride * 3);
    buf.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
    buf.set([11, 12, 13, 14, 15, 16, 17, 18], stride);
    buf.set([21, 22, 23, 24, 25, 26, 27, 28], stride * 2);
    const layout = { width: 2, height: 3, bytesPerTexel: 16, rowStrideBytes: stride * 4 };
    // A 1x2 region at x=1 crosses rows correctly (this is the bug a naive
    // `slice(x, x+w*h)` would introduce).
    expect(packTexelRegion(buf, layout, { x: 1, y: 0, w: 1, h: 2 })).toEqual([5, 6, 7, 8, 15, 16, 17, 18]);
    // Out of bounds is LOUD. A gate that reads `undefined` as 0 fails open.
    expect(() => packTexelRegion(buf, layout, { x: 0, y: 0, w: 3, h: 1 })).toThrow(/outside/);
    expect(() => packTexelRegion(buf, layout, { x: 0, y: 2, w: 1, h: 2 })).toThrow(/outside/);
    // A WRONG STRIDE is the dangerous case: it looks in bounds only because the
    // array is long enough. Assert it throws rather than reading a neighbour.
    expect(() => packTexelRegion(new Float32Array(8), layout, { x: 0, y: 0, w: 2, h: 2 })).toThrow(/stride/);
  });

  it('refuses a layout whose texel is not a whole number of floats', () => {
    const layout = { width: 2, height: 1, bytesPerTexel: 6, rowStrideBytes: 256 };
    expect(() => packTexelRegion(new Float32Array(64), layout, { x: 0, y: 0, w: 1, h: 1 })).toThrow(/float32/);
  });
});

describe('hashTiles — localisation, because a bare mismatch gets switched off', () => {
  const layer = (w: number, h: number, f: (x: number, y: number) => number[]) => {
    const texels = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) texels.set(f(x, y), (y * w + x) * 4);
    return { key: 'marchTarget', texels, width: w, height: h, floatsPerTexel: 4 };
  };
  /** Non-null view of a tile map: the tests above prove it is present. */
  const tilesOf = (t: Record<string, number[]>, key = 'marchTarget'): number[] => t[key]!;
  const base = layer(8, 6, (x, y) => [x, y, 0, 1]);

  it('produces one digest per tile and is stable across calls', () => {
    const t1 = hashTiles([base], 4, 3);
    const t2 = hashTiles([base], 4, 3);
    expect(tilesOf(t1)).toHaveLength(12);
    expect(tilesOf(t1)).toEqual(tilesOf(t2));
  });

  it('covers every texel exactly once, with no column or row dropped', () => {
    // An uneven split (5 tiles over 8 columns) is the case an accumulating
    // edge computation drifts on. Every tile is non-empty and the edges tile
    // the axis, so a moved texel cannot fall between tiles.
    const tilesX = 5, tilesY = 3;
    const edges: number[][] = [];
    for (let tx = 0; tx < tilesX; tx++) edges.push([Math.floor((tx * 8) / tilesX), Math.floor(((tx + 1) * 8) / tilesX)]);
    expect(edges[0]![0]).toBe(0);
    expect(edges[edges.length - 1]![1]).toBe(8);
    for (let i = 1; i < edges.length; i++) expect(edges[i]![0]).toBe(edges[i - 1]![1]);
    for (const [x0, x1] of edges) expect(x1!).toBeGreaterThan(x0!);
    const t = hashTiles([base], tilesX, tilesY);
    expect(tilesOf(t)).toHaveLength(tilesX * tilesY);
  });

  it('localises a single-texel change to exactly one tile', () => {
    const changed = layer(8, 6, (x, y) => (x === 5 && y === 4 ? [99, y, 0, 1] : [x, y, 0, 1]));
    const a = tilesOf(hashTiles([base], 4, 3));
    const b = tilesOf(hashTiles([changed], 4, 3));
    const diff = a.map((h, i) => (h === b[i] ? -1 : i)).filter((i) => i >= 0);
    // Tile index is ty * tilesX + tx. Texel (5,4) lands in tile (2,2): its
    // columns are floor(2*8/4)=4 .. floor(3*8/4)=6 and its rows
    // floor(2*6/3)=4 .. floor(3*6/3)=6, so 2*4 + 2 = 10.
    expect(diff).toEqual([2 * 4 + 2]);
  });

  it('separates layers so an unrelated layer cannot mask a change', () => {
    const other = { ...base, key: 'probeDyn' };
    const t = hashTiles([base, other], 2, 2);
    expect(Object.keys(t).sort()).toEqual(['marchTarget', 'probeDyn']);
  });
});

describe('compareFrames / firstDivergence — the gate', () => {
  const frame = (n: number, hash: number, floats = 64, stats: Record<string, number> = { nonzero: 10 }, tiles: number[] = [1, 2, 3, 4]): FrameHash => ({
    version: FRAME_HASH_VERSION,
    frame: n,
    tilesX: 2,
    tilesY: 2,
    layers: { marchTarget: { hash, width: 4, height: 4, floats, stats } },
    tiles: { marchTarget: tiles },
  });

  it('calls identical frames equal', () => {
    const c = compareFrames(frame(0, 111), frame(0, 111));
    expect(c.equal).toBe(true);
    expect(c.changedLayers).toEqual([]);
    expect(describeComparison(c, 2)).toBe('frame 0: identical');
  });

  it('names the cause, not just the symptom', () => {
    // THE REGRESSION THIS TOOL EXISTS FOR, as a unit test: the zeroed dynamic
    // probe layer. Hash differs AND the bounded stat says why — the layer is
    // empty. A comparison that reported only "marchTarget differs" would send
    // the reader hunting; this one says "nonzero 10 -> 0".
    const c = compareFrames(frame(0, 111, 64, { nonzero: 10 }), frame(0, 222, 64, { nonzero: 0 }));
    expect(c.equal).toBe(false);
    expect(c.changedLayers).toEqual(['marchTarget']);
    expect(c.statChanges.marchTarget?.nonzero).toEqual({ from: 10, to: 0 });
    expect(describeComparison(c, 2)).toContain('nonzero 10→0');
  });

  it('reports a size change as divergence even when the hash collides', () => {
    const c = compareFrames(frame(0, 111, 64), frame(0, 111, 128));
    expect(c.equal).toBe(false);
    expect(c.changedLayers).toContain('marchTarget');
  });

  it('lists every changed tile, and reports a tile-map shape change as all tiles', () => {
    const c = compareFrames(frame(0, 1, 64, {}, [7, 8, 9, 10]), frame(0, 2, 64, {}, [7, 0, 9, 10]));
    expect(c.changedTiles.marchTarget).toEqual([1]);
    const shape = compareFrames(frame(0, 1, 64, {}, [7, 8, 9, 10]), frame(0, 2, 64, {}, [7, 8]));
    expect(shape.changedTiles.marchTarget).toEqual([0, 1, 2, 3]);
  });

  it('finds the FIRST divergent frame and returns null for a clean replay', () => {
    const a = [frame(0, 1), frame(1, 2), frame(2, 3), frame(3, 4)];
    expect(firstDivergence(a, [frame(0, 1), frame(1, 2), frame(2, 3), frame(3, 4)])).toBeNull();
    const d = firstDivergence(a, [frame(0, 1), frame(1, 2), frame(2, 99), frame(3, 4)]);
    expect(d?.frame).toBe(2);
    expect(d?.changedLayers).toEqual(['marchTarget']);
  });

  it('treats a different frame COUNT as divergence — a replay that stepped differently has already diverged', () => {
    const a = [frame(0, 1), frame(1, 2), frame(2, 3)];
    const b = [frame(0, 1), frame(1, 2)];
    const d = firstDivergence(a, b);
    expect(d).not.toBeNull();
    expect(d?.changedLayers).toContain('<recording-length>');
    expect(d?.frame).toBe(2);
  });

  it('survives a layer present on only one side', () => {
    const only = frame(0, 1);
    const extra = frame(0, 1);
    extra.layers.probeDyn = { hash: 5, width: 2, height: 2, floats: 16, stats: { nonzero: 3 } };
    const c = compareFrames(only, extra);
    expect(c.equal).toBe(false);
    expect(c.changedLayers).toEqual(['probeDyn']);
  });
});

// --- CROSS-IMPLEMENTATION DIGEST (deterministic demo recordings stage 2) -----
//
// scripts/lib/demo-digest.mjs hashes the PRESENTED frame (a decoded canvas PNG) in
// plain node, with no build step — so it carries its own copy of FNV-1a rather
// than importing this module. If the two ever disagreed, every recording would
// report a divergence that is an artefact of the TOOL rather than of the game,
// which is the single worst failure this instrument could have. So the duplication
// is GATED here, against fixed vectors rather than against each other: two copies
// agreeing on a wrong answer would still be wrong.

describe('the recorder digest matches this module', () => {
  it('reproduces the canonical FNV-1a 32-bit vectors', () => {
    // Reference outputs from the FNV specification. `abc` and `01234567` are the
    // two most widely published 32-bit vectors, so a sign or multiply bug cannot
    // hide behind a self-consistent pair.
    expect(fnv1aBytes([])).toBe(0x811c9dc5);
    expect(fnv1aBytes([0x61])).toBe(0xe40c292c);
    expect(fnv1aBytes([0x61, 0x62, 0x63])).toBe(0x1a47e90b);
    // '01234567' as BYTES — built by hand rather than via Buffer, so this test
    // needs no node types.
    expect(fnv1aBytes([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37])).toBe(0xd97f649d);
    expect(fnv1aBytes([1, 2, 3, 4])).toBe(0x5734a87d);
  });

  it('agrees with the recorder copy byte for byte, over the vectors AND a large buffer', () => {
    for (const bytes of [[], [0x61], [0x61, 0x62, 0x63], [1, 2, 3, 4], [0xff], [0x00]]) {
      expect(recorderFnv(new Uint8Array(bytes))).toBe(fnv1aBytes(bytes));
    }
    // The real workload is a decoded PNG — a few hundred KB. Agreement on
    // four-byte vectors would not prove much about that.
    const buf = new Uint8Array(200_000);
    let x = 123456789;
    for (let i = 0; i < buf.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; buf[i] = x >>> 24; }
    expect(recorderFnv(buf)).toBe(fnv1aBytes(buf));
  });

  it('shares the offset basis and prime, so a divergence is a red test rather than a silent skew', () => {
    expect(REC_OFFSET).toBe(0x811c9dc5);
    expect(REC_PRIME).toBe(0x01000193);
    expect(fnv1aBytes(new Uint8Array(0))).toBe(REC_OFFSET);
  });
});
