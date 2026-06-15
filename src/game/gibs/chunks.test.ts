import { describe, it, expect } from 'vitest';
import { pickChunkPicnum, rollChunkCount, GibProfile } from './tuning';
import { mulberry32 } from '../rng';

const PROFILE: GibProfile = {
  fleshPicnums: [1454, 1268, 1269, 1456, 1267],
  bonePicnums:  [421, 422, 423],
  boneWeight: 0.2,
  bodyPartCount: { min: 2, max: 4 },
  chunkCount: { min: 8, max: 14 },
  spawnsKickableHead: true,
};

describe('pickChunkPicnum', () => {
  it('returns bone ~20% of the time over 10k rolls', () => {
    const rng = mulberry32(1);
    let bone = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const p = pickChunkPicnum(PROFILE, rng);
      if (PROFILE.bonePicnums.includes(p)) bone++;
    }
    const ratio = bone / N;
    expect(ratio).toBeGreaterThan(0.17);
    expect(ratio).toBeLessThan(0.23);
  });

  it('returns only flesh when boneWeight is 0', () => {
    const rng = mulberry32(2);
    const profile = { ...PROFILE, boneWeight: 0 };
    for (let i = 0; i < 1000; i++) {
      const p = pickChunkPicnum(profile, rng);
      expect(PROFILE.fleshPicnums).toContain(p);
    }
  });

  it('returns only bone when boneWeight is 1', () => {
    const rng = mulberry32(3);
    const profile = { ...PROFILE, boneWeight: 1 };
    for (let i = 0; i < 1000; i++) {
      const p = pickChunkPicnum(profile, rng);
      expect(PROFILE.bonePicnums).toContain(p);
    }
  });
});

describe('rollChunkCount', () => {
  it('respects min/max bounds', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const n = rollChunkCount({ min: 8, max: 14 }, rng);
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(14);
    }
  });

  it('returns min when min === max', () => {
    const rng = mulberry32(1);
    expect(rollChunkCount({ min: 5, max: 5 }, rng)).toBe(5);
  });
});
