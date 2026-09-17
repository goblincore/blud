import { describe, it, expect } from 'vitest';
import { buildFrameHash, digestStats, hashFrame, type DemoHashDeps } from './demo-hash';
import { FRAME_HASH_VERSION, paddedRowStrideFloats } from './frame-hash';

// The instrument's own gate. The digest maths is covered in frame-hash.test.ts;
// what is covered HERE is the wiring that decides WHAT gets hashed and whether a
// broken seam fails loudly or quietly. The quiet failure is the dangerous one:
// a hash that reads nothing reports "identical" forever and gets trusted, which
// is exactly the shape of the boot-param bug this whole tool exists to catch.

/** A march target with the real readback geometry: 256-byte padded rows, so the
 *  tests exercise the de-padding rather than a conveniently dense buffer. */
function fakeMarchTarget(width: number, height: number, f: (x: number, y: number) => number[], pad = 0) {
  const stride = paddedRowStrideFloats(width, 4);
  const data = new Float32Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(f(x, y), y * stride + x * 4);
    for (let i = width * 4; i < stride; i++) data[y * stride + i] = pad;
  }
  return { width, height, floatsPerTexel: 4, data };
}

const deps = (over: Partial<DemoHashDeps> = {}): DemoHashDeps => ({
  readMarchTarget: async () => fakeMarchTarget(4, 2, (x, y) => [x, y, 0.5, 1]),
  readProbeDyn: async () => new Float32Array(32).fill(0.25),
  ...over,
});

describe('digestStats — the bounded numbers that name the cause', () => {
  it('counts through the stride of channels, not every float', () => {
    // channels 4: only channel 0 is the signal. Reading all four would make a
    // zeroed depth channel look like ordinary activity.
    const v = [1, 9, 9, 9, 0, 9, 9, 9, 2, 9, 9, 9];
    const s = digestStats(v, { channels: 4 });
    expect(s.sampled).toBe(3);
    expect(s.nonZero).toBe(2);
    expect(s.min).toBe(0);
    expect(s.max).toBe(2);
  });

  it('reports a FULLY ZERO layer as zero nonZero — the black-silhouette signature', () => {
    const s = digestStats(new Float32Array(64), { channels: 1 });
    expect(s.nonZero).toBe(0);
    expect(s.zeroFractionMillionths).toBe(1_000_000);
    // min/max of an all-zero buffer are 0, NOT Infinity: an Infinity here would
    // serialise to null across CDP and read as a missing field.
    expect(s.min).toBe(0);
    expect(s.max).toBe(0);
  });

  it('separates non-finite from zero, because they are different bugs', () => {
    const s = digestStats([0, NaN, Infinity, -Infinity, 3], { channels: 1 });
    expect(s.nonFinite).toBe(3);
    expect(s.nonZero).toBe(1);
    expect(s.max).toBe(3);
  });

  it('quantises extents so a stat cannot destabilise a comparison', () => {
    // Six significant digits: far below render resolution, far above noise.
    const s = digestStats([0.123456789, -1.987654321], { channels: 1 });
    expect(s.min).toBe(-1.98765);
    expect(s.max).toBe(0.123457);
  });

  it('handles an empty layer without dividing by zero', () => {
    const s = digestStats([], { channels: 1 });
    expect(s).toMatchObject({ nonZero: 0, sampled: 0, zeroFractionMillionths: 0 });
  });
});

describe('buildFrameHash — shape, determinism, and sensitivity', () => {
  it('stamps the instrument version and echoes the frame index', () => {
    const f = buildFrameHash(7, [{ key: 'marchTarget', texels: [1, 2, 3, 4], width: 1, height: 1, floatsPerTexel: 4, stats: {} }]);
    expect(f.version).toBe(FRAME_HASH_VERSION);
    expect(f.frame).toBe(7);
    expect(f.layers.marchTarget?.floats).toBe(4);
  });

  it('is deterministic and sensitive to a single changed texel', () => {
    const a = buildFrameHash(0, [{ key: 'marchTarget', texels: [1, 2, 3, 4, 5, 6, 7, 8], width: 2, height: 1, floatsPerTexel: 4, stats: {} }]);
    const b = buildFrameHash(0, [{ key: 'marchTarget', texels: [1, 2, 3, 4, 5, 6, 7, 8], width: 2, height: 1, floatsPerTexel: 4, stats: {} }]);
    const c = buildFrameHash(0, [{ key: 'marchTarget', texels: [1, 2, 3, 4, 5, 6, 7, 9], width: 2, height: 1, floatsPerTexel: 4, stats: {} }]);
    expect(a.layers.marchTarget?.hash).toBe(b.layers.marchTarget?.hash);
    expect(a.layers.marchTarget?.hash).not.toBe(c.layers.marchTarget?.hash);
  });

  it('produces a tile map of the requested shape for each layer', () => {
    const f = buildFrameHash(0, [
      { key: 'marchTarget', texels: new Array(48).fill(1), width: 4, height: 3, floatsPerTexel: 4, stats: {} },
      { key: 'probeDyn', texels: new Array(16).fill(1), width: 1, height: 1, floatsPerTexel: 16, stats: {} },
    ], { x: 4, y: 3 });
    expect(f.tilesX).toBe(4);
    expect(f.tilesY).toBe(3);
    expect(f.tiles.marchTarget).toHaveLength(12);
    expect(f.tiles.probeDyn).toHaveLength(12);
  });
});

