import { describe, it, expect } from 'vitest';
import {
  REC_VEC4S, MAX_CROWD_INSTANCES, REC_COUNTS, REC_COUNTS2, REC_WOUND_BOUND, REC_ANCHOR_BAND,
  REC_WIND_ALIVE, REC_MELT, REC_FLASH, REC_NOISE_YAW, REC_HEAD_WCOUNT, REC_HEAD_QUAT,
  REC_VOL_POSE0, REC_VOL_POSE1, REC_CENTRE_SEED, REC_HALF_REV, createCrowdRecords,
} from './crowd-records';
import { DATA_ROWS } from './march.wgsl';

describe('crowd records', () => {
  it('gives every field a distinct vec4 inside the record', () => {
    const rows = [REC_COUNTS, REC_COUNTS2, REC_WOUND_BOUND, REC_ANCHOR_BAND, REC_WIND_ALIVE, REC_MELT,
      REC_FLASH, REC_NOISE_YAW, REC_HEAD_WCOUNT, REC_HEAD_QUAT, REC_VOL_POSE0, REC_VOL_POSE1,
      REC_CENTRE_SEED, REC_HALF_REV];
    expect(new Set(rows).size).toBe(rows.length);
    expect(Math.max(...rows)).toBeLessThan(REC_VEC4S);
    expect(REC_VEC4S).toBe(16);
    expect(MAX_CROWD_INSTANCES).toBe(64);
  });

  it('writes a slot and stores the band as slot * DATA_ROWS', () => {
    const r = createCrowdRecords(4);
    r.write(2, {
      counts: [56, 6, 3, 0.12], counts2: [10, 0, 0, 1], woundBound: [1, 2, 3, 0.5],
      bodyAnchor: [0.1, 0.2, 0.3], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0.5, 0.6, 0.7], bodyYaw: 1.5, headCentre: [0, 1.6, 0], woundCount: 2,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 1, 0], variantSeed: 7, bodyHalf: [0.5, 1, 0.5], damageRevision: 3,
    });
    const f = r.floats;
    const base = 2 * REC_VEC4S * 4;
    expect(f[base + REC_COUNTS * 4]).toBe(56);
    expect(f[base + REC_ANCHOR_BAND * 4 + 3]).toBe(2 * DATA_ROWS);
    expect(f[base + REC_WIND_ALIVE * 4 + 3]).toBe(1);
    expect(f[base + REC_HEAD_WCOUNT * 4 + 3]).toBe(2);
    r.alive(2, false);
    expect(f[base + REC_WIND_ALIVE * 4 + 3]).toBe(0);
    expect(r.dirty).toBe(true);
  });
});
