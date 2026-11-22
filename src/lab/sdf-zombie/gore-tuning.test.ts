// src/lab/sdf-zombie/gore-tuning.test.ts
import { describe, it, expect } from 'vitest';
import { chunkCount, goutPack, mergeMaxRadiusFor, scaleGunCrater, type GoreTuning } from './gore-tuning';
import { MERGE, type Wound } from './damage';
import { TERATOMA_PROFILE, ZOMBIE_PROFILE } from './motion-profile';

const wound = (radius: number, carveDepth?: number): Wound =>
  ({ primIdx: 0, local: [0, 0, 0], radius, type: 'blast', ageSec: 0, ...(carveDepth !== undefined ? { carveDepth } : {}) }) as Wound;
const GORE: GoreTuning = { craterScale: 2, blood: { slug: { countMul: 3 } }, chunks: { pellet: { count: [0.5, 2], scale: 1 }, slug: { count: [4, 6], scale: 1.5 } } };

describe('gore-tuning', () => {
  it('leaves a character without gore exactly alone', () => {
    const w = scaleGunCrater(wound(0.16, 0.16), undefined);
    expect(w.radius).toBe(0.16); expect(w.carveDepth).toBe(0.16);
    expect(goutPack(undefined, 'slug')).toBeUndefined();
    expect(chunkCount(undefined, 'slug', () => 0.5)).toBe(0);
    expect(ZOMBIE_PROFILE.gore).toBeUndefined();
  });

  it('scales the crater, and lifts a depth cap that only meant "the probe ran out"', () => {
    const thick = scaleGunCrater(wound(0.16, 0.16), GORE);
    expect(thick.radius).toBeCloseTo(0.32); expect(thick.carveDepth).toBeCloseTo(0.32);
    // Real thin flesh (cap well under the old radius) keeps its cap: a big crater must not punch through an arm.
    const thin = scaleGunCrater(wound(0.16, 0.05), GORE);
    expect(thin.radius).toBeCloseTo(0.32); expect(thin.carveDepth).toBe(0.05);
  });

  it('counts flesh bits: a uniform range, or a chance of the top count', () => {
    for (const r of [0, 0.3, 0.99]) {
      const n = chunkCount(GORE, 'slug', () => r);
      expect(n).toBeGreaterThanOrEqual(4); expect(n).toBeLessThanOrEqual(6);
    }
    expect(chunkCount(GORE, 'pellet', () => 0.2)).toBe(2);
    expect(chunkCount(GORE, 'pellet', () => 0.8)).toBe(0);
    expect(goutPack(GORE, 'slug')?.countMul).toBe(3);
    expect(goutPack(GORE, 'stump')).toBeUndefined();
  });

  // The teratoma's bites are big enough to matter on a 1.2 m ball: a slug crater a third of a metre across or more.
  it('gives the teratoma visceral hits', () => {
    const g = TERATOMA_PROFILE.gore!;
    expect(0.16 * g.craterScale).toBeGreaterThan(0.3);
    expect(g.blood?.slug?.countMul).toBeGreaterThan(1);
    expect(g.chunks?.slug?.count[0]).toBeGreaterThanOrEqual(4);
  });

  it('scales the ring merge cap with the craters, and leaves a body without gore on the shared cap', () => {
    expect(mergeMaxRadiusFor(undefined)).toBe(MERGE.maxRadius);
    expect(mergeMaxRadiusFor(null)).toBe(MERGE.maxRadius);
    expect(mergeMaxRadiusFor({ craterScale: 0 })).toBe(MERGE.maxRadius);
    expect(mergeMaxRadiusFor(TERATOMA_PROFILE.gore)).toBeCloseTo(MERGE.maxRadius * TERATOMA_PROFILE.gore!.craterScale, 12);
  });
});