describe('hashFrame — what gets hashed, and how it fails', () => {
  it('hashes the de-padded march target: row padding CANNOT change the digest', async () => {
    // Two reads of the same image whose uninitialised padding bytes differ. A
    // gate that hashed the raw readback would report a divergence no pixel
    // shows, which is how a gate earns a reputation for flapping.
    const clean = await hashFrame(deps({ readMarchTarget: async () => fakeMarchTarget(4, 2, (x, y) => [x, y, 1, 1], 0) }), 0);
    const dirty = await hashFrame(deps({ readMarchTarget: async () => fakeMarchTarget(4, 2, (x, y) => [x, y, 1, 1], 1234) }), 0);
    expect(clean.layers.marchTarget?.hash).toBe(dirty.layers.marchTarget?.hash);
  });

  it('THROWS on an empty march target instead of hashing nothing', async () => {
    // The fail-open failure mode. A seam that silently hashes an empty buffer
    // reports "identical" for the rest of time and gets trusted.
    await expect(hashFrame(deps({ readMarchTarget: async () => ({ width: 0, height: 0, floatsPerTexel: 4, data: [] }) }), 0))
      .rejects.toThrow(/not wired to a render target/);
  });

  it('catches A ZEROED DYNAMIC PROBE LAYER — the shipped black-silhouette bug', async () => {
    // This is the regression, reduced to its essentials. The layer is the
    // gather's storage readback; when it went to zero the marched characters
    // came out black and the owner found it by playtesting. Here it is a hash
    // mismatch with a stat that says why.
    const healthy = await hashFrame(deps(), 0);
    const zeroed = await hashFrame(deps({ readProbeDyn: async () => new Float32Array(32) }), 0);
    expect(healthy.layers.probeDyn).toBeDefined();
    expect(zeroed.layers.probeDyn?.hash).not.toBe(healthy.layers.probeDyn?.hash);
    expect(healthy.layers.probeDyn?.stats.nonZero).toBe(32);
    expect(zeroed.layers.probeDyn?.stats.nonZero).toBe(0);
    // And the march target is unchanged by the seam, so the mismatch cannot be
    // blamed on the other layer.
    expect(zeroed.layers.marchTarget?.hash).toBe(healthy.layers.marchTarget?.hash);
  });

  it('omits the probe layer when the gather is not bound, rather than failing', async () => {
    // `?probedyn=0` and the lab pages legitimately have no gather. That is not
    // an error, it is a different instrument shape — and the layer being absent
    // is itself visible in the comparison.
    const f = await hashFrame(deps({ readProbeDyn: async () => null }), 0);
    expect(Object.keys(f.layers)).toEqual(['marchTarget']);
  });

  it('reports the layer geometry so a size change is visible', async () => {
    const f = await hashFrame(deps({ readMarchTarget: async () => fakeMarchTarget(400, 300, () => [0, 0, 0, 1]) }), 3);
    expect(f.layers.marchTarget).toMatchObject({ width: 400, height: 300, floats: 400 * 300 * 4 });
    expect(f.frame).toBe(3);
  });
});

describe('the gather-inputs layer — separating input drift from gather drift', () => {
  // WHY THIS LAYER EXISTS (2026-09-10). With parity held, the seed pinned and the
  // dispatch count identical, two boots still produced different dynamic layers,
  // so the divergence had to enter through the gather's INPUTS. Hashing the
  // packed bone capsules answers "did the two boots pose the bodies differently"
  // directly — and if they match while probeDyn differs, the fault is in the
  // gather itself. Either answer is decisive, which is why it is worth a layer.
  const withInstances = (data: number[], count: number) => deps({
    readInstances: async () => ({ data, count, floatsPerInstance: 18 }),
  });

  it('adds an instances layer keyed by instance count, not by allocation size', async () => {
    // The allocation is a fixed 1024 slots and its tail is uninitialised.
    // Hashing the whole buffer would fold that tail in and report divergence on
    // bytes no body owns — the same fail-open shape the de-padding guards.
    const g = new Array(1024 * 18).fill(0);
    for (let i = 0; i < 3 * 18; i++) g[i] = (i % 7) + 1;
    g[3 * 18 + 5] = 999; // used-slot sentinel at the boundary
    const f = await hashFrame(withInstances(g, 4), 0);
    expect(f.layers.instances).toBeDefined();
    expect(f.layers.instances?.floats).toBe(4 * 18);
    expect(f.layers.instances?.stats.count).toBe(4);
  });

  it('is sensitive to ONE changed capsule — a posed body that moved', async () => {
    const g = new Array(4 * 18).fill(1);
    const h = [...g];
    h[2 * 18 + 3] = 1.0001; // one coordinate of one instance
    const a = await hashFrame(withInstances(g, 4), 0);
    const b = await hashFrame(withInstances(h, 4), 0);
    expect(a.layers.instances?.hash).not.toBe(b.layers.instances?.hash);
    // And the tile map localises it to that instance's tile.
    const ta = new Set(a.tiles.instances);
    const tb = new Set(b.tiles.instances);
    expect([...tb].filter((t) => !ta.has(t))).toHaveLength(1);
  });

  it('reports a changed instance COUNT as drift even when the hash matches', async () => {
    // One body fewer is a different frame, whatever the bytes happen to be.
    const g = new Array(18 * 4).fill(2);
    const a = await hashFrame(withInstances(g, 4), 0);
    const b = await hashFrame(withInstances(g, 3), 0);
    expect(a.layers.instances?.hash).not.toBe(b.layers.instances?.hash);
    expect(a.layers.instances?.stats.count).toBe(4);
    expect(b.layers.instances?.stats.count).toBe(3);
  });

  it('is skipped entirely when the page supplies no instances, rather than hashing nothing', async () => {
    const f = await hashFrame(deps(), 0);
    expect(f.layers.instances).toBeUndefined();
    expect(Object.keys(f.layers).sort()).toEqual(['marchTarget', 'probeDyn']);
  });
});
