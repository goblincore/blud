import { describe, expect, it } from 'vitest';
import { createSeedBandTracker, seedUploadOn, stampRowBand, unionBand } from './seed-band';
import { rasterizeSweepSeed, SWEEP_MAX_HALF_TEXELS, SWEEP_MIN_HALF_TEXELS, type SweepStamp } from './webgpu/shutter-blur';

const stamp = (fromX: number, fromY: number, toX: number, toY: number, radiusPx: number, stream = 0): SweepStamp => ({
  fromX, fromY, toX, toY, radiusPx, stream, velocityX: toX - fromX, velocityY: toY - fromY,
  velocityU: 0.1, velocityV: -0.2, ownerClipZ: 0.5, streakPx: Math.hypot(toX - fromX, toY - fromY),
} as unknown as SweepStamp);

/** Rows of a seed buffer with any non-zero texel. */
function writtenRows(seed: Float32Array, w: number, h: number): { y0: number; y1: number } | null {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let i = y * w * 4; i < (y + 1) * w * 4; i++) if (seed[i] !== 0) { if (y0 < 0) y0 = y; y1 = y; break; }
  }
  return y0 < 0 ? null : { y0, y1 };
}

describe('seed dirty band', () => {
  it('reads the toggle', () => {
    expect(seedUploadOn('')).toBe(true);
    expect(seedUploadOn('?seedupload=0')).toBe(false);
  });
  it('covers every row the raster writes (whole sweeps, clamped radii, off-seed stamps)', () => {
    const W = 1280, H = 720, sw = 512, sh = 288;
    const cases: SweepStamp[][] = [
      [stamp(100, 100, 300, 400, 6)],
      [stamp(640, 360, 640, 361, 0.1)],
      [stamp(10, 700, 900, 5, 300)],
      [stamp(-50, -80, 40, 30, 10), stamp(600, 650, 620, 900, 4)],
      [stamp(200, 100, 260, 120, 8), stamp(700, 500, 640, 480, 12, 1)],
    ];
    for (const stamps of cases) {
      const seed = new Float32Array(sw * sh * 4);
      rasterizeSweepSeed(stamps, W, H, sw, sh, seed);
      const rows = writtenRows(seed, sw, sh);
      const band = stampRowBand(stamps, W, H, sw, sh, SWEEP_MIN_HALF_TEXELS, SWEEP_MAX_HALF_TEXELS);
      expect(band).not.toBeNull();
      if (rows) {
        expect(band!.y0).toBeLessThanOrEqual(rows.y0);
        expect(band!.y1).toBeGreaterThanOrEqual(rows.y1);
      }
      // Tight: within the bbox slack of one texel plus the falloff edge.
      if (rows) expect(rows.y0 - band!.y0).toBeLessThanOrEqual(2);
    }
    expect(stampRowBand([], W, H, sw, sh, SWEEP_MIN_HALF_TEXELS, SWEEP_MAX_HALF_TEXELS)).toBeNull();
  });
  it('a band upload over a stale GPU copy equals a full upload, frame after frame', () => {
    const W = 640, H = 360, sw = 320, sh = 180;
    const gpu = new Float32Array(sw * sh * 4); // what the texture holds
    const cpu = new Float32Array(sw * sh * 4);
    const tracker = createSeedBandTracker();
    let uploads = 0, skipped = 0;
    for (let f = 0; f < 40; f++) {
      const stamps = f % 7 === 6 || f > 33 ? [] : [stamp(40 + f * 12, 30 + f * 6, 60 + f * 12, 50 + f * 7, 5 + (f % 4))];
      if (stamps.length) rasterizeSweepSeed(stamps, W, H, sw, sh, cpu); else cpu.fill(0);
      const band = tracker.next(stampRowBand(stamps, W, H, sw, sh, SWEEP_MIN_HALF_TEXELS, SWEEP_MAX_HALF_TEXELS));
      if (band) { uploads++; gpu.set(cpu.subarray(band.y0 * sw * 4, (band.y1 + 1) * sw * 4), band.y0 * sw * 4); } else skipped++;
      let same = true; for (let i = 0; i < cpu.length; i++) if (gpu[i] !== cpu[i]) { same = false; break; }
      expect(same).toBe(true);
    }
    expect(uploads).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(0); // empty frames after an empty frame upload nothing
  });
  it('unions', () => {
    expect(unionBand(null, null)).toBeNull();
    expect(unionBand({ y0: 3, y1: 5 }, null)).toEqual({ y0: 3, y1: 5 });
    expect(unionBand({ y0: 3, y1: 5 }, { y0: 9, y1: 12 })).toEqual({ y0: 3, y1: 12 });
  });
});
